const L = require('./lib');
const https = require('https');
const { EventEmitter } = require('events');

let upload = [], ricerche = [], rispostaUpload = null, rispostaLens = null;
https.request = function (opts, cb) {
  const req = new EventEmitter();
  const pezzi = [];
  req.write = p => pezzi.push(Buffer.isBuffer(p) ? p : Buffer.from(p));
  req.destroy = e => setImmediate(() => req.emit('error', e || new Error('x')));
  req.end = function () {
    setImmediate(() => {
      let out;
      if (opts.path === '/image') {
        upload.push({ corpo: Buffer.concat(pezzi), headers: opts.headers });
        out = rispostaUpload || { status: 200, body: JSON.stringify({ message: 'Image uploaded successfully.', image_id: 'IMG123' }) };
      } else {
        ricerche.push(opts.path);
        out = rispostaLens || { status: 200, body: JSON.stringify(LENS_OK) };
      }
      const res = new EventEmitter();
      res.statusCode = out.status; res.setEncoding = () => {};
      cb(res); res.emit('data', out.body); res.emit('end');
    });
    return req;
  };
  return req;
};

const LENS_OK = {
  related_content: [{ query: 'giacca levis vintage anni 90' }],
  exact_matches: [{ title: 'Levi\'s Trucker Jacket 90s', source: 'Vinted', link: 'https://vinted.it/x', price: { value: '€45', extracted_value: 45, currency: '€' }, thumbnail: 'https://x/t.jpg' }],
  visual_matches: [
    { title: 'Levi\'s Trucker Jacket 90s', source: 'Duplicato', link: 'https://a/b', price: { extracted_value: 999, currency: '€' } },
    { title: 'Giacca di jeans Levi\'s', source: 'eBay', link: 'https://ebay.it/y', price: { extracted_value: 30, currency: '€' } },
    { title: 'Denim jacket', source: 'Shop', link: 'javascript:alert(1)', price: { extracted_value: 60, currency: '€' }, thumbnail: 'http://insicuro/t.jpg' },
    { title: 'Senza prezzo', source: 'Blog', link: 'https://blog/z' },
    ...Array.from({ length: 12 }, (_, i) => ({ title: 'Riempitivo ' + i, source: 's', link: 'https://r/' + i }))
  ]
};

process.env.URL = 'https://damn-vinted.netlify.app';
process.env.GROQ_API_KEY = 'groq-finta';
process.env.SERPAPI_KEY = 'serp-segretissima';
process.env.RATE_LIMIT_PER_MIN = '0';
const fn = require(L.funzione('lens.js'));
const claude = require(L.funzione('claude.js'));

const SITE = 'https://damn-vinted.netlify.app', HOST = 'damn-vinted.netlify.app';
let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${e !== undefined ? ' -> ' + JSON.stringify(e) : ''}`); } };
const IMG = Buffer.from('immagine-finta-jpeg').toString('base64');

async function token(ip) {
  return JSON.parse((await claude.handler({ httpMethod: 'GET', headers: { origin: SITE, host: HOST, 'x-nf-client-connection-ip': ip }, body: '' })).body).token;
}
async function post(ip, payload, tok) {
  const t = tok === undefined ? await token(ip) : tok;
  return fn.handler({ httpMethod: 'POST', headers: { origin: SITE, host: HOST, 'x-nf-client-connection-ip': ip, 'x-session-token': t }, body: JSON.stringify(payload) });
}
const reset = () => { upload = []; ricerche = []; rispostaUpload = null; rispostaLens = null; };

(async () => {
  console.log('\n-- gli stessi controlli dell\'altra function --');
  let r = await fn.handler({ httpMethod: 'POST', headers: { origin: 'https://altrosito.tld', host: HOST }, body: '{}' });
  check('origine estranea -> 403', r.statusCode === 403, r.statusCode);
  r = await post('1.1.1.1', { image: IMG }, 'niente');
  check('senza token valido -> 401', r.statusCode === 401, r.statusCode);
  r = await fn.handler({ httpMethod: 'GET', headers: { origin: SITE, host: HOST }, body: '' });
  check('GET -> 405 (i token li da\' l\'altra function)', r.statusCode === 405, r.statusCode);
  check('il token emesso da claude.js vale anche qui', (await post('1.1.1.2', { image: IMG })).statusCode === 200);

  console.log('\n-- richiesta a SerpApi --');
  reset();
  await post('1.1.1.3', { image: IMG });
  const corpo = upload[0].corpo.toString('latin1');
  const boundary = upload[0].headers['Content-Type'].split('boundary=')[1];
  check('multipart con boundary coerente', corpo.startsWith('--' + boundary), upload[0].headers['Content-Type']);
  check('campo api_key presente', corpo.includes('name="api_key"') && corpo.includes('serp-segretissima'));
  check('campo image presente col mime giusto', corpo.includes('name="image"') && corpo.includes('Content-Type: image/jpeg'));
  check('i byte dell\'immagine arrivano intatti', corpo.includes('immagine-finta-jpeg'));
  check('chiude col boundary finale', corpo.trimEnd().endsWith('--' + boundary + '--'));
  check('Content-Length calcolato sui byte, non sui caratteri', upload[0].headers['Content-Length'] === upload[0].corpo.length);
  check('la ricerca usa image_id, non un URL', ricerche[0].includes('image_id=IMG123') && !ricerche[0].includes('url='), ricerche[0]);
  check('mercato italiano', ricerche[0].includes('country=it') && ricerche[0].includes('hl=it'));

  console.log('\n-- risultati --');
  reset();
  r = await post('1.1.1.4', { image: IMG });
  const d = JSON.parse(r.body);
  check('riporta l\'ipotesi di Lens', d.ipotesi === 'giacca levis vintage anni 90', d.ipotesi);
  check('exact_matches prima dei visual_matches', d.risultati[0].fonte === 'Vinted', d.risultati[0]);
  check('i doppioni per titolo spariscono', d.risultati.filter(x => /Trucker Jacket 90s/.test(x.titolo)).length === 1);
  check('non piu di 8 risultati', d.risultati.length === 8, d.risultati.length);
  check('link non http scartato', d.risultati.some(x => x.titolo === 'Denim jacket' && x.link === ''), d.risultati.find(x => x.titolo === 'Denim jacket'));
  check('thumbnail http (non https) scartata', d.risultati.every(x => !x.thumbnail || x.thumbnail.startsWith('https://')));
  check('voce senza prezzo tenuta, con prezzo null', d.risultati.some(x => x.titolo === 'Senza prezzo' && x.prezzo === null));

  console.log('\n-- prezzi --');
  // prezzi presenti tra i primi 8: 45 (exact), 30, 60  -> mediana 45
  check('conta solo i prezzi veri', d.prezzi.n === 3, d.prezzi);
  check('mediana corretta', d.prezzi.mediana === 45, d.prezzi);
  check('min e max corretti', d.prezzi.min === 30 && d.prezzi.max === 60, d.prezzi);

  reset();
  rispostaLens = { status: 200, body: JSON.stringify({ visual_matches: [{ title: 'Solo uno', source: 's' }] }) };
  d2 = JSON.parse((await post('1.1.1.5', { image: IMG })).body);
  check('nessun prezzo trovato -> prezzi null, non NaN', d2.prezzi === null, d2.prezzi);

  console.log('\n-- errori --');
  reset();
  r = await post('1.1.1.6', { image: 'A'.repeat(700 * 1024) });
  check('immagine oltre il limite di SerpApi -> 413', r.statusCode === 413, r.statusCode);
  check('non ci prova nemmeno', upload.length === 0);

  reset();
  rispostaUpload = { status: 429, body: JSON.stringify({ error: 'You ran out of searches' }) };
  r = await post('1.1.1.7', { image: IMG });
  check('quota mensile finita -> 429 con messaggio chiaro', r.statusCode === 429 && /esaurite/.test(r.body), r.body);
  check('la chiave SerpApi non trapela mai', !/serp-segretissima/.test(r.body), r.body);

  reset();
  rispostaLens = { status: 401, body: JSON.stringify({ error: 'Invalid API key' }) };
  r = await post('1.1.1.8', { image: IMG });
  check('401 upstream -> 502 (non 401: non e la sessione)', r.statusCode === 502, r.statusCode);

  reset();
  r = await post('1.1.1.9', {});
  check('senza immagine -> 400', r.statusCode === 400, r.statusCode);

  console.log('\n-- senza chiave SerpApi --');
  delete require.cache[require.resolve(L.funzione('lens.js'))];
  delete process.env.SERPAPI_KEY;
  const senza = require(L.funzione('lens.js'));
  r = await senza.handler({ httpMethod: 'POST', headers: { origin: SITE, host: HOST, 'x-nf-client-connection-ip': '2.2.2.2', 'x-session-token': await token('2.2.2.2') }, body: JSON.stringify({ image: IMG }) });
  check('501, cosi la pagina sa di dover nascondere il bottone', r.statusCode === 501, r.statusCode);

  console.log(`\n${pass} passati, ${fail} falliti`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
