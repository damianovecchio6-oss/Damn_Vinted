const L = require('./lib');
const https = require('https');
const { EventEmitter } = require('events');

// Il caso che si vedeva sul sito: analisi eseguita con un modello Groq, e
// nessun modo di sapere se la chiave Gemini mancasse o avesse fallito.
// Gira in un file suo perche' la function legge GEMINI_API_KEY al caricamento,
// e qui la chiave non deve esserci proprio.
https.request = function (opts, cb) {
  const req = new EventEmitter();
  req.write = function (payload) { req._payload = payload; };
  req.destroy = function () {};
  req.end = function () {
    setImmediate(() => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.setEncoding = () => {};
      cb(res);
      res.emit('data', opts.path === '/openai/v1/models'
        ? JSON.stringify({ data: [{ id: 'qwen/qwen3.6-27b' }] })
        : JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
      res.emit('end');
    });
    return req;
  };
  return req;
};

process.env.URL = 'https://damn-vinted.netlify.app';
process.env.GROQ_API_KEY = 'groq-finta';
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_AI_KEY;
process.env.RATE_LIMIT_PER_MIN = '0';
const fn = require(L.funzione('claude.js'));

const SITE = 'https://damn-vinted.netlify.app', HOST = 'damn-vinted.netlify.app';
const stato = L.contatore();

async function post(ip, payload) {
  const t = JSON.parse((await fn.handler({ httpMethod: 'GET', headers: { origin: SITE, host: HOST, 'x-nf-client-connection-ip': ip }, body: '' })).body).token;
  return fn.handler({
    httpMethod: 'POST',
    headers: { origin: SITE, host: HOST, 'x-nf-client-connection-ip': ip, 'x-session-token': t },
    body: JSON.stringify(payload)
  });
}

(async () => {
  console.log('\n-- senza chiave Gemini, le foto vanno a Groq --');
  let r = await post('7.0.0.1', { type: 'image', prompt: 'x', images: [{ base64: 'AAA' }] });
  let b = JSON.parse(r.body);
  stato.check('l\'analisi arriva lo stesso', r.statusCode === 200 && b.provider === 'groq', b.provider);
  stato.check('e dice che la chiave non c\'e, invece di lasciarlo indovinare',
    /non configurata/.test(b.gemini || ''), b.gemini);

  console.log('\n-- sul testo non c\'entra niente: li Gemini non si usa comunque --');
  r = await post('7.0.0.2', { type: 'text', prompt: 'ciao' });
  b = JSON.parse(r.body);
  stato.check('nessuna nota fuori luogo sul testo', b.gemini === undefined, b.gemini);

  stato.fine();
})();
