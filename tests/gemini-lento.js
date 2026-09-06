// Gemini che non risponde entro la SUA fetta di tempo.
//
// Il guasto vero, dai log del sito su Vercel: "POST /api/claude 504" con
// "Error: Deadline superata" e, subito sopra, "Gemini 503 su gemini-3.8-flash:
// sovraccarico, provo il prossimo". Nessuna riga di Groq: il ripiego non era
// mai partito, e chi caricava le foto leggeva "L'AI ci ha messo troppo" con la
// riserva di Groq ancora intera.
//
// La riserva copriva solo il caso in cui Gemini RISPONDE male in fretta (e
// quello lo prova gemini-riserva.js). Se invece un tentativo e' ancora in volo
// quando scade la fetta di Gemini, la deadline arriva come eccezione e
// scavalca il ripiego: qui il tempo di Gemini che finisce non e' il tempo che
// finisce, e la regola da difendere e' che Groq risponda lo stesso.
const L = require('./lib');
const https = require('https');
const { EventEmitter } = require('events');

const CATALOGO = { models: ['gemini-3.8-flash', 'gemini-3.7-flash']
  .map(n => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })) };
const OK_GROQ = JSON.stringify({ choices: [{ message: { content: '{"tipo":"da groq"}' } }] });

const BUDGET_MS = 6000;
const RISERVA_MS = Math.round(BUDGET_MS * 0.35);
// Piu' lunga del budget intero: Gemini non arrivera' mai, ne' dentro la sua
// fetta ne' dopo. E' il sovraccarico che non risponde invece di dire 503.
const LATENZA_GEMINI = BUDGET_MS + 2000;

let t0 = 0, partite = [];
https.request = function (opts, cb) {
  const req = new EventEmitter();
  req.write = p => { req._p = p; };
  req.destroy = e => setImmediate(() => req.emit('error', e || new Error('x')));
  req.end = function () {
    const gemini = opts.hostname === 'generativelanguage.googleapis.com';
    const catalogo = gemini && opts.path.startsWith('/v1beta/models?');
    partite.push({ chi: catalogo ? 'catalogo' : (gemini ? 'gemini' : 'groq'), quando: Date.now() - t0 });
    const ritardo = catalogo || !gemini ? 0 : LATENZA_GEMINI;
    const timer = setTimeout(() => {
      const res = new EventEmitter();
      res.setEncoding = () => {};
      let corpo;
      if (catalogo) { res.statusCode = 200; corpo = JSON.stringify(CATALOGO); }
      else if (gemini) { res.statusCode = 200; corpo = JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"tipo":"da gemini in ritardo"}' }] } }] }); }
      else if (opts.path === '/openai/v1/models') { res.statusCode = 200; corpo = JSON.stringify({ data: [{ id: 'openai/gpt-oss-120b' }] }); }
      else { res.statusCode = 200; corpo = OK_GROQ; }
      cb(res); res.emit('data', corpo); res.emit('end');
    }, ritardo);
    // Chi viene distrutto dalla deadline non deve tenere in piedi il processo
    // con un timer che scade fra due secondi.
    req.destroy = e => { clearTimeout(timer); setImmediate(() => req.emit('error', e || new Error('x'))); };
    return req;
  };
  return req;
};

process.env.AI_TIMEOUT_MS = String(BUDGET_MS);
process.env.URL = 'https://damn-vinted.vercel.app';
process.env.GROQ_API_KEY = 'groq-finta';
process.env.GEMINI_API_KEY = 'gemini-finta';
process.env.RATE_LIMIT_PER_MIN = '0';
delete process.env.GEMINI_MODEL;

const fn = require(L.funzione('claude.js'));
const { check, fine } = L.contatore();

const SITE = 'https://damn-vinted.vercel.app', HOST = 'damn-vinted.vercel.app';
const FOTO = { type: 'image', prompt: 'guarda', images: [{ base64: 'AAA', mime: 'image/jpeg' }], json: true };

(async () => {
  const t = JSON.parse((await fn.handler({ httpMethod: 'GET',
    headers: { origin: SITE, host: HOST, 'x-nf-client-connection-ip': '9.0.0.1' }, body: '' })).body).token;

  t0 = Date.now();
  const r = await fn.handler({ httpMethod: 'POST',
    headers: { origin: SITE, host: HOST, 'x-nf-client-connection-ip': '9.0.0.1', 'x-session-token': t },
    body: JSON.stringify(FOTO) });
  const durata = Date.now() - t0;
  const b = JSON.parse(r.body);

  console.log('\n-- Gemini non risponde entro la sua fetta --');
  check('la deadline di Gemini non uccide la richiesta',
    r.statusCode !== 504, r.statusCode + ' ' + (b.error || ''));
  check('risponde Groq', r.statusCode === 200 && b.provider === 'groq', b);
  check('e dice perche non e stato Gemini', !!b.gemini, b.gemini);

  const groq = partite.find(p => p.chi === 'groq');
  check('Groq parte quando la fetta di Gemini finisce, non dopo',
    !!groq && groq.quando <= BUDGET_MS - RISERVA_MS + 300, groq && groq.quando);
  check('e si resta dentro al budget', durata < BUDGET_MS, durata);

  fine();
})().catch(e => { console.error(e); process.exit(1); });
