const L = require('./lib');
const https = require('https');
const { EventEmitter } = require('events');

// Il guasto che questo file guarda: su un'istanza fredda tentaGemini aspettava
// il catalogo PRIMA di mandare le foto, e quel giro valeva fino a 4s dei 9 di
// budget. Con una richiesta pesante quello che restava non bastava, e usciva
// "L'AI ci ha messo troppo. Riprova." - solo dopo un deploy, perche' la cache
// del catalogo vive in memoria e col deploy muore.
//
// Gira in un file suo perche' serve un catalogo LENTO e una cache vuota, e
// tutte e due sono stato del processo: dentro tests/gemini.js il catalogo e'
// gia' in cache dai controlli precedenti e il guasto non si vedrebbe.
let latenzaCatalogo = 0;
let partite = [];   // cosa e' partito, e a che punto del budget

const CATALOGO = { models: [
  { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.7-flash', supportedGenerationMethods: ['generateContent'] }
]};
const RISPOSTA = JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"tipo":"giacca"}' }] } }] });

let t0 = 0;
https.request = function (opts, cb) {
  const req = new EventEmitter();
  req.write = p => { req._p = p; };
  req.destroy = e => setImmediate(() => req.emit('error', e || new Error('x')));
  req.end = function () {
    const catalogo = /^\/v1beta\/models\?/.test(opts.path);
    const modello = catalogo ? null : decodeURIComponent(opts.path.split('/').pop().split(':')[0]);
    partite.push({ cosa: catalogo ? 'catalogo' : 'foto', modello, quando: Date.now() - t0 });
    setTimeout(() => {
      const res = new EventEmitter();
      res.statusCode = 200; res.setEncoding = () => {};
      cb(res);
      res.emit('data', catalogo ? JSON.stringify(CATALOGO) : RISPOSTA);
      res.emit('end');
    }, catalogo ? latenzaCatalogo : 0);
    return req;
  };
  return req;
};

process.env.URL = 'https://damn-vinted.netlify.app';
process.env.GEMINI_API_KEY = 'gemini-finta';
process.env.RATE_LIMIT_PER_MIN = '0';
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_MODEL;
const fn = require(L.funzione('claude.js'));

const SITE = 'https://damn-vinted.netlify.app', HOST = 'damn-vinted.netlify.app';
let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${e !== undefined ? ' -> ' + JSON.stringify(e) : ''}`); } };

const FOTO = { type: 'image', prompt: 'analizza', images: [{ base64: 'AAA', mime: 'image/jpeg' }], json: true };
async function analizza(ip) {
  const t = JSON.parse((await fn.handler({ httpMethod: 'GET',
    headers: { origin: SITE, host: HOST, 'x-nf-client-connection-ip': ip }, body: '' })).body).token;
  t0 = Date.now(); partite = [];
  return fn.handler({ httpMethod: 'POST',
    headers: { origin: SITE, host: HOST, 'x-nf-client-connection-ip': ip, 'x-session-token': t },
    body: JSON.stringify(FOTO) });
}

(async () => {
  // Il tetto e' 1200ms: qui il catalogo ne chiede il triplo e deve perdere.
  console.log('\n-- catalogo lento: le foto non lo aspettano --');
  latenzaCatalogo = 3600;
  let r = await analizza('7.7.7.1');
  let foto = partite.find(p => p.cosa === 'foto');
  check('la richiesta riesce, non va in timeout', r.statusCode === 200, r.statusCode + ' ' + r.body);
  check('le foto partono comunque', !!foto, partite);
  // Il numero che conta: prima erano fino a 4000ms buttati qui.
  check('e partono entro il tetto, non entro il budget', foto && foto.quando < 2000, foto);
  check('col nome noto, visto che il catalogo ha taciuto',
    JSON.parse(r.body).model === 'gemini-2.5-flash', JSON.parse(r.body).model);

  // E la ragione per cui il catalogo non e' stato tolto di mezzo: quando fa in
  // tempo, e' lui a scegliere - e sceglie meglio di un nome cablato.
  console.log('\n-- catalogo in tempo: torna a decidere lui --');
  latenzaCatalogo = 0;
  r = await analizza('7.7.7.2');
  check('sceglie il flash piu recente, non il default',
    JSON.parse(r.body).model === 'gemini-3.7-flash', JSON.parse(r.body).model);

  console.log(`\n${pass} passati, ${fail} falliti`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
