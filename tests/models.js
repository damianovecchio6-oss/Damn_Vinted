const L = require('./lib');
// Stubba https PRIMA di caricare la function, cosi' il giro di fallback dei
// modelli gira senza rete e senza chiave vera.
const https = require('https');
const { EventEmitter } = require('events');

let plan = [];        // risposte in coda per chat/completions
let calls = [];       // modelli effettivamente provati
let corpi = [];       // e i corpi mandati, per guardarci dentro
let catalogCalls = 0;
let catalog = ['meta-llama/llama-4-scout-17b-16e-instruct','openai/gpt-oss-120b','openai/whisper-large-v3','qwen/qwen3-32b'];
let latency = 0;

https.request = function (opts, cb) {
  const req = new EventEmitter();
  req.write = function (payload) { req._payload = payload; };
  req.destroy = function (err) { setImmediate(() => req.emit('error', err || new Error('destroyed'))); };
  req.end = function () {
    setTimeout(() => {
      let status, body;
      if (opts.path === '/openai/v1/models') {
        catalogCalls++;
        status = 200;
        body = JSON.stringify({ data: catalog.map(id => ({ id })) });
      } else {
        const corpo = JSON.parse(req._payload || '{}');
        calls.push(corpo.model);
        corpi.push(corpo);
        const next = plan.shift() || { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'ok' } }] }) };
        status = next.status; body = next.body;
      }
      const res = new EventEmitter();
      res.statusCode = status;
      res.setEncoding = () => {};
      cb(res);
      res.emit('data', body);
      res.emit('end');
    }, latency);
    return req;
  };
  return req;
};

process.env.URL = 'https://damn-vinted.netlify.app';
process.env.GROQ_API_KEY = 'test-key-non-reale';
process.env.RATE_LIMIT_PER_MIN = '0';   // il rate limit non c'entra qui
const fn = require(L.funzione('claude.js'));

const SITE = 'https://damn-vinted.netlify.app', HOST = 'damn-vinted.netlify.app';
let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${e !== undefined ? ' -> ' + e : ''}`); } };

const MISSING = { status: 404, body: JSON.stringify({ error: { message: 'The model does not exist or you do not have access to it' } }) };
// Come Groq annuncia davvero un modello ritirato: 400, non 404. Guardando solo
// il 404 il ripiego non partiva, e ogni foto finiva con "Il modello ha
// rifiutato la richiesta. Riprova.".
const DISMESSO = { status: 400, body: JSON.stringify({ error: { code: 'model_decommissioned', message: 'The model `meta-llama/llama-4-scout-17b-16e-instruct` has been decommissioned and is no longer supported. Please refer to https://console.groq.com/docs/deprecations' } }) };
const NONSUPPORTATO = { status: 400, body: JSON.stringify({ error: { code: 'model_not_supported', message: "The requested model 'meta-llama/llama-4-scout-17b-16e-instruct' is not supported by provider 'groq'." } }) };
const NOVISION = { status: 400, body: JSON.stringify({ error: { message: 'this model does not support image input' } }) };
// Il 400 vero di Groq quando la richiesta supera i suoi 4MB di base64. Nomina
// l'immagine, e senza un controllo apposta finiva nel ramo "prova un altro
// modello": otto tentativi con lo stesso payload, e lo stesso errore.
const TROPPOGROSSA = { status: 400, body: JSON.stringify({ error: { message: 'Request too large: the maximum allowed size for a request containing a base64 encoded image is 4MB' } }) };
// Lo stesso "Request too large", ma per i TOKEN: la cura non e' rimpicciolire,
// e' mandare meno foto. Prima finiva nello stesso secchio dei byte, e il
// client scendeva di qualita' a vuoto.
const TROPPITOKEN = { status: 400, body: JSON.stringify({ error: { message: 'Request too large for model `qwen/qwen3.6-27b` in organization `org_01abc` on tokens per minute (TPM): Limit 15000, Requested 21000.' } }) };
const OK = { status: 200, body: JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }) };

async function post(ip, payload) {
  const t = JSON.parse((await fn.handler({ httpMethod: 'GET', headers: { origin: SITE, host: HOST, 'x-nf-client-connection-ip': ip }, body: '' })).body).token;
  return fn.handler({
    httpMethod: 'POST',
    headers: { origin: SITE, host: HOST, 'x-nf-client-connection-ip': ip, 'x-session-token': t },
    body: JSON.stringify(payload)
  });
}

(async () => {
  console.log('\n-- fallback modelli --');
  plan = [OK]; calls = [];
  let r = await post('1.0.0.1', { type: 'text', prompt: 'ciao' });
  check('testo: usa il modello di default al primo colpo', r.statusCode === 200 && calls.length === 1 && calls[0] === 'openai/gpt-oss-120b', calls.join(','));

  plan = [MISSING, OK]; calls = []; catalogCalls = 0;
  r = await post('1.0.0.2', { type: 'image', prompt: 'ciao', images: [{ base64: 'AAA' }] });
  const body = JSON.parse(r.body);
  check('foto: modello ritirato -> ripiega sul successivo', r.statusCode === 200 && calls.length === 2, calls.join(','));
  check('chiede il catalogo una volta sola', catalogCalls === 1, catalogCalls);
  check('rimanda il modello che ha davvero risposto', body.model === calls[1], body.model);
  check('non prova whisper (non e\' un modello di chat)', !calls.some(m => /whisper/.test(m)), calls.join(','));

  plan = [OK]; calls = []; catalogCalls = 0;
  r = await post('1.0.0.3', { type: 'image', prompt: 'ciao', images: [{ base64: 'AAA' }] });
  check('la scelta resta in cache: niente secondo giro', r.statusCode === 200 && calls.length === 1, calls.join(','));
  check('e niente seconda richiesta di catalogo', catalogCalls === 0, catalogCalls);

  console.log('\n-- modello ritirato: Groq lo dice con un 400, non con un 404 --');
  plan = [DISMESSO, OK]; calls = []; catalogCalls = 0;
  r = await post('1.0.1.1', { type: 'image', prompt: 'x', images: [{ base64: 'AAA' }] });
  check('un 400 "decommissioned" fa ripiegare sul modello dopo',
    r.statusCode === 200 && calls.length === 2, `${r.statusCode} / ${calls.join(',')}`);
  check('e il modello morto non e quello che risponde',
    JSON.parse(r.body).model === calls[1], r.body);
  check('non resta l errore che invitava a riprovare a vuoto',
    !/rifiutato la richiesta/.test(r.body), r.body);

  plan = [NONSUPPORTATO, OK]; calls = []; catalogCalls = 0;
  r = await post('1.0.1.2', { type: 'image', prompt: 'x', images: [{ base64: 'AAA' }] });
  check('lo stesso per "not supported by provider"',
    r.statusCode === 200 && calls.length === 2, `${r.statusCode} / ${calls.join(',')}`);

  // Il testo passa dallo stesso giro: se il modello di testo viene ritirato,
  // l'annuncio e la stima devono ripiegare come fa l'analisi foto.
  plan = [DISMESSO, OK]; calls = [];
  r = await post('1.0.1.3', { type: 'text', prompt: 'ciao' });
  check('vale anche per il testo, non solo per le foto',
    r.statusCode === 200 && calls.length === 2, `${r.statusCode} / ${calls.join(',')}`);

  console.log('\n-- cache negativa e sua scadenza --');
  plan = Array(12).fill(NOVISION); calls = [];
  r = await post('1.0.0.4', { type: 'image', prompt: 'x', images: [{ base64: 'AAA' }] });
  check('nessun modello adatto -> 502', r.statusCode === 502, r.statusCode);
  check('messaggio generico, senza elenco modelli', !/gpt-oss|llama|qwen/.test(r.body), r.body);
  const primoGiro = calls.length;
  check('ha provato piu\' candidati prima di arrendersi', primoGiro > 2, primoGiro);

  plan = Array(12).fill(NOVISION); calls = [];
  r = await post('1.0.0.5', { type: 'image', prompt: 'x', images: [{ base64: 'AAA' }] });
  check('subito dopo risponde dalla cache, senza ritentare', r.statusCode === 502 && calls.length === 0, calls.length);

  const realNow = Date.now;
  Date.now = () => realNow() + 6 * 60 * 1000;   // oltre NEGATIVE_TTL_MS
  plan = [OK]; calls = [];
  r = await post('1.0.0.6', { type: 'image', prompt: 'x', images: [{ base64: 'AAA' }] });
  Date.now = realNow;
  check('passati 6 minuti riprova da capo (era il bug del 502 perpetuo)', r.statusCode === 200 && calls.length > 0, `${r.statusCode}/${calls.length}`);

  console.log('\n-- errori upstream --');
  plan = [{ status: 429, body: JSON.stringify({ error: { message: 'Rate limit reached for org_01abc on tokens' } }) }];
  r = await post('1.0.0.7', { type: 'text', prompt: 'ciao' });
  check('429 di Groq -> 429 al client', r.statusCode === 429, r.statusCode);
  check('non trapela l\'id organizzazione', !/org_01abc/.test(r.body), r.body);

  plan = [{ status: 401, body: JSON.stringify({ error: { message: 'Invalid API Key sk-abc123' } }) }];
  r = await post('1.0.0.8', { type: 'text', prompt: 'ciao' });
  check('401 upstream -> 502 (non 401: non e\' la sessione del client)', r.statusCode === 502, r.statusCode);
  check('non trapela la chiave', !/sk-abc123/.test(r.body), r.body);

  plan = [{ status: 502, body: '<html>Bad Gateway</html>' }];
  r = await post('1.0.0.9', { type: 'text', prompt: 'ciao' });
  check('risposta non JSON -> 502 con messaggio pulito', r.statusCode === 502 && /Riprova/.test(r.body), r.body);

  console.log('\n-- richiesta troppo pesante --');
  plan = Array(12).fill(TROPPOGROSSA); calls = []; catalogCalls = 0;
  r = await post('1.0.0.10', { type: 'image', prompt: 'x', images: [{ base64: 'AAA' }] });
  check('non gira su altri modelli: il peso non cambia da modello a modello',
    calls.length === 1, calls.join(','));
  check('e non chiede nemmeno il catalogo', catalogCalls === 0, catalogCalls);
  check('dice che le foto sono troppo pesanti', /troppo pesanti/i.test(r.body), r.body);
  check('e non dice "riprova" e basta, che manderebbe a ripetere lo stesso errore',
    !/^.*rifiutato la richiesta/.test(JSON.parse(r.body).error), r.body);
  check('il motivo arriva, cosi si sa perche', /maximum allowed size/.test(JSON.parse(r.body).dettaglio || ''), r.body);
  check('ma il messaggio grande resta nostro', /troppo pesanti/.test(JSON.parse(r.body).error), r.body);

  console.log('\n-- il ragionamento ad alta voce si spegne --');
  // Il guasto che si vedeva sul sito: il modello con visione ragionava dentro
  // un <think> che non si chiudeva, finiva i token e il JSON non arrivava mai.
  // Con una foto sola ci stava, con due no.
  catalog = ['qwen/qwen3.6-27b', 'openai/gpt-oss-120b'];
  plan = [OK]; calls = []; corpi = [];
  r = await post('1.0.2.1', { type: 'image', prompt: 'x', images: [{ base64: 'AAA' }] });
  check('a un qwen3 si dice di non ragionare', corpi[0].reasoning_effort === 'none', JSON.stringify(corpi[0].reasoning_effort));

  plan = [OK]; calls = []; corpi = [];
  r = await post('1.0.2.2', { type: 'text', prompt: 'ciao' });
  check('e a un modello che non ragiona non si manda niente',
    corpi[0].reasoning_effort === undefined,
    JSON.stringify({ modello: corpi[0].model, effort: corpi[0].reasoning_effort }));

  // Questo controllo prima diceva "ma non a gpt-oss" e non ci arrivava
  // nemmeno: quella chiamata finiva su llama-scout, il modello di testo
  // rimasto in cache dai controlli sopra, quindi verificava un'altra cosa da
  // quella scritta nel nome. Qui gpt-oss si raggiunge davvero, facendo cadere
  // il modello in cache.
  //
  // E il fatto da difendere e' piu' stretto di "non mandargli niente": a
  // gpt-oss non si manda 'none', che sarebbe un 400. 'low' - il minimo che
  // accetta - gli toglie il ragionamento a effort pieno prima del JSON, che
  // sul rapporto dell'agente e' la differenza fra entrare nei 9s e non
  // entrarci.
  catalog = ['openai/gpt-oss-120b'];
  plan = [DISMESSO, OK]; calls = []; corpi = [];
  r = await post('1.0.2.9', { type: 'text', prompt: 'ciao' });
  const suGptOss = corpi.find(c => /gpt-oss/.test(c.model || ''));
  check('la richiesta arriva davvero a gpt-oss', !!suGptOss, calls);
  check('a gpt-oss si dice di ragionare poco, non di non ragionare',
    suGptOss && suGptOss.reasoning_effort === 'low',
    JSON.stringify(suGptOss && suGptOss.reasoning_effort));
  check('e mai "none", che su gpt-oss sarebbe un 400',
    !suGptOss || suGptOss.reasoning_effort !== 'none',
    JSON.stringify(suGptOss && suGptOss.reasoning_effort));

  // I provider spostano questi parametri da un modello all'altro: se un
  // giorno smette di accettarlo, non deve cadere tutta l'analisi foto.
  plan = [{ status: 400, body: JSON.stringify({ error: { message: '`reasoning_effort` must be one of `low`, `medium`, or `high`' } }) }, OK];
  calls = []; corpi = [];
  r = await post('1.0.2.3', { type: 'image', prompt: 'x', images: [{ base64: 'AAA' }] });
  check('e se lo rifiuta, si riprova senza invece di arrendersi',
    r.statusCode === 200 && corpi.length === 2 && corpi[1].reasoning_effort === undefined,
    `${r.statusCode} / ${corpi.length}`);
  catalog = ['meta-llama/llama-4-scout-17b-16e-instruct','openai/gpt-oss-120b','openai/whisper-large-v3','qwen/qwen3-32b'];

  console.log('\n-- troppi token non e la stessa cosa di troppi byte --');
  plan = [TROPPITOKEN]; calls = [];
  r = await post('1.0.0.11', { type: 'image', prompt: 'x', images: [{ base64: 'AAA' }] });
  const rispostaToken = JSON.parse(r.body);
  check('lo riconosce come problema di token, non di peso', rispostaToken.pesante === 'token', r.body);
  check('e lo dice: meno foto, non foto piu piccole', /troppe per questo modello/.test(rispostaToken.error), rispostaToken.error);
  check('mentre il peso vero resta peso', await (async () => {
    plan = [TROPPOGROSSA]; calls = [];
    const b = JSON.parse((await post('1.0.0.12', { type: 'image', prompt: 'x', images: [{ base64: 'AAA' }] })).body);
    return b.pesante === 'byte';
  })());

  console.log('\n-- il motivo arriva a chi tiene il sito, senza i segreti --');
  plan = [TROPPITOKEN]; calls = [];
  r = await post('1.0.0.13', { type: 'image', prompt: 'x', images: [{ base64: 'AAA' }] });
  const conDettaglio = JSON.parse(r.body);
  check('il dettaglio del provider arriva', /tokens per minute/.test(conDettaglio.dettaglio || ''), conDettaglio.dettaglio);
  check('ma senza l id dell organizzazione', !/org_01abc/.test(r.body), r.body);
  plan = [{ status: 400, body: JSON.stringify({ error: { message: 'Invalid API Key gsk_abc123def456 on request' } }) }];
  r = await post('1.0.0.14', { type: 'text', prompt: 'x' });
  check('ne pezzi di chiave', !/gsk_abc123def456/.test(r.body), r.body);

  console.log('\n-- deadline --');
  process.env.AI_TIMEOUT_MS = '9000';
  latency = 300; plan = Array(20).fill(MISSING); calls = [];
  const t0 = Date.now();
  r = await post('2.0.0.1', { type: 'image', prompt: 'x', images: [{ base64: 'AAA' }] });
  const elapsed = Date.now() - t0;
  latency = 0;
  check('si ferma entro il limite Netlify di 10s', elapsed < 9500, elapsed + 'ms');
  check('non supera MAX_MODEL_ATTEMPTS', calls.length <= 9, calls.length);

  console.log(`\n${pass} passati, ${fail} falliti`);
  process.exit(fail ? 1 : 0);
})();
