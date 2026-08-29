// Pezzi comuni alle function. Sta in lib/ apposta: Netlify considera function
// solo i file in cima a functions/ (e le sottocartelle con lo stesso nome del
// file), quindi questo modulo non diventa un endpoint per sbaglio.
const crypto = require('crypto');
const https = require('https');

const GROQ_KEY = process.env.GROQ_API_KEY || process.env.GROQ_KEY;

// Allowlist per le chiamate CROSS-ORIGIN, cioe' da un dominio diverso da quello
// che serve la function. Le chiamate della nostra pagina passano gia' dal
// controllo same-site (vedi isSameSite) e non hanno bisogno di stare qui.
const ALLOWED_ORIGINS = buildAllowlist();

// Rate limit best-effort per IP. Le function sono stateless tra istanze diverse,
// quindi non e' una protezione forte: serve a tagliare gli abusi banali.
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN || 20);
const RATE_WINDOW_MS = 60 * 1000;
const hits = new Map();

// Token di sessione: la pagina ne chiede uno in GET e lo allega a ogni POST.
// ATTENZIONE a cosa e' e a cosa NON e': l'header Origin e' falsificabile da un
// client che non sia un browser, quindi anche il token e' ottenibile con due
// richieste curl. Non e' autenticazione. Serve ad alzare il costo dell'abuso
// (due round trip, token legato all'IP e con vita breve) e a rendere inutile
// il semplice copia-incolla dell'URL della function.
const SESSION_TTL_MS = 15 * 60 * 1000;

function buildAllowlist() {
  const list = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => normalizeOrigin(s))
    .filter(Boolean);

  // Netlify popola queste da sola: URL = sito di produzione,
  // DEPLOY_PRIME_URL / DEPLOY_URL = deploy preview e branch deploy.
  for (const key of ['URL', 'DEPLOY_PRIME_URL', 'DEPLOY_URL']) {
    const val = normalizeOrigin(process.env[key]);
    if (val) list.push(val);
  }

  if (process.env.NETLIFY_DEV) {
    list.push('http://localhost:8888', 'http://127.0.0.1:8888');
  }

  return Array.from(new Set(list));
}

function normalizeOrigin(value) {
  const raw = (value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

// La pagina che chiama la function e' servita dallo stesso host della function:
// se Origin e Host coincidono la richiesta arriva dal nostro sito, qualunque
// esso sia. Cosi' funzionano produzione, deploy preview, branch deploy e domini
// custom senza doverli elencare da nessuna parte, mentre un altro sito resta
// fuori perche' il suo Origin non corrispondera' mai al nostro Host.
function isSameSite(origin, headers) {
  if (!origin) return false;
  const host = (headers['x-forwarded-host'] || headers.host || '').trim().toLowerCase();
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function isAllowed(origin, headers) {
  if (!origin) return false;
  return isSameSite(origin, headers) || ALLOWED_ORIGINS.includes(origin);
}

function corsFor(origin, headers) {
  const out = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Session-Token',
    'Vary': 'Origin'
  };
  if (isAllowed(origin, headers)) out['Access-Control-Allow-Origin'] = origin;
  return out;
}

function clientIp(headers) {
  return headers['x-nf-client-connection-ip']
    || (headers['x-forwarded-for'] || '').split(',')[0].trim()
    || 'unknown';
}

function rateLimited(ip) {
  if (!RATE_LIMIT_PER_MIN) return false;
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);

  if (hits.size > 500) {
    for (const [key, times] of hits) {
      if (!times.length || now - times[times.length - 1] > RATE_WINDOW_MS) hits.delete(key);
    }
  }
  return recent.length > RATE_LIMIT_PER_MIN;
}

// Nessuna env var nuova da impostare: se SESSION_SECRET non c'e', deriviamo un
// segreto stabile dalla chiave che esiste gia'. Tutte le function lo derivano
// allo stesso modo, quindi un token emesso da una vale anche per le altre.
function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  return crypto.createHash('sha256').update(`${GROQ_KEY || ''}|vinted-session-v1`).digest('hex');
}

function b64url(value) {
  return Buffer.from(value).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Nel token non finisce l'IP in chiaro: ne basta un'impronta per accorgersi
// che il token e' stato passato a qualcun altro.
function ipTag(ip) {
  return crypto.createHash('sha256').update(String(ip)).digest('hex').slice(0, 16);
}

function sign(payload) {
  return crypto.createHmac('sha256', sessionSecret()).update(payload).digest('hex');
}

function issueToken(ip) {
  const payload = b64url(JSON.stringify({ exp: Date.now() + SESSION_TTL_MS, iph: ipTag(ip) }));
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token, ip) {
  if (typeof token !== 'string' || !token) return false;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return false;

  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  // timingSafeEqual pretende buffer della stessa lunghezza, altrimenti lancia.
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;

  let data;
  try {
    const raw = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    data = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!data || typeof data.exp !== 'number' || Date.now() > data.exp) return false;
  return data.iph === ipTag(ip);
}

function lowerKeys(obj) {
  const out = {};
  for (const key of Object.keys(obj)) out[key.toLowerCase()] = obj[key];
  return out;
}

function json(statusCode, cors, obj) {
  return {
    statusCode,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(obj)
  };
}

// Cache di container, a scadenza. Senza TTL un fallimento passeggero (un 429
// dell'API mentre cerchiamo, un blip di rete) resterebbe impresso per tutta la
// vita del container.
const cache = new Map();

function cacheGet(key, ttl) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > ttl) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, at: Date.now() });
}

function cachePeek(key) {
  return cache.get(key);
}

// Il preambolo identico a ogni function: metodo, origine, rate limit, token.
// Restituisce { cors, ip, headers } se la richiesta puo' proseguire, oppure
// { risposta } gia' pronta da rimandare.
function checkRequest(event, opts) {
  const options = opts || {};
  const headers = lowerKeys(event.headers || {});
  // Su una POST il browser manda sempre Origin, anche same-origin.
  // Il Referer e' solo una rete di sicurezza per i webview che lo omettono.
  const origin = normalizeOrigin(headers.origin) || normalizeOrigin(headers.referer);
  const cors = corsFor(origin, headers);
  const metodi = options.metodi || ['POST'];

  if (event.httpMethod === 'OPTIONS') {
    return { risposta: { statusCode: 204, headers: cors, body: '' } };
  }
  if (!metodi.includes(event.httpMethod)) {
    return { risposta: json(405, cors, { error: 'Metodo non consentito' }) };
  }
  if (!isAllowed(origin, headers)) {
    return { risposta: json(403, cors, { error: 'Origine non autorizzata' }) };
  }

  const ip = clientIp(headers);
  if (rateLimited(ip)) {
    return { risposta: json(429, cors, { error: 'Troppe richieste, aspetta un minuto.' }) };
  }
  if (options.richiediToken && !verifyToken(headers['x-session-token'], ip)) {
    return { risposta: json(401, cors, { error: 'Sessione scaduta, ricarico e riprovo.' }) };
  }
  return { cors, ip, headers };
}

/* ============================== HTTP ============================== */

// Le istanze delle function vengono riusate a caldo: tenendo viva la connessione
// ci risparmiamo handshake TCP+TLS a ogni richiesta.
const agent = new https.Agent({ keepAlive: true, keepAliveMsecs: 1500, maxSockets: 10 });

// Una richiesta HTTPS con un tetto di tempo vero. Le tre function chiamano tutte
// servizi esterni dentro i 10s che Netlify concede, e sbagliare il timeout qui
// significa farsi chiudere la function a meta' invece di rispondere un errore.
function inviaHttp(opzioni, payload, deadline) {
  return new Promise((resolve, reject) => {
    let guard = null;
    const settle = (fn) => (arg) => { clearTimeout(guard); fn(arg); };
    const ok = settle(resolve);
    const ko = settle(reject);

    const headers = Object.assign({}, opzioni.headers);
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const req = https.request({
      hostname: opzioni.hostname,
      path: opzioni.path,
      method: opzioni.method,
      agent,
      headers,
      timeout: Math.max(1000, deadline - Date.now())
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => ok({ status: res.statusCode, body: data }));
    });

    // Il timeout di http.request misura l'inattivita' del socket, non la durata
    // totale: da solo non impedisce a una risposta lenta ma continua di
    // scavalcare la deadline. Questo e' il tetto assoluto.
    guard = setTimeout(() => {
      const err = new Error('Deadline superata');
      err.code = 'AI_TIMEOUT';
      req.destroy(err);
    }, Math.max(1000, deadline - Date.now()));

    req.on('timeout', () => {
      const err = new Error('Timeout della richiesta');
      err.code = 'AI_TIMEOUT';
      req.destroy(err);
    });
    req.on('error', ko);
    if (payload) req.write(payload);
    req.end();
  });
}

// Il prezzo di riferimento e' la mediana, non la media: un solo venditore fuori
// mercato non deve spostarla. Serve alla ricerca per immagine e all'agente, che
// partono da liste diverse ma con lo stesso problema.
function statistichePrezzi(valoriGrezzi) {
  const valori = (valoriGrezzi || []).filter(v => typeof v === 'number' && isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!valori.length) return null;
  const meta = Math.floor(valori.length / 2);
  const mediana = valori.length % 2 ? valori[meta] : (valori[meta - 1] + valori[meta]) / 2;
  return {
    n: valori.length,
    min: valori[0],
    max: valori[valori.length - 1],
    mediana: Math.round(mediana * 100) / 100
  };
}

module.exports = {
  GROQ_KEY, SESSION_TTL_MS,
  normalizeOrigin, isSameSite, isAllowed, corsFor, clientIp, rateLimited,
  issueToken, verifyToken, lowerKeys, json, inviaHttp, statistichePrezzi,
  cacheGet, cacheSet, cachePeek, checkRequest
};
