const https = require('https');

// La chiave NON sta nel codice.
// Su Netlify: Site settings > Environment variables > GROQ_API_KEY
// Accettiamo anche GROQ_KEY: e' il nome usato storicamente su questo sito,
// e la rinomina del codice a GROQ_API_KEY aveva lasciato la function senza chiave.
const GROQ_KEY = process.env.GROQ_API_KEY || process.env.GROQ_KEY;

// Allowlist delle origini. Di default CHIUSA: se non c'e' nessuna origine valida
// la function rifiuta tutto, invece di diventare un proxy aperto sulla chiave.
// Oltre a ALLOWED_ORIGINS (lista separata da virgole) accetta in automatico gli
// URL che Netlify inietta da sola nel build, cosi' il sito funziona senza config.
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

const MODEL_TEXT = process.env.GROQ_MODEL_TEXT || 'llama-3.3-70b-versatile';
const MODEL_VISION = process.env.GROQ_MODEL_VISION || 'meta-llama/llama-4-scout-17b-16e-instruct';

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

function isAllowed(origin) {
  return !!origin && ALLOWED_ORIGINS.includes(origin);
}

function corsFor(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
  if (isAllowed(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
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
  const cors = corsFor(origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, cors, { error: 'Metodo non consentito' });
  }
  if (!ALLOWED_ORIGINS.length) {
    console.error('Nessuna origine autorizzata: imposta ALLOWED_ORIGINS nelle env var del sito.');
    return json(500, cors, { error: 'Server non configurato: manca ALLOWED_ORIGINS' });
  }
  if (!isAllowed(origin)) {
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

    const request = {
      model: type === 'image' ? MODEL_VISION : MODEL_TEXT,
      messages,
      temperature: type === 'image' ? 0.2 : (body.creative ? 0.85 : 0.6),
      max_tokens: 1024
    };

    // JSON mode: solo per il testo. Sul multimodale non e' garantito,
    // li' ci affidiamo al parsing tollerante lato client.
    const wantsJson = body.json === true && type !== 'image';
    if (wantsJson) request.response_format = { type: 'json_object' };

    let result = await callGroq(request);

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
