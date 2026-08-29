const L = require('./lib');
process.env.URL = 'https://damn-vinted.netlify.app';
process.env.GROQ_API_KEY = 'test-key-non-reale';
process.env.RATE_LIMIT_PER_MIN = '20';

const fn = require(L.funzione('claude.js'));
const SITE = 'https://damn-vinted.netlify.app';
const HOST = 'damn-vinted.netlify.app';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' -> ' + extra : ''}`); }
}
const ev = (o) => Object.assign({ httpMethod: 'POST', headers: {}, body: '' }, o);
const hdr = (ip, extra) => Object.assign({ origin: SITE, host: HOST, 'x-nf-client-connection-ip': ip }, extra || {});

(async () => {
  console.log('\n-- metodo e origine --');
  let r = await fn.handler(ev({ httpMethod: 'OPTIONS', headers: hdr('1.1.1.1') }));
  check('OPTIONS -> 204', r.statusCode === 204, r.statusCode);
  check('OPTIONS espone X-Session-Token', /X-Session-Token/.test(r.headers['Access-Control-Allow-Headers']));

  r = await fn.handler(ev({ httpMethod: 'PUT', headers: hdr('1.1.1.2') }));
  check('PUT -> 405', r.statusCode === 405, r.statusCode);

  r = await fn.handler(ev({ headers: { origin: 'https://sito-estraneo.tld', host: HOST, 'x-nf-client-connection-ip': '1.1.1.3' } }));
  check('origine estranea -> 403', r.statusCode === 403, r.statusCode);
  check('403 senza Allow-Origin', !r.headers['Access-Control-Allow-Origin']);

  r = await fn.handler(ev({ headers: { host: HOST, 'x-nf-client-connection-ip': '1.1.1.4' } }));
  check('senza Origin -> 403', r.statusCode === 403, r.statusCode);

  console.log('\n-- token --');
  r = await fn.handler(ev({ httpMethod: 'GET', headers: hdr('2.0.0.1') }));
  const tok = JSON.parse(r.body).token;
  check('GET -> 200 con token', r.statusCode === 200 && typeof tok === 'string' && tok.includes('.'), r.statusCode);
  check('token no-store', r.headers['Cache-Control'] === 'no-store');

  r = await fn.handler(ev({ headers: hdr('2.0.0.1'), body: '{}' }));
  check('POST senza token -> 401', r.statusCode === 401, r.statusCode);

  r = await fn.handler(ev({ headers: hdr('2.0.0.1', { 'x-session-token': tok }), body: '{"prompt":""}' }));
  check('POST con token valido supera l\'auth (400 su prompt vuoto)', r.statusCode === 400, r.statusCode);

  r = await fn.handler(ev({ headers: hdr('2.0.0.1', { 'x-session-token': tok.slice(0, -2) + 'ff' }), body: '{}' }));
  check('firma manomessa -> 401', r.statusCode === 401, r.statusCode);

  r = await fn.handler(ev({ headers: hdr('9.9.9.9', { 'x-session-token': tok }), body: '{}' }));
  check('token di un altro IP -> 401', r.statusCode === 401, r.statusCode);

  r = await fn.handler(ev({ headers: hdr('2.0.0.1', { 'x-session-token': 'spazzatura' }), body: '{}' }));
  check('token senza punto -> 401', r.statusCode === 401, r.statusCode);

  const realNow = Date.now;
  Date.now = () => realNow() + 16 * 60 * 1000;
  r = await fn.handler(ev({ headers: hdr('2.0.0.1', { 'x-session-token': tok }), body: '{}' }));
  Date.now = realNow;
  check('token scaduto (+16 min) -> 401', r.statusCode === 401, r.statusCode);

  console.log('\n-- validazione body --');
  const t2 = JSON.parse((await fn.handler(ev({ httpMethod: 'GET', headers: hdr('3.0.0.1') }))).body).token;
  const auth = (extra) => hdr('3.0.0.1', Object.assign({ 'x-session-token': t2 }, extra));

  r = await fn.handler(ev({ headers: auth(), body: '{non json' }));
  check('JSON malformato -> 400', r.statusCode === 400, r.statusCode);

  r = await fn.handler(ev({ headers: auth(), body: JSON.stringify({ prompt: 'x'.repeat(8001) }) }));
  check('prompt troppo lungo -> 400', r.statusCode === 400, r.statusCode);

  r = await fn.handler(ev({ headers: auth(), body: JSON.stringify({ type: 'image', prompt: 'ciao', images: [] }) }));
  check('type image senza immagini -> 400', r.statusCode === 400, r.statusCode);

  r = await fn.handler(ev({ headers: auth(), body: JSON.stringify({ type: 'image', prompt: 'ciao', images: [{ base64: '' }] }) }));
  check('immagini vuote -> 400', r.statusCode === 400, r.statusCode);

  r = await fn.handler(ev({ headers: auth(), body: 'x'.repeat(6 * 1024 * 1024 + 10) }));
  check('body oltre 6MB -> 413', r.statusCode === 413, r.statusCode);

  console.log('\n-- rate limit --');
  let last;
  for (let i = 0; i < 22; i++) last = await fn.handler(ev({ httpMethod: 'GET', headers: hdr('4.0.0.1') }));
  check('oltre 20 richieste/min -> 429', last.statusCode === 429, last.statusCode);
  r = await fn.handler(ev({ httpMethod: 'GET', headers: hdr('4.0.0.2') }));
  check('altro IP non e\' penalizzato', r.statusCode === 200, r.statusCode);

  console.log('\n-- nessun errore rimanda dettagli interni --');
  const leaky = [];
  for (const body of ['{}', '{non json', JSON.stringify({ prompt: '' })]) {
    const res = await fn.handler(ev({ headers: hdr('5.0.0.1', { 'x-session-token': 'x.y' }), body }));
    if (/test-key-non-reale|api\.groq\.com|\/home\/|at Object\./.test(res.body)) leaky.push(res.body);
  }
  check('nessuna chiave/percorso/stack nelle risposte', leaky.length === 0, leaky[0]);

  console.log(`\n${pass} passati, ${fail} falliti`);
  process.exit(fail ? 1 : 0);
})();
