const S = require('./lib/shared');

// Lo strumento di ricerca dell'agente: una query di testo -> risultati web e
// annunci con i prezzi che si riescono a leggere. Passa da SerpApi, la stessa
// chiave della ricerca per immagine.
// Su Netlify: Site settings > Environment variables > SERPAPI_KEY
// Senza chiave risponde 501 e la pagina nasconde la scheda, come fa gia' con
// il bottone "Identifica prodotto".
const SERPAPI_KEY = process.env.SERPAPI_KEY || process.env.SERP_API_KEY;

const SERPAPI_HOST = 'serpapi.com';
const TIMEOUT_MS = Number(process.env.RICERCA_TIMEOUT_MS || 9000);
const MAX_BODY = 32 * 1024;
const MAX_QUERY = 160;
const MAX_RISULTATI = 8;
const MAX_CORRELATE = 4;

// L'agente ripete volentieri la stessa query (piano e raffinamento possono
// arrivarci entrambi) e ogni ricerca costa quota: 250 al mese sul piano
// gratuito. Dieci minuti di cache bastano a coprire un'intera sessione.
const CACHE_TTL_MS = 10 * 60 * 1000;

exports.handler = async (event) => {
  const g = S.checkRequest(event, { metodi: ['POST'], richiediToken: true });
  if (g.risposta) return g.risposta;
  const cors = g.cors;

  if (!SERPAPI_KEY) {
    return S.json(501, cors, { error: 'Ricerca online non configurata sul server (SERPAPI_KEY)' });
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');
  if (Buffer.byteLength(rawBody) > MAX_BODY) {
    return S.json(413, cors, { error: 'Richiesta troppo lunga' });
  }

  const deadline = Date.now() + TIMEOUT_MS;

  try {
    let body;
    try { body = JSON.parse(rawBody || '{}'); } catch {
      return S.json(400, cors, { error: 'Richiesta non valida' });
    }

    // La query la scrive un modello: puo' arrivare con newline, virgolette
    // intelligenti e spazi doppi. Normalizzarla qui evita sia una query rotta
    // sia due chiavi di cache diverse per la stessa ricerca.
    const query = String(body.query == null ? '' : body.query)
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, MAX_QUERY);
    if (!query) return S.json(400, cors, { error: 'Query mancante' });

    // "shopping" cerca tra le schede prodotto (prezzi puliti, quasi sempre del
    // nuovo), "web" tra i risultati normali, dove finiscono gli annunci
    // dell'usato: e' li' che sta il prezzo che interessa a chi vende.
    const tipo = body.tipo === 'shopping' ? 'shopping' : 'web';

    const chiave = `ricerca:${tipo}:${query.toLowerCase()}`;
    const inCache = S.cacheGet(chiave, CACHE_TTL_MS);
    if (inCache) return S.json(200, cors, Object.assign({}, inCache, { cache: true }));

    const esito = await cerca(query, tipo, deadline);
    if (!esito.ok) return S.json(esito.status || 502, cors, { error: esito.error });

    S.cacheSet(chiave, esito.dati);
    return S.json(200, cors, esito.dati);

  } catch (e) {
    console.error('ricerca fn error:', e);
    if (e && e.code === 'AI_TIMEOUT') {
      return S.json(504, cors, { error: 'La ricerca ci ha messo troppo. Riprova.' });
    }
    return S.json(500, cors, { error: 'Errore interno del server' });
  }
};

async function cerca(query, tipo, deadline) {
  const parametri = [
    `engine=${tipo === 'shopping' ? 'google_shopping' : 'google'}`,
    `q=${encodeURIComponent(query)}`,
    // Mercato italiano: serve a stimare una vendita su Vinted Italia, quindi
    // dominio, lingua e paese vanno fissati o Google risponde in base all'IP
    // del datacenter di turno.
    'google_domain=google.it',
    'gl=it',
    'hl=it',
    'num=10',
    `api_key=${encodeURIComponent(SERPAPI_KEY)}`
  ].join('&');

  const res = await S.inviaHttp({
    hostname: SERPAPI_HOST,
    path: `/search?${parametri}`,
    method: 'GET',
    headers: {}
  }, null, deadline).catch(e => {
    if (e && e.code === 'AI_TIMEOUT') throw e;
    return { status: 0, body: String(e && e.message || e) };
  });

  let data = null;
  try { data = JSON.parse(res.body); } catch { data = null; }

  if (res.status >= 400 || !data || data.error) {
    // La chiave e la quota residua restano nei log, al client va un messaggio
    // nostro.
    console.error(`SerpApi ricerca ${res.status}: ${((data && data.error) || res.body || '').toString().slice(0, 300)}`);
    return { ok: false, status: statusPerIlClient(res.status), error: erroreLeggibile(res.status) };
  }

  return { ok: true, dati: normalizza(data, query, tipo) };
}

// Della risposta di SerpApi teniamo solo quello che l'agente puo' davvero
// usare: titolo, fonte, link, un pezzo di snippet e il prezzo. Il resto sono
// decine di KB di metadati che finirebbero nel prompt.
function normalizza(data, query, tipo) {
  const grezzi = []
    .concat(Array.isArray(data.shopping_results) ? data.shopping_results : [])
    .concat(Array.isArray(data.organic_results) ? data.organic_results : []);

  const visti = new Set();
  const risultati = [];
  for (const r of grezzi) {
    if (!r) continue;
    const titolo = String(r.title || '').trim();
    if (!titolo) continue;
    const chiave = titolo.toLowerCase().slice(0, 80);
    if (visti.has(chiave)) continue;
    visti.add(chiave);

    const snippet = String(r.snippet || r.description || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    risultati.push({
      titolo: titolo.slice(0, 200),
      fonte: fonteDi(r),
      link: typeof r.link === 'string' && /^https?:\/\//.test(r.link) ? r.link : '',
      snippet,
      prezzo: prezzoDi(r) || prezzoDaTesto(`${snippet} ${titolo}`)
    });
    if (risultati.length >= MAX_RISULTATI) break;
  }

  // Le ricerche correlate sono la cosa piu' utile che Google regala a un
  // agente: sono query vere fatte da persone vere, molto meglio di un
  // raffinamento inventato dal modello.
  const correlate = (Array.isArray(data.related_searches) ? data.related_searches : [])
    .map(r => String((r && r.query) || '').trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, MAX_CORRELATE);

  return {
    query,
    tipo,
    risultati,
    // Solo i prezzi in euro: un listino in dollari nella stessa mediana
    // falserebbe la stima senza che si veda.
    prezzi: S.statistichePrezzi(risultati.map(r => r.prezzo && r.prezzo.valuta === '€' ? r.prezzo.valore : null)),
    correlate
  };
}

function fonteDi(r) {
  const diretta = String(r.source || r.displayed_link || '').trim();
  if (diretta) return diretta.slice(0, 80);
  try {
    return new URL(r.link).host.replace(/^www\./, '').slice(0, 80);
  } catch {
    return '';
  }
}

// SerpApi non e' coerente: le schede shopping hanno extracted_price, i
// risultati organici a volte un oggetto price come quelli di Lens, spesso
// niente.
function prezzoDi(r) {
  const grezzo = typeof r.extracted_price === 'number' ? r.extracted_price
    : (r.price && typeof r.price.extracted_value === 'number' ? r.price.extracted_value : null);
  if (grezzo !== null) return valido(grezzo, valutaDaTesto(String(r.price && r.price.value || r.price || '')));
  const testo = typeof r.price === 'string' ? r.price : (r.price && r.price.value) || '';
  return testo ? prezzoDaTesto(String(testo)) : null;
}

// Nei risultati organici il prezzo sta dentro lo snippet ("... 45,00 € ..."),
// ed e' l'unico posto dove si legge quanto chiedono davvero gli annunci
// dell'usato. E li' l'euro si scrive in tutti i modi: "45 €", "€ 45",
// "45 euro", "Euro 45", "45euro". Il simbolo da solo copriva meno della meta'
// degli annunci italiani.
// Il \b davanti tiene fuori le parole che contengono "eur" ("neurologo"),
// il lookahead dietro fa lo stesso dall'altro lato senza perdere "22euro",
// dove fra la cifra e la parola un confine di parola non c'e'.
const PREZZO_RE = /(?:€|\$|£|\beuro?\b)\s?([\d][\d.,]{0,9})|([\d][\d.,]{0,9})\s?(?:€|\$|£|euro?(?![a-z]))/i;

function prezzoDaTesto(testo) {
  const m = PREZZO_RE.exec(String(testo));
  if (!m) return null;
  return valido(numeroPrezzo(m[1] || m[2]), valutaDaTesto(m[0]));
}

function valutaDaTesto(testo) {
  if (/\$/.test(testo)) return '$';
  if (/£/.test(testo)) return '£';
  return '€';
}

// "45", "45,00", "1.234,50" e "1,234.50" sono lo stesso prezzo scritto da
// quattro siti diversi. L'ultimo separatore e' quello decimale solo se lo
// seguono una o due cifre: in "1.234" quel punto separa le migliaia.
function numeroPrezzo(grezzo) {
  let s = String(grezzo || '').replace(/[^\d.,]/g, '').replace(/[.,]+$/, '');
  if (!s) return null;
  const dec = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  s = dec >= 0 && s.length - dec - 1 <= 2
    ? s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1)
    : s.replace(/[.,]/g, '');
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

// Un anno ("2024"), un numero di articoli o una taglia letti come prezzo
// sposterebbero la mediana senza che nessuno se ne accorga.
const PREZZO_MIN = 1, PREZZO_MAX = 3000;

function valido(valore, valuta) {
  if (typeof valore !== 'number' || !isFinite(valore)) return null;
  if (valore < PREZZO_MIN || valore > PREZZO_MAX) return null;
  return { valore: Math.round(valore * 100) / 100, valuta };
}

function statusPerIlClient(status) {
  if (status === 429) return 429;
  return 502;
}

function erroreLeggibile(status) {
  if (status === 429) return 'Ricerche online esaurite per questo mese.';
  if (status === 401 || status === 403) return 'Il servizio di ricerca ha rifiutato le credenziali del sito.';
  return 'Ricerca online non disponibile al momento. Riprova tra poco.';
}
