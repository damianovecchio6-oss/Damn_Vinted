const S = require('./lib/shared');

// Le chiavi NON stanno nel codice.
// Su Netlify: Site settings > Environment variables.
//   GROQ_API_KEY   - obbligatoria (accettata anche col vecchio nome GROQ_KEY)
//   GEMINI_API_KEY - opzionale. Se c'e', le foto le guarda Gemini invece di
//                    Groq: legge molto meglio il testo piccolo di un'etichetta,
//                    che e' da dove arrivano marca, composizione e taglia.
const GROQ_KEY = S.GROQ_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_KEY;

const MAX_BODY = 6 * 1024 * 1024;   // 6MB, limite Netlify
const MAX_PROMPT = 8000;            // caratteri
const MAX_IMAGES = 4;

// Netlify chiude le function sincrone a 10s (default account).
// Teniamoci sotto, cosi' restituiamo un errore JSON pulito invece della
// pagina di timeout di Netlify. Alzabile se l'account ha il limite esteso.
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 9000);

// Punto di partenza, non una certezza: i provider ritirano i modelli senza
// preavviso. Se non esistono piu', la function chiede il catalogo e ripiega
// da sola. Le env var, se impostate, hanno la precedenza.
const MODEL_TEXT = process.env.GROQ_MODEL_TEXT || 'openai/gpt-oss-120b';
const MODEL_VISION = process.env.GROQ_MODEL_VISION || 'meta-llama/llama-4-scout-17b-16e-instruct';
const GEMINI_MODEL = process.env.GEMINI_MODEL || '';

// Ordine di gradimento, applicato a quello che il provider dichiara disponibile.
const MODEL_PREFERENCES = {
  image: [/llama-4-scout/i, /llama-4-maverick/i, /llama-4/i, /vision/i, /qwen/i],
  text: [/llama-3\.3-70b/i, /llama-3\.[12]-70b/i, /^openai\/gpt-oss/i, /llama-3/i]
};

const POSITIVE_TTL_MS = 30 * 60 * 1000;  // "questo modello funziona"
const NEGATIVE_TTL_MS = 5 * 60 * 1000;   // "nessun modello funziona"
const CATALOG_TTL_MS = 10 * 60 * 1000;   // elenco modelli dell'account

// Quanti modelli provare al massimo. Un modello sbagliato viene rifiutato in
// poche centinaia di ms, quindi possiamo permetterci di provarne diversi;
// e' il budget di tempo a fermarci davvero (vedi la deadline unica).
const MAX_MODEL_ATTEMPTS = 8;
// Sotto questo margine non ha senso iniziare un altro tentativo: non farebbe
// in tempo a rispondere prima che Netlify chiuda la function.
const MIN_ATTEMPT_MS = 1200;

// Un modello che funziona lo teniamo a lungo, un "non ce n'e' nessuno" poco:
// il secondo e' molto piu' spesso una condizione temporanea.
function resolvedModel(key) {
  const hit = S.cachePeek(key);
  if (!hit) return undefined;
  return S.cacheGet(key, hit.value === false ? NEGATIVE_TTL_MS : POSITIVE_TTL_MS);
}

exports.handler = async (event) => {
  const g = S.checkRequest(event, { metodi: ['GET', 'POST'], richiediToken: event.httpMethod === 'POST' });
  if (g.risposta) return g.risposta;
  const cors = g.cors;

  if (!GROQ_KEY && !GEMINI_KEY) {
    return S.json(500, cors, { error: 'Nessuna chiave AI configurata sul server (GROQ_API_KEY o GEMINI_API_KEY)' });
  }

  // GET = "dammi un token per le prossime richieste".
  if (event.httpMethod === 'GET') {
    return S.json(200, cors, { token: S.issueToken(g.ip), expiresIn: S.SESSION_TTL_MS });
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');
  if (Buffer.byteLength(rawBody) > MAX_BODY) {
    return S.json(413, cors, { error: 'Immagini troppo pesanti' });
  }

  // Una sola deadline per tutta la richiesta, tentativi di fallback inclusi.
  const deadline = Date.now() + TIMEOUT_MS;

  try {
    let body;
    try {
      body = JSON.parse(rawBody || '{}');
    } catch {
      return S.json(400, cors, { error: 'Richiesta non valida' });
    }

    const { type, prompt } = body;

    if (typeof prompt !== 'string' || !prompt.trim()) {
      return S.json(400, cors, { error: 'Prompt mancante' });
    }
    if (prompt.length > MAX_PROMPT) {
      return S.json(400, cors, { error: 'Prompt troppo lungo' });
    }

    // Accetta sia il formato nuovo (images: [...]) sia quello vecchio (imageBase64)
    let images = Array.isArray(body.images) ? body.images : [];
    if (!images.length && body.imageBase64) {
      images = [{ base64: body.imageBase64, mime: body.imageMime }];
    }
    images = images.slice(0, MAX_IMAGES)
      .filter(img => img && typeof img.base64 === 'string' && img.base64)
      .map(img => ({ base64: img.base64, mime: img.mime === 'image/png' ? 'image/png' : 'image/jpeg' }));

    const kind = type === 'image' ? 'image' : 'text';
    if (kind === 'image' && !images.length) {
      return S.json(400, cors, { error: 'Nessuna immagine valida ricevuta' });
    }

    const richiesta = {
      prompt,
      images: kind === 'image' ? images : [],
      temperature: kind === 'image' ? 0.2 : (body.creative ? 0.85 : 0.6),
      // Il JSON dell'analisi foto ha molti campi con testo libero: a 1024
      // token rischiava di troncarsi a meta' e diventare impossibile da
      // interpretare, il che si vede come "analisi imprecisa".
      maxTokens: kind === 'image' ? 2048 : 1024,
      json: body.json === true
    };

    // Gemini guarda le foto meglio di quello che offre Groq, quindi quando la
    // chiave c'e' le immagini vanno li'. Il testo resta su Groq, che e' piu'
    // veloce e ha limiti piu' larghi: cosi' non bruciamo la quota gratuita di
    // Gemini con le stime di prezzo.
    const usaGemini = GEMINI_KEY && (kind === 'image' || !GROQ_KEY);

    let esito;
    if (usaGemini) {
      esito = await tentaGemini(richiesta, kind, deadline);
      // Quota giornaliera finita o modello sparito: se abbiamo anche Groq e
      // resta tempo, meglio una risposta di Groq che un errore.
      if (!esito.ok && GROQ_KEY && deadline - Date.now() >= MIN_ATTEMPT_MS) {
        console.error(`Gemini non utilizzabile (${esito.motivo}), ripiego su Groq`);
        esito = await tentaGroq(richiesta, kind, deadline);
      }
    } else {
      esito = await tentaGroq(richiesta, kind, deadline);
    }

    if (!esito.ok) return S.json(esito.status || 502, cors, { error: esito.error });

    // Rimandiamo anche chi ha risposto: serve a capire da cosa dipende la
    // qualita' dell'analisi e quale modello conviene fissare a mano.
    return S.json(200, cors, { text: esito.text, model: esito.model, provider: esito.provider });

  } catch (e) {
    console.error('claude fn error:', e);
    if (e && e.code === 'AI_TIMEOUT') {
      return S.json(504, cors, { error: 'L\'AI ci ha messo troppo. Riprova.' });
    }
    // Non rimandiamo mai stack o dettagli interni al client
    return S.json(500, cors, { error: 'Errore interno del server' });
  }
};

/* ============================ GEMINI ============================ */

const GEMINI_HOST = 'generativelanguage.googleapis.com';

// I nomi dei modelli Gemini cambiano spesso (2.5, 3.5, 3.7 flash...), quindi
// non ne cabliamo nessuno: chiediamo il catalogo e prendiamo il flash piu'
// recente che sappia fare generateContent. GEMINI_MODEL scavalca tutto.
const NON_TESTUALI = /embedding|aqa|imagen|veo|tts|native-audio|live-|image-generation/i;

function punteggioGemini(name) {
  const versione = (name.match(/gemini-(\d+(?:\.\d+)?)/i) || [])[1];
  let p = versione ? Number(versione) * 100 : 0;
  // Flash: veloce e con limiti gratuiti piu' generosi. Pro: piu' bravo ma
  // molto piu' lento, e i 10s di Netlify non lo perdonano.
  if (/flash/i.test(name)) p += 50;
  if (/pro/i.test(name)) p += 20;
  // Il lite va in fondo: e' proprio sul testo piccolo di un'etichetta che
  // perde, ed e' l'unica cosa per cui siamo qui. Penalita' abbastanza grossa
  // da non pareggiare mai con un pro o un preview della stessa generazione.
  if (/lite/i.test(name)) p -= 80;
  if (/preview|exp/i.test(name)) p -= 10;
  return p;
}

function listaGemini(deadline) {
  const cached = S.cacheGet('gemini:catalog', CATALOG_TTL_MS);
  if (cached) return Promise.resolve(cached);

  const budget = Math.min(4000, deadline - Date.now());
  if (budget < 500) return Promise.resolve([]);

  return richiestaHttp({
    hostname: GEMINI_HOST,
    path: '/v1beta/models?pageSize=200',
    method: 'GET',
    headers: { 'x-goog-api-key': GEMINI_KEY }
  }, null, Date.now() + budget).then(res => {
    let lista = [];
    try {
      const parsed = JSON.parse(res.body);
      lista = (parsed.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => String(m.name || '').replace(/^models\//, ''))
        .filter(id => id && !NON_TESTUALI.test(id))
        .sort((a, b) => punteggioGemini(b) - punteggioGemini(a));
    } catch {
      lista = [];
    }
    if (lista.length) S.cacheSet('gemini:catalog', lista);
    return lista;
  }).catch(() => []);
}

// Il formato di Gemini non e' quello di OpenAI: contents/parts invece di
// messages, e le immagini vanno in inline_data gia' decodificate dal data URL.
function corpoGemini(richiesta) {
  const parts = [{ text: richiesta.prompt }];
  for (const img of richiesta.images) {
    parts.push({ inline_data: { mime_type: img.mime, data: img.base64 } });
  }
  const generationConfig = {
    temperature: richiesta.temperature,
    maxOutputTokens: richiesta.maxTokens
  };
  // Qui sta un guadagno che con Groq non avevamo: Gemini garantisce il JSON
  // anche sulle richieste con immagini, quindi l'analisi foto smette di
  // dipendere dal parsing tollerante lato client.
  if (richiesta.json) generationConfig.responseMimeType = 'application/json';
  return { contents: [{ role: 'user', parts }], generationConfig };
}

function testoGemini(data) {
  const cand = data && data.candidates && data.candidates[0];
  if (!cand) return null;
  const parts = (cand.content && cand.content.parts) || [];
  const testo = parts.map(p => p.text || '').join('').trim();
  return testo || null;
}

async function tentaGemini(richiesta, kind, deadline) {
  const candidati = [];
  if (GEMINI_MODEL) candidati.push(GEMINI_MODEL);
  const cacheKey = `gemini:model:${kind}`;
  const noto = resolvedModel(cacheKey);
  if (noto === false) return { ok: false, motivo: 'nessun modello (in cache)' };
  if (noto) candidati.push(noto);
  for (const id of await listaGemini(deadline)) candidati.push(id);

  const provati = [];
  for (const modello of candidati.slice(0, MAX_MODEL_ATTEMPTS)) {
    if (provati.includes(modello)) continue;
    if (deadline - Date.now() < MIN_ATTEMPT_MS) break;
    provati.push(modello);

    const res = await richiestaHttp({
      hostname: GEMINI_HOST,
      path: `/v1beta/models/${encodeURIComponent(modello)}:generateContent`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY }
    }, JSON.stringify(corpoGemini(richiesta)), deadline).catch(e => {
      if (e && e.code === 'AI_TIMEOUT') throw e;
      return { status: 0, body: String(e && e.message || e) };
    });

    // 404 = modello inesistente, si prova il prossimo. 429 = quota gratuita
    // finita per oggi: cambiare modello non aiuta, si esce subito.
    if (res.status === 404) continue;
    if (res.status === 429) return { ok: false, motivo: 'quota giornaliera esaurita' };
    if (res.status >= 400 || res.status === 0) {
      console.error(`Gemini ${res.status} su ${modello}: ${(res.body || '').slice(0, 300)}`);
      return { ok: false, motivo: `HTTP ${res.status}` };
    }

    let data;
    try { data = JSON.parse(res.body); } catch { return { ok: false, motivo: 'risposta non JSON' }; }
    const text = testoGemini(data);
    if (!text) {
      // Succede quando il filtro di sicurezza blocca la risposta: e' un caso
      // reale su foto di persone, e cambiare modello non lo risolve.
      const stop = data.candidates && data.candidates[0] && data.candidates[0].finishReason;
      console.error(`Gemini ha risposto vuoto su ${modello} (finishReason: ${stop})`);
      return { ok: false, motivo: `risposta vuota (${stop || 'ignoto'})` };
    }
    S.cacheSet(cacheKey, modello);
    return { ok: true, text, model: modello, provider: 'gemini' };
  }

  if (provati.length) S.cacheSet(cacheKey, false);
  console.error(`Nessun modello Gemini utilizzabile per "${kind}". Provati: ${provati.join(', ') || 'nessuno'}`);
  return { ok: false, motivo: 'nessun modello utilizzabile' };
}

/* ============================= GROQ ============================= */

const GROQ_HOST = 'api.groq.com';

function corpoGroq(richiesta, modello) {
  let content;
  if (richiesta.images.length) {
    content = [{ type: 'text', text: richiesta.prompt }];
    for (const img of richiesta.images) {
      content.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } });
    }
  } else {
    content = richiesta.prompt;
  }
  const out = {
    model: modello,
    messages: [{ role: 'user', content }],
    temperature: richiesta.temperature,
    max_tokens: richiesta.maxTokens
  };
  // JSON mode: solo per il testo. Sul multimodale di Groq non e' garantito,
  // li' ci affidiamo al parsing tollerante lato client.
  if (richiesta.json && !richiesta.images.length) out.response_format = { type: 'json_object' };
  return out;
}

function chiamataGroq(richiesta, modello, deadline) {
  return richiestaHttp({
    hostname: GROQ_HOST,
    path: '/openai/v1/chat/completions',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` }
  }, JSON.stringify(corpoGroq(richiesta, modello)), deadline);
}

async function tentaGroq(richiesta, kind, deadline) {
  const cacheKey = `groq:model:${kind}`;
  const noto = resolvedModel(cacheKey);

  // Se poco fa abbiamo scoperto che nessun modello va bene, non rifacciamo
  // tutto il giro di tentativi a ogni foto: rispondiamo subito. Passata la
  // scadenza della cache negativa, invece, si riprova da capo.
  if (noto === false) {
    return { ok: false, status: 502, error: messaggioNessunModello(kind), motivo: 'nessun modello (in cache)' };
  }

  let modello = noto || (kind === 'image' ? MODEL_VISION : MODEL_TEXT);
  let res = await chiamataGroq(richiesta, modello, deadline);

  // Il catalogo di Groq non dice quali modelli accettano immagini, e i nomi
  // non bastano a indovinarlo. Se il modello e' stato ritirato o rifiuta le
  // foto, proviamo i candidati successivi finche' uno risponde davvero.
  if (serveUnAltroModello(res, kind)) {
    const provati = [modello];
    const candidati = await candidatiGroq(kind, provati, deadline);
    // Distinguiamo "provati tutti" da "finito il tempo": solo nel primo caso
    // possiamo concludere che non esiste un modello adatto.
    let esauriti = true;
    for (const candidato of candidati) {
      if (deadline - Date.now() < MIN_ATTEMPT_MS) { esauriti = false; break; }
      modello = candidato;
      provati.push(candidato);
      res = await chiamataGroq(richiesta, candidato, deadline);
      if (!serveUnAltroModello(res, kind)) {
        console.log(`Modello ${provati[0]} non utilizzabile, passo a ${candidato}`);
        S.cacheSet(cacheKey, candidato);
        break;
      }
    }
    if (serveUnAltroModello(res, kind)) {
      if (esauriti) S.cacheSet(cacheKey, false);
      // Il dettaglio (cosa abbiamo provato, cosa offre l'account) serve a chi
      // gestisce il sito e sta nei log: al client non diciamo com'e' fatto
      // dentro. Le env var sono GROQ_MODEL_TEXT / GROQ_MODEL_VISION.
      console.error(dettaglioNessunModello(kind, provati));
      return { ok: false, status: 502, error: messaggioNessunModello(kind), motivo: 'nessun modello utilizzabile' };
    }
  }

  // Se il modello non digerisce response_format, riprova una volta senza.
  if (richiesta.json && !richiesta.images.length && res.status >= 400
      && /response_format|json/i.test(res.body || '')
      && deadline - Date.now() >= MIN_ATTEMPT_MS) {
    res = await chiamataGroq(Object.assign({}, richiesta, { json: false }), modello, deadline);
  }

  let data;
  try {
    data = JSON.parse(res.body);
  } catch {
    console.error(`Risposta non JSON da Groq (HTTP ${res.status}): ${(res.body || '').slice(0, 300)}`);
    return { ok: false, status: 502, error: 'Il servizio AI ha risposto in modo inatteso. Riprova.', motivo: 'risposta non JSON' };
  }

  if (res.status >= 400 || data.error) {
    const dettaglio = typeof data.error === 'string'
      ? data.error
      : (data.error && data.error.message) || `HTTP ${res.status}`;
    // Il testo di Groq puo' contenere id di organizzazione, nomi di modello e
    // dettagli di quota: resta nei log, al client va un messaggio nostro.
    console.error(`Groq ${res.status} su ${modello}: ${dettaglio}`);
    return { ok: false, status: statusPerIlClient(res.status), error: erroreLeggibile(res.status), motivo: `HTTP ${res.status}` };
  }

  const text = data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : null;
  if (!text) return { ok: false, status: 502, error: 'Il modello ha restituito una risposta vuota', motivo: 'risposta vuota' };

  return { ok: true, text, model: modello, provider: 'groq' };
}

// Lo status del provider non va rimandato tale e quale: un 401 upstream
// (chiave nostra scaduta) davanti al client significherebbe "token di sessione
// non valido" e lo manderebbe a rinnovarlo per niente.
function statusPerIlClient(status) {
  if (status === 429) return 429;
  if (status === 408 || status === 504) return 504;
  return 502;
}

function erroreLeggibile(status) {
  if (status === 429) return 'Troppe richieste, riprova tra qualche secondo.';
  if (status === 401 || status === 403) return 'Il servizio AI ha rifiutato le credenziali del sito.';
  if (status === 413) return 'Richiesta troppo pesante per il modello. Prova con meno foto.';
  if (status === 400) return 'Il modello ha rifiutato la richiesta. Riprova.';
  return 'Servizio AI non disponibile al momento. Riprova tra poco.';
}

// Al client basta sapere che ora non si puo' fare e che vale la pena riprovare.
function messaggioNessunModello(kind) {
  return kind === 'image'
    ? 'Nessun modello disponibile per l\'analisi foto in questo momento. Riprova tra qualche minuto.'
    : 'Nessun modello di testo disponibile in questo momento. Riprova tra qualche minuto.';
}

// Questo invece finisce solo nei log della function.
function dettaglioNessunModello(kind, provati) {
  const tutti = S.cacheGet('groq:catalog', CATALOG_TTL_MS) || [];
  return `Nessun modello Groq utilizzabile per "${kind}". `
       + (provati.length ? `Provati: ${provati.join(', ')}. ` : '')
       + `Imposta ${kind === 'image' ? 'GROQ_MODEL_VISION' : 'GROQ_MODEL_TEXT'} `
       + `con uno di questi ${tutti.length} modelli: ${tutti.join(', ')}`;
}

// Groq risponde 404 con "does not exist or you do not have access to it"
// quando il modello e' stato ritirato dal catalogo.
function modelloSparito(res) {
  if (!res || res.status !== 404) return false;
  return /does not exist|model_not_found|decommissioned/i.test(res.body || '');
}

// Vale la pena provare un altro modello? Sia se questo non esiste piu', sia
// se esiste ma rifiuta le immagini: Groq lo segnala con un 400 che parla di
// image/vision/multimodal.
function serveUnAltroModello(res, kind) {
  if (modelloSparito(res)) return true;
  if (kind !== 'image' || !res || res.status !== 400) return false;
  return /image|vision|multimodal|modality/i.test(res.body || '');
}

// Modelli che non sono chat completion: sintesi vocale, trascrizione,
// classificatori di sicurezza, embedding. Provarli e' solo tempo perso.
const NOT_CHAT = /orpheus|whisper|tts|prompt-guard|guard|embed|rerank|distil/i;

// Famiglie che sappiamo essere di solo testo: le proviamo comunque, ma per
// ultime, per non bruciare i tentativi prima di arrivare a un multimodale.
const TEXT_ONLY_HINT = /gpt-oss|allam|compound/i;

// Dentro la stessa famiglia il numero piu' alto e' il modello piu' recente
// (qwen3.8 batte qwen3.6) o il piu' grande (gpt-oss-120b batte gpt-oss-20b).
// In ordine alfabetico finivano prima i piu' vecchi, e la ricerca si fermava li'.
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

async function candidatiGroq(kind, escludi, deadline) {
  const modelli = await listaGroq(deadline);
  const pool = newestFirst(modelli.filter(id => !escludi.includes(id) && !NOT_CHAT.test(id)));
  const ordinati = [];
  const push = id => { if (!ordinati.includes(id)) ordinati.push(id); };

  for (const pattern of MODEL_PREFERENCES[kind] || []) {
    for (const id of pool) if (pattern.test(id)) push(id);
  }
  if (kind === 'image') {
    for (const id of pool) if (!TEXT_ONLY_HINT.test(id)) push(id);
  }
  for (const id of pool) push(id);
  return ordinati.slice(0, MAX_MODEL_ATTEMPTS);
}

function listaGroq(deadline) {
  const cached = S.cacheGet('groq:catalog', CATALOG_TTL_MS);
  if (cached) return Promise.resolve(cached);

  // Anche la lista deve stare dentro la deadline: se non c'e' piu' tempo,
  // tanto vale non chiederla.
  const budget = Math.min(4000, deadline - Date.now());
  if (budget < 500) return Promise.resolve([]);

  return richiestaHttp({
    hostname: GROQ_HOST,
    path: '/openai/v1/models',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${GROQ_KEY}` }
  }, null, Date.now() + budget).then(res => {
    let lista = [];
    try {
      const parsed = JSON.parse(res.body);
      lista = Array.isArray(parsed.data) ? parsed.data.map(m => m.id).filter(Boolean).sort() : [];
    } catch {
      lista = [];
    }
    // Un elenco vuoto non lo mettiamo in cache: e' quasi sempre un errore di
    // rete, e ricordarselo per dieci minuti servirebbe solo a peggiorare.
    if (lista.length) S.cacheSet('groq:catalog', lista);
    return lista;
  }).catch(() => []);
}

/* ============================== HTTP ============================== */

async function richiestaHttp(opzioni, payload, deadline) {
  try {
    return await S.inviaHttp(opzioni, payload, deadline);
  } catch (e) {
    // Un socket riusato puo' essere stato chiuso dal server mentre la function
    // era congelata. In quel caso ritentiamo una volta, col tempo che resta.
    const socketMorto = e && (e.code === 'ECONNRESET' || e.code === 'EPIPE');
    if (!socketMorto || deadline - Date.now() < MIN_ATTEMPT_MS) throw e;
    return S.inviaHttp(opzioni, payload, deadline);
  }
}
