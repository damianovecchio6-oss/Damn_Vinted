// La porta su Vercel. Due domande: l'adattatore consegna alla function un
// event uguale a quello che le arriverebbe da Netlify, e la configurazione dei
// due host dice le stesse cose? La seconda non e' pignoleria - gli header di
// sicurezza stanno scritti in due file diversi, e il giorno che uno cambia
// senza l'altro il sito ha una CSP su un host e un'altra sull'altro.
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const L = require('./lib');
const { check, fine } = L.contatore();

const adatta = require(path.join(L.FUNCTIONS, 'lib', 'vercel.js'));

// Una domanda a un processo pulito: le costanti che dipendono dall'ambiente
// si leggono una volta sola all'avvio, e qui ne servono due versioni.
function spawnSyncNode(codice) {
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, ['-e', codice], {
    encoding: 'utf8', env: Object.assign({}, process.env, { VERCEL: '' })
  });
  return (r.stdout || r.stderr || '').trim();
}

// Una richiesta e una risposta di Node quel tanto che basta all'adattatore.
function richiesta(opzioni) {
  const o = opzioni || {};
  // Uno stream che finisce subito e' il caso "nessun corpo": uno che non
  // finisce mai lascerebbe l'adattatore ad aspettare per sempre, e il test a
  // uscire in silenzio come se fosse andato tutto bene.
  const req = Readable.from(o.corpoStream !== undefined ? [o.corpoStream] : []);
  req.method = o.method || 'POST';
  req.url = o.url || '/api/claude';
  req.headers = o.headers || {};
  if (o.body !== undefined) req.body = o.body;
  return req;
}

function risposta() {
  const res = {
    statusCode: 200, headers: {}, corpo: null, chiusa: false,
    setHeader(k, v) { this.headers[k] = v; },
    end(c) { this.corpo = c; this.chiusa = true; }
  };
  return res;
}

const esegui = (handler, opzioni) => {
  const res = risposta();
  return adatta(handler)(richiesta(opzioni), res).then(() => res);
};

(async () => {
  console.log('\n-- l\'adattatore: da (req,res) a event e ritorno --');

  let visto = null;
  const spia = async (event) => {
    visto = event;
    return { statusCode: 201, headers: { 'Content-Type': 'application/json', 'X-Prova': 'si' }, body: '{"ok":true}' };
  };

  const res = await esegui(spia, {
    method: 'POST', url: '/api/ricerca?q=felpa&n=3',
    headers: { origin: 'https://sito.test', 'x-session-token': 'tok' },
    body: { prompt: 'ciao' }
  });

  check('il metodo arriva come httpMethod', visto.httpMethod === 'POST', visto.httpMethod);
  // Gli header sono il pezzo che decide origine, token e IP: se si perdessero
  // qui, la function direbbe "origine non autorizzata" a tutti.
  check('gli header arrivano interi', visto.headers.origin === 'https://sito.test'
    && visto.headers['x-session-token'] === 'tok', visto.headers);
  check('la query diventa queryStringParameters',
    visto.queryStringParameters.q === 'felpa' && visto.queryStringParameters.n === '3', visto.queryStringParameters);
  // Vercel il JSON lo parsa da solo: se lo si ripassasse cosi' com'e', la
  // function farebbe JSON.parse su un oggetto e vedrebbe "[object Object]".
  check('il corpo gia\' parsato torna stringa JSON', visto.body === '{"prompt":"ciao"}', visto.body);
  check('e non si dichiara mai base64', visto.isBase64Encoded === false);

  check('lo stato torna indietro', res.statusCode === 201, res.statusCode);
  check('gli header della risposta pure', res.headers['X-Prova'] === 'si'
    && res.headers['Content-Type'] === 'application/json', res.headers);
  check('e il corpo arriva a destinazione', res.corpo === '{"ok":true}', res.corpo);

  // Il corpo non toccato si legge dallo stream, come faceva Netlify.
  const daStream = await esegui(spia, { body: undefined, corpoStream: '{"dalla":"rete"}' });
  check('un corpo non parsato si legge dallo stream', visto.body === '{"dalla":"rete"}', visto.body);
  check('e la risposta esce lo stesso', daStream.chiusa === true);

  // Una GET non ha corpo: deve arrivare stringa vuota, non undefined, o il
  // `event.body || ''` delle function nasconderebbe il problema per caso.
  await esegui(spia, { method: 'GET', body: undefined, corpoStream: '' });
  check('una GET porta un corpo vuoto, non mancante', visto.body === '', visto.body);

  // Se la function lancia, la richiesta non deve restare appesa fino al
  // timeout della piattaforma: un 500 detto subito e' piu' onesto.
  const rotta = await esegui(async () => { throw new Error('crash'); }, {});
  check('una function che esplode risponde 500, non muore in silenzio',
    rotta.statusCode === 500 && rotta.chiusa === true, [rotta.statusCode, rotta.corpo]);

  console.log('\n-- le tre function ci sono, e sono le stesse --');
  for (const nome of ['claude', 'lens', 'ricerca', 'mercato']) {
    const modulo = require(path.join(L.RADICE, 'api', nome + '.js'));
    check(`api/${nome}.js e\' una function di Vercel`, typeof modulo === 'function');
    // Il codice vero non e' duplicato: l'entrypoint richiama quello di
    // netlify/functions, che e' lo stesso che girano tutte le altre suite.
    const sorgente = fs.readFileSync(path.join(L.RADICE, 'api', nome + '.js'), 'utf8');
    check(`e non ricopia il codice, lo richiama`, /require\('\.\.\/netlify\/functions\//.test(sorgente));
  }

  console.log('\n-- i due host dicono la stessa cosa --');
  const headers = fs.readFileSync(path.join(L.SITO, '_headers'), 'utf8');
  const conf = JSON.parse(fs.readFileSync(path.join(L.RADICE, 'vercel.json'), 'utf8'));
  const globali = (conf.headers.find(h => h.source === '/(.*)') || {}).headers || [];
  const valore = chiave => (globali.find(h => h.key === chiave) || {}).value;

  // Ogni riga della sezione globale di _headers deve avere il suo gemello in
  // vercel.json, con lo stesso identico valore.
  const sezioneGlobale = headers.split(/\n(?=\/)/)[0];
  const righe = sezioneGlobale.split('\n').map(r => r.trim())
    .filter(r => /^[A-Za-z-]+:/.test(r) && !r.startsWith('#'));
  check('la sezione globale di _headers ha delle regole da confrontare', righe.length >= 5, righe.length);
  for (const riga of righe) {
    const taglio = riga.indexOf(':');
    const chiave = riga.slice(0, taglio).trim(), atteso = riga.slice(taglio + 1).trim();
    check(`${chiave} e\' identico sui due host`, valore(chiave) === atteso, { vercel: valore(chiave), netlify: atteso });
  }

  check('il service worker non invecchia neanche su Vercel',
    (conf.headers.find(h => h.source === '/sw.js') || { headers: [] }).headers
      .some(h => h.key === 'Cache-Control' && h.value === 'no-cache'));
  // public/ e non la radice: con la radice finirebbero serviti come file
  // statici il sorgente delle function e i test.
  check('si pubblica solo public/', conf.outputDirectory === 'public', conf.outputDirectory);
  // Il budget di tempo: su Vercel il tetto lo scriviamo noi, e deve stare
  // sopra a quello che le function si danno da sole - se maxDuration fosse
  // piu' basso, a chiudere la richiesta sarebbe la piattaforma, e l'utente
  // vedrebbe una pagina di errore invece del nostro JSON.
  const maxDurata = ((conf.functions || {})['api/*.js'] || {}).maxDuration;
  const budget = spawnSyncNode(`
    process.env.VERCEL = '1';
    const S = require(${JSON.stringify(path.join(L.FUNCTIONS, 'lib', 'shared.js'))});
    console.log(S.TEMPO_MASSIMO);
  `);
  check('su Vercel le function si danno piu\' tempo che su Netlify',
    Number(budget) > 9000, budget);
  check('e il tetto di Vercel sta sopra a quel budget',
    maxDurata * 1000 > Number(budget), [maxDurata, budget]);
  // Il cliente aspetta 25s prima di mollare: un budget piu' lungo di cosi'
  // sarebbe tempo speso per una risposta che nessuno legge piu'.
  const attesaPagina = (fs.readFileSync(path.join(L.SITO, 'app.js'), 'utf8')
    .match(/const AI_TIMEOUT_MS\s*=\s*(\d+)/) || [])[1];
  check('e sotto a quanto la pagina e\' disposta ad aspettare',
    Number(budget) < Number(attesaPagina), [budget, attesaPagina]);

  const senzaVercel = spawnSyncNode(`
    delete process.env.VERCEL;
    const S = require(${JSON.stringify(path.join(L.FUNCTIONS, 'lib', 'shared.js'))});
    console.log(S.TEMPO_MASSIMO);
  `);
  check('su Netlify restano i 9s che stanno dentro ai suoi 10',
    Number(senzaVercel) === 9000, senzaVercel);

  check('la strada vecchia delle function resta in piedi',
    (conf.rewrites || []).some(r => r.source.startsWith('/.netlify/functions/') && r.destination.startsWith('/api/')),
    conf.rewrites);

  // E su Netlify la strada nuova deve arrivare alle function vere.
  const toml = fs.readFileSync(path.join(L.RADICE, 'netlify.toml'), 'utf8');
  check('e su Netlify /api/ arriva alle function',
    /from = "\/api\/\*"/.test(toml) && /to = "\/\.netlify\/functions\/:splat"/.test(toml), toml.slice(-260));

  console.log('\n-- l\'origine del sito su Vercel e\' riconosciuta --');
  // VERCEL_URL arriva senza schema: senza il https:// davanti non
  // combacerebbe mai con un Origin vero, e la function rifiuterebbe la
  // propria pagina.
  const { spawnSync } = require('child_process');
  const prova = spawnSync(process.execPath, ['-e', `
    process.env.VERCEL_URL = 'alba-prova.vercel.app';
    const S = require(${JSON.stringify(path.join(L.FUNCTIONS, 'lib', 'shared.js'))});
    console.log(S.isAllowed('https://alba-prova.vercel.app', {}) ? 'si' : 'no');
  `], { encoding: 'utf8' });
  check('il dominio di Vercel entra nell\'allowlist', prova.stdout.trim() === 'si', prova.stdout + prova.stderr);

  fine();
})().catch(e => { console.error(e); process.exit(1); });
