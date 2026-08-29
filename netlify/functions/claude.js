const https = require('https');
const crypto = require('crypto');

// La chiave NON sta nel codice.
// Su Netlify: Site settings > Environment variables > GROQ_API_KEY
// Accettiamo anche GROQ_KEY: e' il nome usato storicamente su questo sito,
// e la rinomina del codice a GROQ_API_KEY aveva lasciato la function senza chiave.
const GROQ_KEY = process.env.GROQ_API_KEY || process.env.GROQ_KEY;

// Allowlist per le chiamate CROSS-ORIGIN, cioe' da un dominio diverso da quello
// che serve la function. Le chiamate della nostra pagina passano gia' dal
// controllo same-site (vedi isSameSite) e non hanno bisogno di stare qui.
// Restano fuori tutti gli altri siti: la chiave non e' un proxy aperto.
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
// il semplice copia-incolla dell'URL della function. La barriera vera sarebbe
// un captcha tipo Turnstile, che pero' richiede chiavi di un servizio esterno.
const SESSION_TTL_MS = 15 * 60 * 1000;

const MAX_BODY = 6 * 1024 * 1024;   // 6MB, limite Netlify
const MAX_PROMPT = 8000;            // caratteri
const MAX_IMAGES = 4;

// Netlify chiude le function sincrone a 10s (default account).
// Teniamoci sotto, cosi' restituiamo un errore JSON pulito invece della
// pagina di timeout di Netlify. Alzabile se l'account ha il limite esteso.
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 9000);

// Punto di partenza, non una certezza: Groq ritira i modelli senza preavviso.
// Se non esistono piu', la function chiede il catalogo e ripiega da sola.
// Le env var, se impostate, hanno la precedenza.
const MODEL_TEXT = process.env.GROQ_MODEL_TEXT || 'openai/gpt-oss-120b';
const MODEL_VISION = process.env.GROQ_MODEL_VISION || 'meta-llama/llama-4-scout-17b-16e-instruct';

// Ordine di gradimento, applicato a quello che Groq dichiara disponibile.
const MODEL_PREFERENCES = {
  image: [/llama-4-scout/i, /llama-4-maverick/i, /llama-4/i, /vision/i, /qwen/i],
  text: [/llama-3\.3-70b/i, /llama-3\.[12]-70b/i, /^openai\/gpt-oss/i, /llama-3/i]
};

// Cache di container, a scadenza. Senza TTL un fallimento passeggero (un 429
// di Groq mentre cerchiamo, un blip di rete) restava impresso per tutta la vita
// del container, che da li' in poi rispondeva 502 a chiunque.
const POSITIVE_TTL_MS = 30 * 60 * 1000;  // "questo modello funziona"
const NEGATIVE_TTL_MS = 5 * 60 * 1000;   // "nessun modello funziona"
const CATALOG_TTL_MS = 10 * 60 * 1000;   // elenco modelli dell'account
const cache = new Map();

// Quanti modelli provare al massimo. Un modello sbagliato viene rifiutato in
// poche centinaia di ms, quindi possiamo permetterci di provarne diversi;
// e' il budget di tempo a fermarci davvero (vedi la deadline unica).
const MAX_MODEL_ATTEMPTS = 8;
// Sotto questo margine non ha senso iniziare un altro tentativo: non farebbe
// in tempo a rispondere prima che Netlify chiuda la function.
const MIN_ATTEMPT_MS = 1200;

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

// Un modello che funziona lo teniamo a lungo, un "non ce n'e' nessuno" poco:
// il secondo e' molto piu' spesso una condizione temporanea.
function resolvedModel(kind) {
  const key = `model:${kind}`;
  const hit = cache.get(key);
  if (!hit) return undefined;
  return cacheGet(key, hit.value === false ? NEGATIVE_TTL_MS : POSITIVE_TTL_MS);
}

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
// segreto stabile dalla chiave che esiste gia'. Cambiando la chiave cambia il
// segreto e i token in giro smettono di valere: con 15 minuti di vita e il
// rinnovo automatico lato client, non se ne accorge nessuno.
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

exports.handler = async (event) => {
  const headers = lowerKeys(event.headers || {});
  // Su una POST il browser manda sempre Origin, anche same-origin.
  // Il Referer e' solo una rete di sicurezza per i webview che lo omettono.
  const origin = normalizeOrigin(headers.origin) || normalizeOrigin(headers.referer);
  const cors = corsFor(origin, headers);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return json(405, cors, { error: 'Metodo non consentito' });
  }
  if (!isAllowed(origin, headers)) {
    return json(403, cors, { error: 'Origine non autorizzata' });
  }
  if (!GROQ_KEY) {
    return json(500, cors, { error: 'Chiave AI non configurata sul server (GROQ_API_KEY o GROQ_KEY)' });
  }

  const ip = clientIp(headers);
  if (rateLimited(ip)) {
    return json(429, cors, { error: 'Troppe richieste, aspetta un minuto.' });
  }

  // GET = "dammi un token per le prossime richieste".
  if (event.httpMethod === 'GET') {
    return json(200, cors, { token: issueToken(ip), expiresIn: SESSION_TTL_MS });
  }

  if (!verifyToken(headers['x-session-token'], ip)) {
    return json(401, cors, { error: 'Sessione scaduta, ricarico e riprovo.' });
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');
  if (Buffer.byteLength(rawBody) > MAX_BODY) {
    return json(413, cors, { error: 'Immagini troppo pesanti' });
  }

  const startedAt = Date.now();
  // Una sola deadline per tutta la richiesta, tentativi di fallback inclusi.
  // Prima ogni chiamata ripartiva col suo timeout pieno, quindi bastava un
  // primo tentativo lento piu' un secondo per sforare il limite di Netlify e
  // far arrivare al client la pagina HTML di timeout invece del nostro JSON.
  const deadline = startedAt + TIMEOUT_MS;

  try {
    let body;
    try {
      body = JSON.parse(rawBody || '{}');
    } catch {
      return json(400, cors, { error: 'Richiesta non valida' });
    }

    const { type, prompt } = body;

    if (typeof prompt !== 'string' || !prompt.trim()) {
      return json(400, cors, { error: 'Prompt mancante' });
    }
    if (prompt.length > MAX_PROMPT) {
      return json(400, cors, { error: 'Prompt troppo lungo' });
    }

    // Accetta sia il formato nuovo (images: [...]) sia quello vecchio (imageBase64)
    let images = Array.isArray(body.images) ? body.images : [];
    if (!images.length && body.imageBase64) {
      images = [{ base64: body.imageBase64, mime: body.imageMime }];
    }
    images = images.slice(0, MAX_IMAGES);

    let messages;
    if (type === 'image') {
      if (!images.length) return json(400, cors, { error: 'Nessuna immagine ricevuta' });
      const content = [{ type: 'text', text: prompt }];
      for (const img of images) {
        if (!img || typeof img.base64 !== 'string' || !img.base64) continue;
        const mime = img.mime === 'image/png' ? 'image/png' : 'image/jpeg';
        content.push({
          type: 'image_url',
          image_url: { url: `data:${mime};base64,${img.base64}` }
        });
      }
      if (content.length < 2) return json(400, cors, { error: 'Immagini non valide' });
      messages = [{ role: 'user', content }];
    } else {
      messages = [{ role: 'user', content: prompt }];
    }

    const kind = type === 'image' ? 'image' : 'text';
    const known = resolvedModel(kind);

    // Se poco fa abbiamo scoperto che nessun modello va bene, non rifacciamo
    // tutto il giro di tentativi a ogni foto: rispondiamo subito. Passata la
    // scadenza della cache negativa, invece, si riprova da capo.
    if (known === false) {
      return json(502, cors, { error: modelFailureMessage(kind) });
    }

    const request = {
      model: known || (kind === 'image' ? MODEL_VISION : MODEL_TEXT),
      messages,
      temperature: type === 'image' ? 0.2 : (body.creative ? 0.85 : 0.6),
      // Il JSON dell'analisi foto ha molti campi con testo libero: a 1024
      // token rischiava di troncarsi a meta' e diventare impossibile da
      // interpretare, il che si vede come "analisi imprecisa".
      max_tokens: type === 'image' ? 2048 : 1024
    };

    // JSON mode: solo per il testo. Sul multimodale non e' garantito,
    // li' ci affidiamo al parsing tollerante lato client.
    const wantsJson = body.json === true && type !== 'image';
    if (wantsJson) request.response_format = { type: 'json_object' };

    let result = await callGroq(request, deadline);

    // Il catalogo di Groq non dice quali modelli accettano immagini, e i nomi
    // non bastano a indovinarlo. Se il modello e' stato ritirato o rifiuta le
    // foto, proviamo i candidati successivi finche' uno risponde davvero.
    if (needsAnotherModel(result, kind)) {
      const tried = [request.model];
      const candidates = await candidateModels(kind, tried, deadline);
      // Distinguiamo "provati tutti" da "finito il tempo": solo nel primo
      // caso possiamo concludere che non esiste un modello adatto.
      let exhausted = true;
      for (const candidate of candidates) {
        if (deadline - Date.now() < MIN_ATTEMPT_MS) { exhausted = false; break; }
        request.model = candidate;
        tried.push(candidate);
        result = await callGroq(request, deadline);
        if (!needsAnotherModel(result, kind)) {
          console.log(`Modello ${tried[0]} non utilizzabile, passo a ${candidate}`);
          cacheSet(`model:${kind}`, candidate);
          break;
        }
      }
      if (needsAnotherModel(result, kind)) {
        // Abbiamo esaurito i candidati: ricordiamocelo per qualche minuto, cosi'
        // le richieste subito successive non ripetono tutti i tentativi. Se
        // invece ci siamo fermati per il tempo, non concludiamo niente.
        if (exhausted) cacheSet(`model:${kind}`, false);
        // Il dettaglio (cosa abbiamo provato, cosa offre l'account) serve a chi
        // gestisce il sito e sta nei log: al client non diciamo com'e' fatto
        // dentro. Le env var da impostare sono GROQ_MODEL_TEXT / GROQ_MODEL_VISION.
        console.error(modelFailureDetail(kind, tried));
        return json(502, cors, { error: modelFailureMessage(kind) });
      }
    }

    // Se il modello non digerisce response_format, riprova una volta senza.
    if (wantsJson && result.status >= 400 && /response_format|json/i.test(result.body || '')
        && deadline - Date.now() >= MIN_ATTEMPT_MS) {
      delete request.response_format;
      result = await callGroq(request, deadline);
    }

    let data;
    try {
      data = JSON.parse(result.body);
    } catch {
      console.error(`Risposta non JSON da Groq (HTTP ${result.status}): ${(result.body || '').slice(0, 300)}`);
      return json(502, cors, { error: 'Il servizio AI ha risposto in modo inatteso. Riprova.' });
    }

    if (result.status >= 400 || data.error) {
      const detail = typeof data.error === 'string'
        ? data.error
        : (data.error && data.error.message) || `HTTP ${result.status}`;
      // Il testo di Groq puo' contenere id di organizzazione, nomi di modello e
      // dettagli di quota: resta nei log, al client va un messaggio nostro.
      console.error(`Groq ${result.status} su ${request.model}: ${detail}`);
      return json(clientStatusFor(result.status), cors, { error: friendlyGroqError(result.status) });
    }

    const text = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : null;
    if (!text) return json(502, cors, { error: 'Il modello ha restituito una risposta vuota' });

    // Rimandiamo anche quale modello ha risposto: serve a capire da cosa
    // dipende la qualita' dell'analisi e quale conviene fissare a mano.
    return json(200, cors, { text, model: request.model });

  } catch (e) {
    console.error('claude fn error:', e);
    if (e && e.code === 'AI_TIMEOUT') {
      return json(504, cors, { error: 'L\'AI ci ha messo troppo. Riprova.' });
    }
    // Non rimandiamo mai stack o dettagli interni al client
    return json(500, cors, { error: 'Errore interno del server' });
  }
};

function lowerKeys(obj) {
  const out = {};
  for (const key of Object.keys(obj)) out[key.toLowerCase()] = obj[key];
  return out;
}

// Lo status di Groq non va rimandato tale e quale: un 401 upstream (chiave
// nostra scaduta) davanti al client significherebbe "token di sessione non
// valido" e lo manderebbe a rinnovarlo per niente.
function clientStatusFor(status) {
  if (status === 429) return 429;
  if (status === 408 || status === 504) return 504;
  return 502;
}

function friendlyGroqError(status) {
  if (status === 429) return 'Troppe richieste, riprova tra qualche secondo.';
  if (status === 401 || status === 403) return 'Il servizio AI ha rifiutato le credenziali del sito.';
  if (status === 413) return 'Richiesta troppo pesante per il modello. Prova con meno foto.';
  if (status === 400) return 'Il modello ha rifiutato la richiesta. Riprova.';
  return 'Servizio AI non disponibile al momento. Riprova tra poco.';
}

// Al client basta sapere che ora non si puo' fare e che vale la pena riprovare.
function modelFailureMessage(kind) {
  return kind === 'image'
    ? 'Nessun modello disponibile per l\'analisi foto in questo momento. Riprova tra qualche minuto.'
    : 'Nessun modello di testo disponibile in questo momento. Riprova tra qualche minuto.';
}

// Questo invece finisce solo nei log della function: cosa abbiamo provato,
// quale variabile impostare e l'elenco completo dei modelli dell'account.
function modelFailureDetail(kind, tried) {
  const all = cacheGet('catalog', CATALOG_TTL_MS) || [];
  return `Nessun modello utilizzabile per "${kind}". `
       + (tried.length ? `Provati: ${tried.join(', ')}. ` : '')
       + `Imposta ${kind === 'image' ? 'GROQ_MODEL_VISION' : 'GROQ_MODEL_TEXT'} `
       + `con uno di questi ${all.length} modelli: ${all.join(', ')}`;
}

// Groq risponde 404 con "does not exist or you do not have access to it"
// quando il modello e' stato ritirato dal catalogo.
function isModelMissing(result) {
  if (!result || result.status !== 404) return false;
  return /does not exist|model_not_found|decommissioned/i.test(result.body || '');
}

// Vale la pena provare un altro modello? Sia se questo non esiste piu', sia
// se esiste ma rifiuta le immagini: Groq lo segnala con un 400 che parla di
// image/vision/multimodal.
function needsAnotherModel(result, kind) {
  if (isModelMissing(result)) return true;
  if (kind !== 'image' || !result || result.status !== 400) return false;
  return /image|vision|multimodal|modality/i.test(result.body || '');
}

// Modelli che non sono chat completion: sintesi vocale, trascrizione,
// classificatori di sicurezza, embedding. Provarli e' solo tempo perso.
const NOT_CHAT = /orpheus|whisper|tts|prompt-guard|guard|embed|rerank|distil/i;

// Famiglie che sappiamo essere di solo testo: le proviamo comunque, ma per
// ultime, per non bruciare i tentativi prima di arrivare a un multimodale.
const TEXT_ONLY_HINT = /gpt-oss|allam|compound/i;

// Ordine in cui provare: prima i nomi che promettono visione, poi gli altri
// modelli di chat, per ultimi quelli che con ogni probabilita' non vedono.
// Il catalogo di Groq non dichiara le modalita', quindi l'unica prova certa
// e' mandare la richiesta vera.
// Dentro la stessa famiglia il numero piu' alto e' il modello piu' recente
// (qwen3.8 batte qwen3.6) o il piu' grande (gpt-oss-120b batte gpt-oss-20b).
// In ordine alfabetico finivano prima i piu' vecchi, e la ricerca si fermava
// li'. Le famiglie restano nell'ordine di prima.
function familyKey(id) { return id.replace(/\d+(\.\d+)?/g, '#'); }
function versionScore(id) {
  const nums = id.match(/\d+(?:\.\d+)?/g);
  return nums ? Number(nums[0]) : 0;
}
function newestFirst(ids) {
  return ids.slice().sort((a, b) => {
    const fa = familyKey(a), fb = familyKey(b);
    if (fa !== fb) return fa < fb ? -1 : 1;
    return versionScore(b) - versionScore(a);
  });
}

async function candidateModels(kind, exclude, deadline) {
  const models = await listModels(deadline);
  const pool = newestFirst(models.filter(id => !exclude.includes(id) && !NOT_CHAT.test(id)));
  const ordered = [];
  const push = id => { if (!ordered.includes(id)) ordered.push(id); };

  for (const pattern of MODEL_PREFERENCES[kind] || []) {
    for (const id of pool) if (pattern.test(id)) push(id);
  }
  if (kind === 'image') {
    for (const id of pool) if (!TEXT_ONLY_HINT.test(id)) push(id);
  }
  for (const id of pool) push(id);
  return ordered.slice(0, MAX_MODEL_ATTEMPTS);
}

function listModels(deadline) {
  const cached = cacheGet('catalog', CATALOG_TTL_MS);
  if (cached) return Promise.resolve(cached);

  // Anche la lista deve stare dentro la deadline: se non c'e' piu' tempo,
  // tanto vale non chiederla.
  const budget = Math.min(4000, deadline - Date.now());
  if (budget < 500) return Promise.resolve([]);

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/models',
      method: 'GET',
      agent,
      headers: { 'Authorization': `Bearer ${GROQ_KEY}` },
      timeout: budget
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => { data += c; });
      res.on('end', () => {
        let list = [];
        try {
          const parsed = JSON.parse(data);
          list = Array.isArray(parsed.data) ? parsed.data.map(m => m.id).filter(Boolean).sort() : [];
        } catch {
          list = [];
        }
        // Un elenco vuoto non lo mettiamo in cache: e' quasi sempre un errore
        // di rete, e ricordarselo per dieci minuti servirebbe solo a peggiorare.
        if (list.length) cacheSet('catalog', list);
        resolve(list);
      });
    });
    // Se la lista non arriva restituiamo un elenco vuoto: il chiamante
    // riportera' l'errore originale invece di restare appeso.
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve([]));
    req.end();
  });
}

function json(statusCode, cors, obj) {
  return {
    statusCode,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(obj)
  };
}

// Le istanze delle function vengono riusate a caldo: tenendo viva la connessione
// ci risparmiamo handshake TCP+TLS verso Groq a ogni richiesta.
const agent = new https.Agent({ keepAlive: true, keepAliveMsecs: 1500, maxSockets: 10 });

async function callGroq(requestBody, deadline) {
  try {
    return await sendToGroq(requestBody, deadline);
  } catch (e) {
    // Un socket riusato puo' essere stato chiuso dal server mentre la function
    // era congelata. In quel caso ritentiamo una volta, col tempo che resta.
    const staleSocket = e && (e.code === 'ECONNRESET' || e.code === 'EPIPE');
    if (!staleSocket || deadline - Date.now() < MIN_ATTEMPT_MS) throw e;
    return sendToGroq(requestBody, deadline);
  }
}

function sendToGroq(requestBody, deadline) {
  const payload = JSON.stringify(requestBody);
  return new Promise((resolve, reject) => {
    let guard = null;
    const settle = (fn) => (arg) => { clearTimeout(guard); fn(arg); };
    const ok = settle(resolve);
    const ko = settle(reject);

    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      agent,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Length': Buffer.byteLength(payload)
      },
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
      const err = new Error('Deadline richiesta AI superata');
      err.code = 'AI_TIMEOUT';
      req.destroy(err);
    }, Math.max(1000, deadline - Date.now()));

    req.on('timeout', () => {
      const err = new Error('Timeout richiesta AI');
      err.code = 'AI_TIMEOUT';
      req.destroy(err);
    });
    req.on('error', ko);
    req.write(payload);
    req.end();
  });
}
