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

// Punto di partenza, non una certezza: Groq ritira i modelli senza preavviso.
// Se non esistono piu', la function chiede il catalogo e ripiega da sola.
// Questi due sono quelli verificati sul campo su questo account: partire da
// un modello morto costava un 404 piu' una richiesta del catalogo a ogni
// container nuovo. Le env var, se impostate, hanno la precedenza.
const MODEL_TEXT = process.env.GROQ_MODEL_TEXT || 'openai/gpt-oss-120b';
const MODEL_VISION = process.env.GROQ_MODEL_VISION || 'qwen/qwen3.8-27b';

// Ordine di gradimento, applicato a quello che Groq dichiara disponibile.
const MODEL_PREFERENCES = {
  image: [/llama-4-scout/i, /llama-4-maverick/i, /llama-4/i, /vision/i, /qwen/i],
  text: [/llama-3\.3-70b/i, /llama-3\.[12]-70b/i, /^openai\/gpt-oss/i, /llama-3/i]
};

// Un modello che non esiste piu' non torna esistente entro la vita del
// container: memorizziamo la scelta invece di richiedere la lista ogni volta.
const resolvedModel = {};
let availableModels = null;

// Quanti modelli provare al massimo, e entro quanto tempo. Un modello
// sbagliato viene rifiutato in poche centinaia di ms, ma non possiamo
// sforare il limite di Netlify mentre cerchiamo.
// Un modello che rifiuta risponde in poche centinaia di ms, quindi possiamo
// permetterci di provarne diversi; e' il budget di tempo a fermarci davvero.
const MAX_MODEL_ATTEMPTS = 8;
const PROBE_BUDGET_MS = 5000;

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

  const startedAt = Date.now();

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

    // Se abbiamo gia' scoperto che nessun modello va bene, non rifacciamo
    // tutto il giro di tentativi a ogni foto: rispondiamo subito.
    if (resolvedModel[kind] === false) {
      return json(502, cors, { error: noUsableModelMessage(kind, []) });
    }

    const request = {
      model: resolvedModel[kind] || (kind === 'image' ? MODEL_VISION : MODEL_TEXT),
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

    let result = await callGroq(request);

    // Il catalogo di Groq non dice quali modelli accettano immagini, e i nomi
    // non bastano a indovinarlo. Se il modello e' stato ritirato o rifiuta le
    // foto, proviamo i candidati successivi finche' uno risponde davvero.
    if (needsAnotherModel(result, kind)) {
      const tried = [request.model];
      const candidates = await candidateModels(kind, tried);
      // Distinguiamo "provati tutti" da "finito il tempo": solo nel primo
      // caso possiamo concludere che non esiste un modello adatto.
      let exhausted = true;
      for (const candidate of candidates) {
        if (Date.now() - startedAt > PROBE_BUDGET_MS) { exhausted = false; break; }
        request.model = candidate;
        tried.push(candidate);
        result = await callGroq(request);
        if (!needsAnotherModel(result, kind)) {
          console.log(`Modello ${tried[0]} non utilizzabile, passo a ${candidate}`);
          resolvedModel[kind] = candidate;
          break;
        }
      }
      if (needsAnotherModel(result, kind)) {
        // Abbiamo esaurito i candidati: ricordiamocelo, cosi' la prossima
        // richiesta non ripete tutti i tentativi. Se invece ci siamo fermati
        // per il tempo, non concludiamo niente e riproveremo.
        if (exhausted) resolvedModel[kind] = false;
        return json(502, cors, { error: noUsableModelMessage(kind, tried) });
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

// Messaggio utile invece di un 404 criptico: cosa abbiamo provato, quale
// variabile impostare e l'elenco COMPLETO dei modelli dell'account.
function noUsableModelMessage(kind, tried) {
  const all = availableModels || [];
  return (kind === 'image'
            ? 'Nessun modello di questo account Groq accetta immagini. '
            : 'Nessun modello di testo utilizzabile su Groq. ')
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

async function candidateModels(kind, exclude) {
  const models = await listModels();
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
