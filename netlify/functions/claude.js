const https = require('https');

// La chiave NON sta piu' nel codice.
// Su Netlify: Site settings > Environment variables > GROQ_API_KEY
const GROQ_KEY = process.env.GROQ_API_KEY;

// Metti qui il dominio del tuo sito per impedire che altri usino la tua chiave.
// Esempio: ['https://vinted-damn.netlify.app', 'http://localhost:8888']
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

const MAX_BODY = 6 * 1024 * 1024; // 6MB, limite Netlify
const TIMEOUT_MS = 25000;

function corsFor(origin) {
  let allow = 'null';
  if (ALLOWED_ORIGINS.length === 0) allow = origin || '*';       // dev: nessuna lista = passa tutto
  else if (origin && ALLOWED_ORIGINS.includes(origin)) allow = origin;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const cors = corsFor(origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, cors, { error: 'Metodo non consentito' });
  }
  if (ALLOWED_ORIGINS.length > 0 && cors['Access-Control-Allow-Origin'] === 'null') {
    return json(403, cors, { error: 'Origine non autorizzata' });
  }
  if (!GROQ_KEY) {
    return json(500, cors, { error: 'GROQ_API_KEY non configurata sul server' });
  }
  if (event.body && event.body.length > MAX_BODY) {
    return json(413, cors, { error: 'Immagine troppo pesante' });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { type, prompt } = body;

    if (typeof prompt !== 'string' || !prompt.trim()) {
      return json(400, cors, { error: 'Prompt mancante' });
    }

    // Accetta sia il formato nuovo (images: [...]) sia quello vecchio (imageBase64)
    let images = Array.isArray(body.images) ? body.images : [];
    if (!images.length && body.imageBase64) {
      images = [{ base64: body.imageBase64, mime: body.imageMime }];
    }
    images = images.slice(0, 4);

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

    const payload = JSON.stringify({
      model: type === 'image'
        ? 'meta-llama/llama-4-scout-17b-16e-instruct'
        : 'llama-3.3-70b-versatile',
      messages,
      temperature: type === 'image' ? 0.2 : 0.6,
      max_tokens: 1024
    });

    const result = await request(payload);

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
      // 429 = quota/rate limit, messaggio piu' chiaro per l'utente
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
    // Non rimandiamo mai stack o dettagli interni al client
    return json(500, cors, { error: 'Errore interno del server' });
  }
};

function json(statusCode, cors, obj) {
  return {
    statusCode,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  };
}

function request(payload) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: TIMEOUT_MS
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('timeout', () => { req.destroy(new Error('Timeout richiesta AI')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
