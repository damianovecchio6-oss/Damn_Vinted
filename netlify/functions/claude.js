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
// llama-4-scout, che stava qui, Groq l'ha spento il 17 luglio 2026 (e maverick
// ancora prima). Il ripiego ora lo riconosce e cambia modello da solo, ma
// partire da un modello morto costa comunque un giro: e con 3.6MB di foto da
// caricare due volte, dentro i 9s di budget, quel giro puo' essere la
// differenza fra una risposta e un timeout. Il default va tenuto vivo anche
// se il ripiego esiste.
const MODEL_VISION = process.env.GROQ_MODEL_VISION || 'qwen/qwen3.6-27b';
const GEMINI_MODEL = process.env.GEMINI_MODEL || '';

// Ordine di gradimento, applicato a quello che il provider dichiara
// disponibile. Sono preferenze, non certezze: il pool da ordinare arriva dal
// catalogo dell'account, quindi un nome che qui e' rimasto indietro non fa
// danno - semplicemente non trovera' niente da ordinare. Ma tenerli aggiornati
// fa trovare prima quello giusto, e ogni tentativo in meno e' un secondo in
// piu' dentro il budget.
const MODEL_PREFERENCES = {
  image: [/qwen3\.\d/i, /qwen/i, /llama-4/i, /vision|multimodal/i],
  text: [/^openai\/gpt-oss/i, /llama-3\.3-70b/i, /llama-3/i]
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
    return S.json(413, cors, { error: 'Immagini troppo pesanti', pesante: 'byte' });
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
      // interpretare, il che si vede come "analisi imprecisa". E i modelli
      // con visione rimasti su Groq sono modelli che ragionano ad alta voce:
      // il ragionamento si mangia una fetta del budget PRIMA di arrivare al
      // JSON, quindi 2048 rischiava di far finire i token a meta' risposta.
      maxTokens: kind === 'image' ? 3072 : 1024,
      json: body.json === true
    };

    // Gemini guarda le foto meglio di quello che offre Groq, quindi quando la
    // chiave c'e' le immagini vanno li'. Il testo resta su Groq, che e' piu'
    // veloce e ha limiti piu' larghi: cosi' non bruciamo la quota gratuita di
    // Gemini con le stime di prezzo.
    const usaGemini = GEMINI_KEY && (kind === 'image' || !GROQ_KEY);

    // Il ripiego su Groq funziona, ma finora era muto: chi guardava vedeva
    // solo "groq" e non poteva distinguere "la chiave Gemini non c'e'" da
    // "Gemini ha risposto male". Due cose con rimedi opposti - metterla, o
    // aspettare che la quota si ricarichi - e nessun modo di sapere quale.
    // Il motivo lo scriviamo, e sono parole nostre: i motivi che tentaGemini
    // restituisce non contengono niente del provider.
    let esito, notaGemini = '';
    if (usaGemini) {
      esito = await tentaGemini(richiesta, kind, deadline);
      // Quota giornaliera finita o modello sparito: se abbiamo anche Groq e
      // resta tempo, meglio una risposta di Groq che un errore.
      if (!esito.ok) {
        notaGemini = esito.motivo || 'motivo ignoto';
        if (GROQ_KEY && deadline - Date.now() >= MIN_ATTEMPT_MS) {
          console.error(`Gemini non utilizzabile (${esito.motivo}), ripiego su Groq`);
          esito = await tentaGroq(richiesta, kind, deadline);
        }
      }
    } else {
      if (kind === 'image' && !GEMINI_KEY) notaGemini = 'chiave non configurata';
      esito = await tentaGroq(richiesta, kind, deadline);
    }

    if (!esito.ok) {
      const corpo = { error: esito.error };
      if (esito.pesante) corpo.pesante = esito.pesante;
      if (esito.dettaglio) corpo.dettaglio = esito.dettaglio;
      return S.json(esito.status || 502, cors, corpo);
    }

    // Rimandiamo anche chi ha risposto: serve a capire da cosa dipende la
    // qualita' dell'analisi e quale modello conviene fissare a mano. E se
    // Gemini era la scelta giusta ma non e' stato usato, il perche'.
    const risposta = { text: esito.text, model: esito.model, provider: esito.provider };
    if (notaGemini && esito.provider !== 'gemini') risposta.gemini = notaGemini;
    return S.json(200, cors, risposta);

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

// I nomi dei modelli Gemini cambiano spesso (2.5, 3.5, 3.7 flash...), e per
// questo il catalogo resta: chiediamolo, e prendiamo il flash piu' recente che
// sappia fare generateContent. GEMINI_MODEL scavalca tutto.
//
// Ma chiederlo PRIMA di ogni analisi costava caro. La cache del catalogo vive
// in memoria e muore col deploy, quindi ogni istanza fredda pagava un giro a
// Google - fino a 4s dei 9 di budget - prima di mandare un solo byte delle
// foto. La stessa richiesta che a caldo aveva 8.7s per rispondere, a freddo ne
// aveva 5, e il sintomo era "L'AI ci ha messo troppo. Riprova." subito dopo un
// deploy. Groq questo problema non l'ha mai avuto: parte da un default e chiede
// il catalogo solo se quel modello non va. Ora fanno la stessa cosa.
//
// Il rimedio non e' smettere di chiedere il catalogo: e' smettere di
// aspettarlo senza un tetto. La lista di Google normalmente arriva in poche
// centinaia di ms, e i 4s erano il caso peggiore travestito da caso normale.
// Con un tetto basso il catalogo continua a decidere quasi sempre - quindi la
// regola "prendi il flash piu' recente" resta viva - e quando non ce la fa si
// riparte da un nome noto invece di rispondere "nessun modello", che e' un
// errore dove bastava un tentativo.
const CATALOG_WAIT_MS = 1200;
const MODEL_GEMINI = 'gemini-2.5-flash';

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

  const budget = Math.min(CATALOG_WAIT_MS, deadline - Date.now());
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

// Un tentativo solo, su un modello solo. Torna null quando quel modello non
// esiste piu' e ha senso passare al prossimo; in ogni altro caso torna l'esito
// definitivo, che sia una risposta o un errore su cui cambiare modello non
// aiuterebbe.
async function unTentativoGemini(richiesta, modello, cacheKey, deadline, memorizza) {
  const res = await richiestaHttp({
    hostname: GEMINI_HOST,
    path: `/v1beta/models/${encodeURIComponent(modello)}:generateContent`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY }
  }, JSON.stringify(corpoGemini(richiesta)), deadline).catch(e => {
    if (e && e.code === 'AI_TIMEOUT') throw e;
    return { status: 0, body: String(e && e.message || e) };
  });

  // Modello inesistente o ritirato: si prova il prossimo. Vale anche qui la
  // lezione di Groq - il ritiro non arriva sempre come 404.
  if (res.status === 404 || modelloSparito(res)) return null;
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
  // Il ripiego non si memorizza. Ricordarlo per mezz'ora vorrebbe dire restare
  // su un nome cablato anche quando il catalogo, un secondo dopo, risponderebbe
  // subito: cosi' invece la prossima richiesta torna a chiederglielo.
  if (memorizza) S.cacheSet(cacheKey, modello);
  return { ok: true, text, model: modello, provider: 'gemini' };
}

async function tentaGemini(richiesta, kind, deadline) {
  const cacheKey = `gemini:model:${kind}`;
  const noto = resolvedModel(cacheKey);
  if (noto === false) return { ok: false, motivo: 'nessun modello (in cache)' };

  const provati = [];
  const prova = async (lista, memorizza = true) => {
    for (const modello of lista) {
      if (!modello || provati.includes(modello)) continue;
      if (provati.length >= MAX_MODEL_ATTEMPTS) break;
      if (deadline - Date.now() < MIN_ATTEMPT_MS) break;
      provati.push(modello);
      const esito = await unTentativoGemini(richiesta, modello, cacheKey, deadline, memorizza);
      if (esito) return esito;
    }
    return null;
  };

  // Prima quello che sappiamo gia' senza chiedere niente a nessuno: su
  // un'istanza calda il catalogo non si tocca proprio.
  let esito = await prova([GEMINI_MODEL, noto]);
  // Poi il catalogo, che resta chi sceglie: ma con un tetto sull'attesa, non
  // con mezzo budget in mano.
  if (!esito) esito = await prova(await listaGemini(deadline));
  // E se il catalogo tace - Google oltre il tetto, o una lista vuota - si
  // prova comunque il nome noto. Meglio un tentativo che un errore.
  if (!esito) esito = await prova([MODEL_GEMINI], false);
  if (esito) return esito;

  if (provati.length) S.cacheSet(cacheKey, false);
  console.error(`Nessun modello Gemini utilizzabile per "${kind}". Provati: ${provati.join(', ') || 'nessuno'}`);
  return { ok: false, motivo: 'nessun modello utilizzabile' };
}

/* ============================= GROQ ============================= */

const GROQ_HOST = 'api.groq.com';

// I modelli che ragionano ad alta voce si mangiano il budget di token PRIMA
// di arrivare alla risposta: con due foto il blocco <think> non si chiudeva
// nemmeno, e il JSON non usciva mai. Con una foto sola ci stava - ed e'
// esattamente il sintomo che si vedeva sul sito.
//
// Su Groq il ragionamento si spegne, ma il parametro e' specifico per
// famiglia e sbagliarlo costa un 400:
//   qwen3   -> reasoning_effort 'none' lo spegne davvero
//   gpt-oss -> accetta solo low|medium|high, 'none' e' un 400
//   altri   -> non si manda niente, l'unica cosa sempre sicura
// reasoning_format:'hidden' non servirebbe: nasconde il ragionamento ma il
// modello lo fa lo stesso, e i token se li prende comunque.
const QWEN3 = /qwen3/i;

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
  if (QWEN3.test(modello) && !richiesta.senzaRagionamento) out.reasoning_effort = 'none';
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

  // Stessa rete di sicurezza per reasoning_effort: e' un parametro che i
  // provider spostano da un modello all'altro, e non deve poter rompere
  // tutta l'analisi foto se un giorno questo modello smette di accettarlo.
  if (res.status >= 400 && /reasoning_effort|reasoning/i.test(res.body || '')
      && !richiesta.senzaRagionamento
      && deadline - Date.now() >= MIN_ATTEMPT_MS) {
    console.error(`reasoning_effort rifiutato da ${modello}, riprovo senza`);
    res = await chiamataGroq(Object.assign({}, richiesta, { senzaRagionamento: true }), modello, deadline);
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
    return {
      ok: false,
      status: statusPerIlClient(res.status),
      error: erroreLeggibile(res.status, dettaglio),
      // Il client su questo non deve leggere un messaggio: deve poterci
      // reagire, e la reazione giusta dipende da QUALE dei due rifiuti e'.
      pesante: pesaTroppo(res.status, dettaglio),
      dettaglio: redigi(dettaglio),
      motivo: `HTTP ${res.status}`
    };
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

// Il limite di peso lo decide il provider, cambia col modello e non e' scritto
// da nessuna parte su cui si possa fare affidamento: qui si riconosce che il
// rifiuto E' per peso, e sara' il client a scendere di qualita' e riprovare.
function pesaTroppo(status, dettaglio) {
  if (status === 413) return 'byte';
  return status === 400 ? tipoDiRifiuto(dettaglio) : '';
}

// Il testo di Groq puo' contenere l'id dell'organizzazione e - in teoria -
// pezzi di chiave: quelli non escono di qui. Il resto invece serve, e serve
// a chi il sito ce l'ha: senza, ogni rifiuto nuovo del provider costa un
// giro di ipotesi. E' finito nel diario dello scanner, non nel messaggio
// grande, che resta nostro.
function redigi(dettaglio) {
  return String(dettaglio || '')
    .replace(/\b(?:sk|gsk|org)[-_][A-Za-z0-9]+/gi, '[omesso]')
    .replace(/\b[0-9a-f]{24,}\b/gi, '[omesso]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function erroreLeggibile(status, dettaglio) {
  if (status === 429) return 'Troppe richieste, riprova tra qualche secondo.';
  if (status === 401 || status === 403) return 'Il servizio AI ha rifiutato le credenziali del sito.';
  // Groq risponde 400, non 413, quando la richiesta supera i suoi 4MB: dire
  // "riprova" mandava a ripetere identica una richiesta che non poteva
  // passare. Qui si dice cosa fare davvero.
  const tipo = pesaTroppo(status, dettaglio);
  if (tipo === 'byte') return 'Le foto sono troppo pesanti per il modello. Sto riprovando piu\' leggero.';
  if (tipo === 'token') return 'Le foto sono troppe per questo modello. Sto riprovando con meno foto.';
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
// Un modello ritirato Groq lo annuncia con un 400, non con un 404:
//   model_decommissioned: 400 The model `X` has been decommissioned...
//   model_not_supported:  400 The requested model 'X' is not supported...
// Guardando solo il 404 - com'era prima - quel 400 non veniva riconosciuto,
// il giro dei candidati non partiva mai, e ogni analisi foto finiva con "Il
// modello ha rifiutato la richiesta. Riprova.", che invitava a ripetere una
// richiesta destinata a fallire identica finche' non si cambiava modello a
// mano. E' esattamente il caso per cui esiste tutto il meccanismo di
// ripiego: era il codice di stato a tenerlo spento.
const MODELLO_SPARITO = /does not exist|model_not_found|model_decommissioned|decommissioned|model_not_supported|not supported by provider|no longer supported|has been deprecated/i;

function modelloSparito(res) {
  if (!res) return false;
  if (res.status !== 404 && res.status !== 400) return false;
  return MODELLO_SPARITO.test(res.body || '');
}

// Vale la pena provare un altro modello? Sia se questo non esiste piu', sia
// se esiste ma rifiuta le immagini: Groq lo segnala con un 400 che parla di
// image/vision/multimodal.
// Groq rifiuta con un 400 le richieste sopra i 4MB di base64. Il messaggio
// nomina spesso l'immagine, quindi senza questo controllo finiva nel ramo
// "prova un altro modello": otto tentativi con lo stesso payload da 4MB, il
// budget di 9s bruciato, e lo stesso errore alla fine.
// Due rifiuti diversi che finivano nello stesso secchio, e la cura e'
// opposta. BYTE: la richiesta pesa troppo, si rimpicciolisce e passa.
// TOKEN: le immagini occupano troppo contesto o troppa quota al minuto -
// rimpicciolire aiuta poco, quello che serve e' mandare MENO foto.
// "exceed" da solo prendeva dentro anche i secondi, e il client scendeva di
// qualita' all'infinito su un problema che la qualita' non risolve.
const TROPPI_BYTE = /too large|too big|maximum (?:allowed )?size|size limit|entity too large|payload too/i;
const TROPPI_TOKEN = /token|context length|context window|reduce the length|tokens per minute|tpm/i;

// L'ordine conta: "Request too large ... on tokens per minute" parla di
// token, non di byte, e la parola "large" non deve trarre in inganno.
function tipoDiRifiuto(dettaglio) {
  const testo = dettaglio || '';
  if (TROPPI_TOKEN.test(testo)) return 'token';
  if (TROPPI_BYTE.test(testo)) return 'byte';
  return '';
}

const TROPPO_GRANDE = /too large|too big|maximum (?:allowed )?size|size limit|entity too large|payload too|token|context length|reduce the length/i;

function serveUnAltroModello(res, kind) {
  if (modelloSparito(res)) return true;
  if (kind !== 'image' || !res || res.status !== 400) return false;
  if (TROPPO_GRANDE.test(res.body || '')) return false;
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
