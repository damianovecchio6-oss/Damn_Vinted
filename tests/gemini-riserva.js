// La riserva di tempo per il ripiego.
//
// Il guasto vero, visto nei log del sito pubblicato: Gemini sovraccarico, la
// function prova un modello dopo l'altro finche' il budget e' finito, e a quel
// punto il ripiego su Groq non parte piu' - "non c'e' piu' tempo". L'utente si
// prende l'errore di Gemini pur avendo Groq configurato e pronto a rispondere.
// Alzare il budget non lo risolve: sposta solo il momento in cui succede.
//
// La regola che questo file protegge: una fetta del budget e' di Groq, e
// Gemini non la puo' toccare.
const L = require('./lib');
const https = require('https');
const { EventEmitter } = require('events');

// Ogni chiamata a Gemini ci mette un secondo e mezzo e finisce con "sono
// pieno": e' il caso peggiore reale - foto pesanti da caricare e modelli
// sovraccarichi tutti, dove il catalogo non aiuta. Con un tentativo cosi'
// lungo, senza la riserva l'ultimo giro a Gemini sfonda la deadline e la
// richiesta muore col timeout, invece di ripiegare su Groq.
const LATENZA_MS = 1500;
let t0 = 0, partite = [];

const CATALOGO = { models: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.7-pro', 'gemini-2.5-flash']
  .map(n => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })) };
const PIENO = JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE',
  message: 'This model is currently experiencing high demand.' } });
const OK_GROQ = JSON.stringify({ choices: [{ message: { content: '{"tipo":"da groq"}' } }] });

https.request = function (opts, cb) {
  const req = new EventEmitter();
  req.write = p => { req._p = p; };
  req.destroy = e => setImmediate(() => req.emit('error', e || new Error('x')));
  req.end = function () {
    const gemini = opts.hostname === 'generativelanguage.googleapis.com';
    const catalogo = gemini && opts.path.startsWith('/v1beta/models?');
    const chiCosa = catalogo ? 'catalogo' : (gemini ? 'gemini' : 'groq');
    partite.push({ chi: chiCosa, quando: Date.now() - t0 });
    setTimeout(() => {
      const res = new EventEmitter();
      res.setEncoding = () => {};
      let corpo;
      if (catalogo) { res.statusCode = 200; corpo = JSON.stringify(CATALOGO); }
      else if (gemini) { res.statusCode = 503; corpo = PIENO; }
      else if (opts.path === '/openai/v1/models') { res.statusCode = 200; corpo = JSON.stringify({ data: [{ id: 'openai/gpt-oss-120b' }] }); }
      else { res.statusCode = 200; corpo = OK_GROQ; }
      cb(res); res.emit('data', corpo); res.emit('end');
    }, catalogo || !gemini ? 0 : LATENZA_MS);
    return req;
  };
  return req;
};

// Il budget si legge una volta sola all'avvio: va deciso prima di caricare la
// function. Quattro secondi tengono la suite corta e la riserva misurabile.
const BUDGET_MS = 4000;
const RISERVA_MS = Math.round(BUDGET_MS * 0.35);
process.env.AI_TIMEOUT_MS = String(BUDGET_MS);
process.env.URL = 'https://damn-vinted.netlify.app';
process.env.GROQ_API_KEY = 'groq-finta';
process.env.GEMINI_API_KEY = 'gemini-finta';
process.env.RATE_LIMIT_PER_MIN = '0';
delete process.env.GEMINI_MODEL;

const fn = require(L.funzione('claude.js'));
const { check, fine } = L.contatore();

const SITE = 'https://damn-vinted.netlify.app', HOST = 'damn-vinted.netlify.app';
const FOTO = { type: 'image', prompt: 'guarda', images: [{ base64: 'AAA', mime: 'image/jpeg' }], json: true };

(async () => {
  const t = JSON.parse((await fn.handler({ httpMethod: 'GET',
    headers: { origin: SITE, host: HOST, 'x-nf-client-connection-ip': '8.0.0.1' }, body: '' })).body).token;

  t0 = Date.now();
  const r = await fn.handler({ httpMethod: 'POST',
    headers: { origin: SITE, host: HOST, 'x-nf-client-connection-ip': '8.0.0.1', 'x-session-token': t },
    body: JSON.stringify(FOTO) });
  const durata = Date.now() - t0;
  const b = JSON.parse(r.body);

  console.log('\n-- con Gemini pieno, Groq risponde comunque --');
  check('la richiesta non muore: risponde Groq', r.statusCode === 200 && b.provider === 'groq', b);
  check('e dice perche non e stato Gemini', /pien|sovraccarich|modello/i.test(b.gemini || ''), b.gemini);

  const gemini = partite.filter(p => p.chi === 'gemini');
  const groq = partite.find(p => p.chi === 'groq' && p.quando > 0);
  // Gemini ci prova davvero - la riserva non e' un modo di saltarlo - ma
  // quanti tentativi ci stiano dentro lo decide quanto e' lento: con un
  // tentativo da un secondo e mezzo e una fetta da 2.6s, ce ne sta uno.
  check('Gemini viene provato davvero', gemini.length >= 1, gemini.length);
  // Il cuore della regola: l'ultimo tentativo a Gemini parte dentro la sua
  // fetta, non dentro quella di Groq.
  check('nessun tentativo Gemini invade la riserva',
    gemini.every(p => p.quando < BUDGET_MS - RISERVA_MS), gemini.map(p => p.quando));
  check('e Groq parte con la sua fetta ancora intera',
    !!groq && groq.quando <= BUDGET_MS - RISERVA_MS + LATENZA_MS, groq && groq.quando);
  // E tutto questo dentro il budget: la riserva serve a rispondere, non a
  // spostare il timeout un po' piu' in la'.
  check('e si resta dentro al budget', durata < BUDGET_MS, durata);

  fine();
})().catch(e => { console.error(e); process.exit(1); });
