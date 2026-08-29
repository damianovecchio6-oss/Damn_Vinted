const https = require('https');

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

const MAX_BODY = 6 * 1024 * 1024;   // 6MB, limite Netlify
const MAX_PROMPT = 8000;            // caratteri
const MAX_IMAGES = 4;

// Netlify chiude le function sincrone a 10s (default account).
// Teniamoci sotto, cosi' restituiamo un errore JSON pulito invece della
// pagina di timeout di Netlify. Alzabile se l'account ha il limite esteso.
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 9000);

// Groq ritira i modelli senza preavviso e l'app si spacca con
// "the model does not exist". Questi sono solo i preferiti: se non esistono
// piu', la function chiede a Groq quali ci sono e ripiega da sola (vedi
// resolveModel). Le env var, se impostate, vengono provate per prime.
const MODEL_TEXT = process.env.GROQ_MODEL_TEXT || 'llama-3.3-70b-versatile';
const MODEL_VISION = process.env.GROQ_MODEL_VISION || 'meta-llama/llama-4-scout-17b-16e-instruct';

// Ordine di gradimento, applicato a quello che Groq dichiara disponibile.
const MODEL_PREFERENCES = {
  image: [/llama-4-scout/i, /llama-4-maverick/i, /llama-4/i, /vision/i],
  text: [/llama-3\.3-70b/i, /llama-3\.[12]-70b/i, /llama-3\.1-8b/i, /^openai\/gpt-oss/i, /llama-3/i]
};

// Un modello che non esiste piu' non torna esistente entro la vita del
// container: memorizziamo la scelta invece di richiedere la lista ogni volta.
const resolvedModel = {};
let availableModels = null;

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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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

exports.handler = async (event) => {
  const headers = lowerKeys(event.headers || {});
  // Su una POST il browser manda sempre Origin, anche same-origin.
  // Il Referer e' solo una rete di sicurezza per i webview che lo omettono.
  const origin = normalizeOrigin(headers.origin) || normalizeOrigin(headers.referer);
  const cors = corsFor(origin, headers);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, cors, { error: 'Metodo non consentito' });
  }
  if (!isAllowed(origin, headers)) {
    return json(403, cors, { error: 'Origine non autorizzata' });
  }
  if (!GROQ_KEY) {
    return json(500, cors, { error: 'Chiave AI non configurata sul server (GROQ_API_KEY o GROQ_KEY)' });
  }
  if (rateLimited(clientIp(headers))) {
    return json(429, cors, { error: 'Troppe richieste, aspetta un minuto.' });
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');
  if (Buffer.byteLength(rawBody) > MAX_BODY) {
    return json(413, cors, { error: 'Immagini troppo pesanti' });
  }

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
    const request = {
      model: resolvedModel[kind] || (kind === 'image' ? MODEL_VISION : MODEL_TEXT),
      messages,
      temperature: type === 'image' ? 0.2 : (body.creative ? 0.85 : 0.6),
      max_tokens: 1024
    };

    // JSON mode: solo per il testo. Sul multimodale non e' garantito,
    // li' ci affidiamo al parsing tollerante lato client.
    const wantsJson = body.json === true && type !== 'image';
    if (wantsJson) request.response_format = { type: 'json_object' };

    let result = await callGroq(request);

    // Modello ritirato da Groq: chiediamo quali esistono e riproviamo con
    // il migliore disponibile, invece di restituire un errore all'utente.
    if (isModelMissing(result)) {
      const fallback = await resolveModel(kind, request.model);
      if (fallback) {
        console.log(`Modello ${request.model} non disponibile, passo a ${fallback}`);
        resolvedModel[kind] = fallback;
        request.model = fallback;
        result = await callGroq(request);
      } else {
        return json(502, cors, {
          error: `Nessun modello ${kind === 'image' ? 'con visione' : 'di testo'} disponibile su Groq. `
               + `Imposta ${kind === 'image' ? 'GROQ_MODEL_VISION' : 'GROQ_MODEL_TEXT'} con uno di: `
               + (availableModels || []).slice(0, 12).join(', ')
        });
      }
    }

    // Se il modello non digerisce response_format, riprova una volta senza.
    if (wantsJson && result.status >= 400 && /response_format|json/i.test(result.body || '')) {
      delete request.response_format;
      result = await callGroq(request);
    }

    let data;
    try {
      data = JSON.parse(result.body);
    } catch {
      return json(502, cors, { error: `Risposta non valida dal modello (HTTP ${result.status})` });
    }

    if (result.status >= 400 || data.error) {
      const msg = typeof data.error === 'string'
        ? data.error
        : (data.error && data.error.message) || `Errore API (HTTP ${result.status})`;
      const friendly = result.status === 429
        ? 'Troppe richieste, riprova tra qualche secondo.'
        : msg;
      return json(result.status >= 400 ? result.status : 502, cors, { error: friendly });
    }

    const text = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : null;
    if (!text) return json(502, cors, { error: 'Il modello ha restituito una risposta vuota' });

    return json(200, cors, { text });

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

// Groq risponde 404 con "does not exist or you do not have access to it"
// quando il modello e' stato ritirato dal catalogo.
function isModelMissing(result) {
  if (!result || result.status !== 404) return false;
  return /does not exist|model_not_found|decommissioned/i.test(result.body || '');
}

// Chiede a Groq il catalogo e sceglie il primo modello che soddisfa le
// preferenze per questo tipo di richiesta, escludendo quello appena fallito.
async function resolveModel(kind, failedModel) {
  const models = await listModels();
  if (!models.length) return null;
  const candidates = models.filter(id => id !== failedModel);
  for (const pattern of MODEL_PREFERENCES[kind] || []) {
    const hit = candidates.find(id => pattern.test(id));
    if (hit) return hit;
  }
  // Per il testo qualunque modello e' meglio di un errore; per le immagini
  // no: un modello senza visione rifiuterebbe comunque la richiesta.
  return kind === 'text' ? (candidates[0] || null) : null;
}

function listModels() {
  if (availableModels) return Promise.resolve(availableModels);
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/models',
      method: 'GET',
      agent,
      headers: { 'Authorization': `Bearer ${GROQ_KEY}` },
      timeout: 4000
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          availableModels = Array.isArray(parsed.data)
            ? parsed.data.map(m => m.id).filter(Boolean).sort()
            : [];
        } catch {
          availableModels = [];
        }
        resolve(availableModels);
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
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  };
}

// Le istanze delle function vengono riusate a caldo: tenendo viva la connessione
// ci risparmiamo handshake TCP+TLS verso Groq a ogni richiesta.
const agent = new https.Agent({ keepAlive: true, keepAliveMsecs: 1500, maxSockets: 10 });

async function callGroq(requestBody) {
  const deadline = Date.now() + TIMEOUT_MS;
  try {
    return await sendToGroq(requestBody, deadline);
  } catch (e) {
    // Un socket riusato puo' essere stato chiuso dal server mentre la function
    // era congelata. In quel caso ritentiamo una volta, col tempo che resta.
    const staleSocket = e && (e.code === 'ECONNRESET' || e.code === 'EPIPE');
    if (!staleSocket || Date.now() >= deadline) throw e;
    return sendToGroq(requestBody, deadline);
  }
}

function sendToGroq(requestBody, deadline) {
  const payload = JSON.stringify(requestBody);
  return new Promise((resolve, reject) => {
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
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('timeout', () => {
      const err = new Error('Timeout richiesta AI');
      err.code = 'AI_TIMEOUT';
      req.destroy(err);
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
