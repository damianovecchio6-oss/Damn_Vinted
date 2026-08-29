const https = require('https');
const S = require('./lib/shared');

// Ricerca per immagine via SerpApi (Google Lens).
// Su Netlify: Site settings > Environment variables > SERPAPI_KEY
// Piano gratuito: 250 ricerche al mese. Senza chiave la function risponde 501
// e la pagina nasconde il bottone, quindi non si rompe niente.
const SERPAPI_KEY = process.env.SERPAPI_KEY || process.env.SERP_API_KEY;

const SERPAPI_HOST = 'serpapi.com';
// Il limite dell'endpoint di upload di SerpApi e' 500KB di file binario.
// Teniamoci sotto: la pagina manda gia' un JPEG piccolo, questo e' il paracadute.
const MAX_IMAGE_BYTES = 480 * 1024;
const MAX_BODY = 1.5 * 1024 * 1024;
const TIMEOUT_MS = Number(process.env.LENS_TIMEOUT_MS || 9000);
// Due round trip da fare dentro i 10s di Netlify: l'upload e' veloce, la
// ricerca no, quindi il grosso del budget va alla seconda.
const UPLOAD_BUDGET_MS = 3500;
const MAX_RISULTATI = 8;

exports.handler = async (event) => {
  const g = S.checkRequest(event, { metodi: ['POST'], richiediToken: true });
  if (g.risposta) return g.risposta;
  const cors = g.cors;

  if (!SERPAPI_KEY) {
    return S.json(501, cors, { error: 'Ricerca per immagine non configurata sul server (SERPAPI_KEY)' });
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');
  if (Buffer.byteLength(rawBody) > MAX_BODY) {
    return S.json(413, cors, { error: 'Immagine troppo pesante' });
  }

  const deadline = Date.now() + TIMEOUT_MS;

  try {
    let body;
    try { body = JSON.parse(rawBody || '{}'); } catch {
      return S.json(400, cors, { error: 'Richiesta non valida' });
    }

    if (typeof body.image !== 'string' || !body.image) {
      return S.json(400, cors, { error: 'Nessuna immagine ricevuta' });
    }
    let binario;
    try {
      binario = Buffer.from(body.image, 'base64');
    } catch {
      return S.json(400, cors, { error: 'Immagine non valida' });
    }
    if (!binario.length) return S.json(400, cors, { error: 'Immagine non valida' });
    if (binario.length > MAX_IMAGE_BYTES) {
      return S.json(413, cors, { error: 'Immagine troppo pesante per la ricerca (max 480KB)' });
    }

    // Google Lens vuole un'immagine raggiungibile via URL. Invece di pubblicare
    // le foto dell'utente da qualche parte, si passa dall'endpoint di upload di
    // SerpApi, che restituisce un id da usare al posto dell'URL.
    const imageId = await caricaImmagine(binario, Math.min(deadline, Date.now() + UPLOAD_BUDGET_MS));
    if (!imageId.ok) return S.json(imageId.status || 502, cors, { error: imageId.error });

    const esito = await cercaLens(imageId.id, deadline);
    if (!esito.ok) return S.json(esito.status || 502, cors, { error: esito.error });

    return S.json(200, cors, esito.dati);

  } catch (e) {
    console.error('lens fn error:', e);
    if (e && e.code === 'AI_TIMEOUT') {
      return S.json(504, cors, { error: 'La ricerca ci ha messo troppo. Riprova.' });
    }
    return S.json(500, cors, { error: 'Errore interno del server' });
  }
};

// multipart/form-data a mano: e' l'unico posto del progetto che ne ha bisogno
// e non vale una dipendenza npm su un sito senza package.json.
function corpoMultipart(binario, boundary) {
  const testa = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="api_key"\r\n\r\n${SERPAPI_KEY}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="image"; filename="capo.jpg"\r\n` +
    `Content-Type: image/jpeg\r\n\r\n`, 'utf8');
  const coda = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return Buffer.concat([testa, binario, coda]);
}

async function caricaImmagine(binario, deadline) {
  const boundary = '----damnvinted' + Date.now().toString(36);
  const payload = corpoMultipart(binario, boundary);

  const res = await inviaHttp({
    hostname: SERPAPI_HOST,
    path: '/image',
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }
  }, payload, deadline).catch(e => {
    if (e && e.code === 'AI_TIMEOUT') throw e;
    return { status: 0, body: String(e && e.message || e) };
  });

  let data = null;
  try { data = JSON.parse(res.body); } catch { data = null; }

  if (res.status >= 400 || !data || !data.image_id) {
    // La chiave e la quota residua non le raccontiamo al client.
    console.error(`SerpApi upload ${res.status}: ${(res.body || '').slice(0, 300)}`);
    return { ok: false, status: statusPerIlClient(res.status), error: erroreLeggibile(res.status) };
  }
  return { ok: true, id: data.image_id };
}

async function cercaLens(imageId, deadline) {
  const query = [
    'engine=google_lens',
    `image_id=${encodeURIComponent(imageId)}`,
    // Mercato italiano: i prezzi che tornano servono a stimare una vendita
    // su Vinted Italia, non su amazon.com.
    'country=it',
    'hl=it',
    `api_key=${encodeURIComponent(SERPAPI_KEY)}`
  ].join('&');

  const res = await inviaHttp({
    hostname: SERPAPI_HOST,
    path: `/search?${query}`,
    method: 'GET',
    headers: {}
  }, null, deadline).catch(e => {
    if (e && e.code === 'AI_TIMEOUT') throw e;
    return { status: 0, body: String(e && e.message || e) };
  });

  let data = null;
  try { data = JSON.parse(res.body); } catch { data = null; }

  if (res.status >= 400 || !data || data.error) {
    console.error(`SerpApi lens ${res.status}: ${((data && data.error) || res.body || '').toString().slice(0, 300)}`);
    return { ok: false, status: statusPerIlClient(res.status), error: erroreLeggibile(res.status) };
  }

  return { ok: true, dati: normalizza(data) };
}

// Di tutta la risposta di Lens ci interessano i prodotti riconosciuti e i loro
// prezzi: il resto (thumbnail base64, token di paginazione, metadati) sarebbe
// solo peso da mandare al telefono.
function normalizza(data) {
  const grezzi = []
    .concat(Array.isArray(data.exact_matches) ? data.exact_matches : [])
    .concat(Array.isArray(data.visual_matches) ? data.visual_matches : []);

  const visti = new Set();
  const risultati = [];
  for (const m of grezzi) {
    if (!m || !m.title) continue;
    const chiave = String(m.title).toLowerCase().slice(0, 80);
    if (visti.has(chiave)) continue;
    visti.add(chiave);
    risultati.push({
      titolo: String(m.title).slice(0, 200),
      fonte: String(m.source || '').slice(0, 80),
      link: typeof m.link === 'string' && /^https?:\/\//.test(m.link) ? m.link : '',
      prezzo: prezzoDi(m),
      thumbnail: typeof m.thumbnail === 'string' && /^https:\/\//.test(m.thumbnail) ? m.thumbnail : ''
    });
    if (risultati.length >= MAX_RISULTATI) break;
  }

  return {
    // "best guess" di Lens: spesso e' gia' il nome del prodotto.
    ipotesi: (data.related_content && data.related_content[0] && data.related_content[0].query)
             || (data.knowledge_graph && data.knowledge_graph[0] && data.knowledge_graph[0].title)
             || '',
    risultati,
    prezzi: statistichePrezzi(risultati)
  };
}

function prezzoDi(m) {
  const p = m && m.price;
  if (!p) return null;
  const valore = typeof p.extracted_value === 'number' ? p.extracted_value : parseFloat(p.value);
  if (!isFinite(valore) || valore <= 0) return null;
  return { valore: Math.round(valore * 100) / 100, valuta: String(p.currency || '€').slice(0, 3) };
}

// Il prezzo che serve a chi vende su Vinted non e' la media dei listini: e' la
// mediana, che non si fa trascinare dal negozio fuori mercato di turno.
function statistichePrezzi(risultati) {
  const valori = risultati.map(r => r.prezzo && r.prezzo.valore).filter(v => typeof v === 'number').sort((a, b) => a - b);
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

function statusPerIlClient(status) {
  if (status === 429) return 429;
  return 502;
}

function erroreLeggibile(status) {
  if (status === 429) return 'Ricerche per immagine esaurite per questo mese.';
  if (status === 401 || status === 403) return 'Il servizio di ricerca ha rifiutato le credenziali del sito.';
  return 'Ricerca per immagine non disponibile al momento. Riprova tra poco.';
}

const agent = new https.Agent({ keepAlive: true, keepAliveMsecs: 1500, maxSockets: 10 });

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

    guard = setTimeout(() => {
      const err = new Error('Deadline ricerca superata');
      err.code = 'AI_TIMEOUT';
      req.destroy(err);
    }, Math.max(1000, deadline - Date.now()));

    req.on('timeout', () => {
      const err = new Error('Timeout ricerca');
      err.code = 'AI_TIMEOUT';
      req.destroy(err);
    });
    req.on('error', ko);
    if (payload) req.write(payload);
    req.end();
  });
}
