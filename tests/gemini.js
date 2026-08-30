const L = require('./lib');
const https = require('https');
const { EventEmitter } = require('events');

let geminiChiamate = [], groqChiamate = [], geminiRisposte = [], groqRisposte = [];
const CATALOGO_GEMINI = {
  models: [
    { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.7-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.7-flash-lite', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.7-pro', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/imagen-4.0', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.5-flash-preview', supportedGenerationMethods: ['generateContent'] }
  ]
};
const OK_GEMINI = { status: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"tipo":"giacca"}' }] } }] }) };
const OK_GROQ = { status: 200, body: JSON.stringify({ choices: [{ message: { content: '{"tipo":"da groq"}' } }] }) };

https.request = function (opts, cb) {
  const req = new EventEmitter();
  req.write = p => { req._p = p; };
  req.destroy = e => setImmediate(() => req.emit('error', e || new Error('x')));
  req.end = function () {
    setImmediate(() => {
      let out;
      if (opts.hostname === 'generativelanguage.googleapis.com') {
        if (opts.path.startsWith('/v1beta/models?')) out = { status: 200, body: JSON.stringify(CATALOGO_GEMINI) };
        else {
          const modello = decodeURIComponent(opts.path.split('/').pop().split(':')[0]);
          geminiChiamate.push({ modello, corpo: JSON.parse(req._p || '{}'), auth: opts.headers['x-goog-api-key'] });
          out = geminiRisposte.shift() || OK_GEMINI;
        }
      } else {
        if (opts.path === '/openai/v1/models') out = { status: 200, body: JSON.stringify({ data: [{ id: 'openai/gpt-oss-120b' }] }) };
        else { groqChiamate.push(JSON.parse(req._p || '{}')); out = groqRisposte.shift() || OK_GROQ; }
      }
      const res = new EventEmitter();
      res.statusCode = out.status; res.setEncoding = () => {};
      cb(res); res.emit('data', out.body); res.emit('end');
    });
    return req;
  };
  return req;
};

process.env.URL = 'https://damn-vinted.netlify.app';
process.env.GROQ_API_KEY = 'groq-finta';
process.env.GEMINI_API_KEY = 'gemini-finta';
process.env.RATE_LIMIT_PER_MIN = '0';
const fn = require(L.funzione('claude.js'));

const SITE = 'https://damn-vinted.netlify.app', HOST = 'damn-vinted.netlify.app';
let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${e !== undefined ? ' -> ' + JSON.stringify(e) : ''}`); } };

async function post(ip, payload) {
  const t = JSON.parse((await fn.handler({ httpMethod: 'GET', headers: { origin: SITE, host: HOST, 'x-nf-client-connection-ip': ip }, body: '' })).body).token;
  return fn.handler({ httpMethod: 'POST', headers: { origin: SITE, host: HOST, 'x-nf-client-connection-ip': ip, 'x-session-token': t }, body: JSON.stringify(payload) });
}
const reset = () => { geminiChiamate = []; groqChiamate = []; geminiRisposte = []; groqRisposte = []; };
const FOTO = { type: 'image', prompt: 'analizza', images: [{ base64: 'AAA', mime: 'image/jpeg' }], json: true };

(async () => {
  console.log('\n-- scelta del provider --');
  reset();
  let r = await post('1.1.1.1', FOTO);
  let b = JSON.parse(r.body);
  check('le foto vanno a Gemini', r.statusCode === 200 && b.provider === 'gemini', b);
  check('sceglie il flash piu recente, non il 2.5', b.model === 'gemini-3.7-flash', b.model);
  check('scarta lite, pro, embedding e imagen', geminiChiamate.length === 1 && !/lite|pro|embed|imagen/.test(geminiChiamate[0].modello), geminiChiamate.map(c => c.modello));
  check('la chiave viaggia nell\'header, non nell\'URL', geminiChiamate[0].auth === 'gemini-finta');
  check('Groq non viene disturbato', groqChiamate.length === 0);

  reset();
  r = await post('1.1.1.2', { type: 'text', prompt: 'stima', json: true });
  b = JSON.parse(r.body);
  check('il testo resta su Groq (non brucia la quota Gemini)', b.provider === 'groq' && geminiChiamate.length === 0, b.provider);

  console.log('\n-- formato della richiesta a Gemini --');
  reset();
  await post('1.1.1.3', FOTO);
  const corpo = geminiChiamate[0].corpo;
  check('immagine come inline_data, non come data URL', corpo.contents[0].parts[1].inline_data.data === 'AAA');
  check('mime passato correttamente', corpo.contents[0].parts[1].inline_data.mime_type === 'image/jpeg');
  check('JSON garantito anche sulle foto (con Groq non si poteva)', corpo.generationConfig.responseMimeType === 'application/json');
  check('temperatura bassa sulle immagini', corpo.generationConfig.temperature === 0.2, corpo.generationConfig.temperature);

  reset();
  await post('1.1.1.4', { type: 'image', prompt: 'x', images: [{ base64: 'AAA' }], json: false });
  check('senza json:true niente responseMimeType', !geminiChiamate[0].corpo.generationConfig.responseMimeType);

  console.log('\n-- quando Gemini non risponde --');
  reset();
  geminiRisposte = [{ status: 429, body: JSON.stringify({ error: { message: 'quota exceeded' } }) }];
  r = await post('1.1.1.5', FOTO);
  b = JSON.parse(r.body);
  check('quota giornaliera finita -> ripiega su Groq', r.statusCode === 200 && b.provider === 'groq', b);
  check('non insiste su altri modelli Gemini', geminiChiamate.length === 1, geminiChiamate.length);
  // Il ripiego funzionava ma era muto: chi guardava vedeva "groq" e non
  // poteva sapere se la chiave mancasse o se Gemini avesse detto di no.
  check('e dice PERCHE non ha usato Gemini', /quota/i.test(b.gemini || ''), b.gemini);

  reset();
  geminiRisposte = [{ status: 200, body: JSON.stringify({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }) }];
  r = await post('1.1.1.6', FOTO);
  check('risposta bloccata dal filtro -> ripiega su Groq', JSON.parse(r.body).provider === 'groq', r.body);
  check('e anche qui il motivo e scritto', /vuota|SAFETY/i.test(JSON.parse(r.body).gemini || ''), JSON.parse(r.body).gemini);

  reset();
  geminiRisposte = [{ status: 404, body: '{}' }, OK_GEMINI];
  r = await post('1.1.1.7', FOTO);
  check('modello sparito -> prova il successivo, resta su Gemini', JSON.parse(r.body).provider === 'gemini' && geminiChiamate.length === 2, geminiChiamate.map(c => c.modello));
  check('quando Gemini risponde, nessuna nota da spiegare', JSON.parse(r.body).gemini === undefined, JSON.parse(r.body).gemini);
  check('il ripiego e il pro, non il lite (che legge peggio le etichette)', geminiChiamate[1].modello === 'gemini-3.7-pro', geminiChiamate[1].modello);

  reset();
  geminiRisposte = [{ status: 500, body: 'boom' }];
  groqRisposte = [{ status: 500, body: JSON.stringify({ error: { message: 'anche groq giu' } }) }];
  r = await post('1.1.1.8', FOTO);
  check('se cadono entrambi -> 502 pulito', r.statusCode === 502, r.statusCode);
  check('nessuna chiave nelle risposte d\'errore', !/gemini-finta|groq-finta/.test(r.body), r.body);

  console.log('\n-- il catalogo si chiede una volta sola --');
  reset();
  await post('1.1.1.9', FOTO);
  const scelto = geminiChiamate[0] && geminiChiamate[0].modello;
  reset();
  await post('1.1.2.0', FOTO);
  check('secondo giro: una sola chiamata, modello preso dalla cache', geminiChiamate.length === 1 && geminiChiamate[0].modello === scelto, { scelto, ora: geminiChiamate.map(c => c.modello) });

  console.log(`\n${pass} passati, ${fail} falliti`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
