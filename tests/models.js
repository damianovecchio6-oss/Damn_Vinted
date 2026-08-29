const L = require('./lib');
// Stubba https PRIMA di caricare la function, cosi' il giro di fallback dei
// modelli gira senza rete e senza chiave vera.
const https = require('https');
const { EventEmitter } = require('events');

let plan = [];        // risposte in coda per chat/completions
let calls = [];       // modelli effettivamente provati
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
        const model = JSON.parse(req._payload || '{}').model;
        calls.push(model);
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
const NOVISION = { status: 400, body: JSON.stringify({ error: { message: 'this model does not support image input' } }) };
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
