const L = require('./lib');
const https = require('https');
const { EventEmitter } = require('events');

// Stessa impalcatura degli altri test: nessuna rete, https.request sostituito
// da uno stub che restituisce quello che decide la suite.
let ricerche = [], risposta = null;
https.request = function (opts, cb) {
  const req = new EventEmitter();
  req.write = () => {};
  req.destroy = e => setImmediate(() => req.emit('error', e || new Error('x')));
  req.end = function () {
    setImmediate(() => {
      ricerche.push(opts.path);
      const out = risposta || { status: 200, body: JSON.stringify(SERP_OK) };
      const res = new EventEmitter();
      res.statusCode = out.status; res.setEncoding = () => {};
      cb(res); res.emit('data', out.body); res.emit('end');
    });
    return req;
  };
  return req;
};

const SERP_OK = {
  organic_results: [
    { title: 'Felpa Carhartt usata', link: 'https://vinted.it/a', source: 'Vinted', snippet: 'Felpa in ottime condizioni, 45,00 € spedizione inclusa' },
    { title: 'Felpa Carhartt usata', link: 'https://doppione/x', snippet: 'stesso titolo, va scartato 999 €' },
    { title: 'Hoodie Carhartt WIP', link: 'https://subito.it/b', displayed_link: 'subito.it › abbigliamento', snippet: 'Prezzo 30 € trattabili' },
    { title: 'Carhartt hoodie nuova', link: 'javascript:alert(1)', source: 'Shop', snippet: 'da 1.234,50 € invece di 1500' },
    { title: 'Storia del marchio Carhartt', link: 'https://blog.it/c', source: 'Blog', snippet: 'Fondato nel 1889 dalla famiglia' },
    { title: 'Felpa taglia 42', link: 'https://ebay.it/d', source: 'eBay', snippet: 'Vendo felpa, 60 € o scambio' },
    // Senza source ne' displayed_link: la fonte deve uscire dall'host del link.
    ...Array.from({ length: 8 }, (_, i) => ({ title: 'Riempitivo ' + i, link: 'https://www.negozio' + i + '.it/x', snippet: 'niente prezzi qui' }))
  ],
  related_searches: [
    { query: 'felpa carhartt vinted' }, { query: 'carhartt wip prezzo' },
    { query: 'hoodie carhartt usato' }, { query: 'carhartt outlet' }, { query: 'quinta di troppo' }
  ]
};

process.env.URL = 'https://damn-vinted.netlify.app';
process.env.GROQ_API_KEY = 'groq-finta';
process.env.SERPAPI_KEY = 'serp-segretissima';
process.env.RATE_LIMIT_PER_MIN = '0';
const fn = require(L.funzione('ricerca.js'));
const claude = require(L.funzione('claude.js'));

const SITE = 'https://damn-vinted.netlify.app', HOST = 'damn-vinted.netlify.app';
let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${e !== undefined ? ' -> ' + JSON.stringify(e) : ''}`); } };

async function token(ip) {
  return JSON.parse((await claude.handler({ httpMethod: 'GET', headers: { origin: SITE, host: HOST, 'x-nf-client-connection-ip': ip }, body: '' })).body).token;
}
async function post(ip, payload, tok) {
  const t = tok === undefined ? await token(ip) : tok;
  return fn.handler({ httpMethod: 'POST', headers: { origin: SITE, host: HOST, 'x-nf-client-connection-ip': ip, 'x-session-token': t }, body: JSON.stringify(payload) });
}
const reset = () => { ricerche = []; risposta = null; };
// La cache di container e' a chiave query+tipo: ogni controllo che deve vedere
// una richiesta vera a SerpApi usa una query sua.
let contatore = 0;
const nuovaQuery = (testo) => `${testo} ${++contatore}`;

(async () => {
  console.log('\n-- gli stessi controlli delle altre function --');
  let r = await fn.handler({ httpMethod: 'POST', headers: { origin: 'https://altrosito.tld', host: HOST }, body: '{}' });
  check('origine estranea -> 403', r.statusCode === 403, r.statusCode);
  r = await post('3.1.1.1', { query: 'x' }, 'niente');
  check('senza token valido -> 401', r.statusCode === 401, r.statusCode);
  r = await fn.handler({ httpMethod: 'GET', headers: { origin: SITE, host: HOST }, body: '' });
  check('GET -> 405 (i token li da\' claude.js)', r.statusCode === 405, r.statusCode);
  check('il token emesso da claude.js vale anche qui', (await post('3.1.1.2', { query: nuovaQuery('felpa') })).statusCode === 200);

  console.log('\n-- la query --');
  reset();
  r = await post('3.1.1.3', {});
  check('query mancante -> 400', r.statusCode === 400, r.statusCode);
  check('senza query non si chiama SerpApi', ricerche.length === 0);
  r = await post('3.1.1.3', { query: '   ' });
  check('query di soli spazi -> 400', r.statusCode === 400, r.statusCode);

  reset();
  await post('3.1.1.4', { query: '  felpa\n  carhartt   usata  ' + (++contatore) });
  check('newline e spazi doppi normalizzati', /q=felpa%20carhartt%20usata%20\d+/.test(ricerche[0]), ricerche[0]);

  reset();
  await post('3.1.1.5', { query: nuovaQuery('a'.repeat(400)) });
  const qLunga = decodeURIComponent((ricerche[0].match(/q=([^&]+)/) || [])[1] || '');
  check('query troncata a 160 caratteri', qLunga.length === 160, qLunga.length);

  console.log('\n-- richiesta a SerpApi --');
  reset();
  const q1 = nuovaQuery('felpa carhartt');
  await post('3.1.1.6', { query: q1 });
  check('motore google per il tipo web', ricerche[0].includes('engine=google&'), ricerche[0]);
  check('mercato italiano fissato', ricerche[0].includes('google_domain=google.it') && ricerche[0].includes('gl=it') && ricerche[0].includes('hl=it'), ricerche[0]);
  check('la chiave viaggia in query string', ricerche[0].includes('api_key=serp-segretissima'));

  reset();
  await post('3.1.1.7', { query: nuovaQuery('felpa carhartt'), tipo: 'shopping' });
  check('tipo shopping -> engine google_shopping', ricerche[0].includes('engine=google_shopping'), ricerche[0]);
  reset();
  await post('3.1.1.8', { query: nuovaQuery('felpa'), tipo: 'qualcosa-di-strano' });
  check('tipo sconosciuto -> web, non passa all\'API', ricerche[0].includes('engine=google&'), ricerche[0]);

  console.log('\n-- risultati --');
  reset();
  const d = JSON.parse((await post('3.1.1.9', { query: nuovaQuery('felpa carhartt') })).body);
  check('i doppioni per titolo spariscono', d.risultati.filter(x => x.titolo === 'Felpa Carhartt usata').length === 1);
  check('non piu di 8 risultati', d.risultati.length === 8, d.risultati.length);
  check('link non http scartato', d.risultati.some(x => /nuova/.test(x.titolo) && x.link === ''), d.risultati.find(x => /nuova/.test(x.titolo)));
  check('fonte dedotta dal displayed_link', d.risultati.some(x => x.fonte === 'subito.it › abbigliamento'));
  check('fonte dedotta dall\'host quando manca, senza www', d.risultati.some(x => x.titolo === 'Riempitivo 0' && x.fonte === 'negozio0.it'), d.risultati.find(x => x.titolo === 'Riempitivo 0'));
  check('lo snippet viene tenuto, accorciato', d.risultati[0].snippet.startsWith('Felpa in ottime condizioni'));
  check('ricerche correlate riportate, al massimo 4', d.correlate.length === 4 && d.correlate[0] === 'felpa carhartt vinted', d.correlate);

  console.log('\n-- prezzi letti nello snippet --');
  check('45,00 € letto come 45', d.risultati.find(x => x.titolo === 'Felpa Carhartt usata').prezzo.valore === 45);
  check('"Prezzo 30 €" letto come 30', d.risultati.find(x => /Hoodie/.test(x.titolo)).prezzo.valore === 30);
  check('1.234,50 € letto come 1234.5 (punto = migliaia)', d.risultati.find(x => /nuova/.test(x.titolo)).prezzo.valore === 1234.5, d.risultati.find(x => /nuova/.test(x.titolo)).prezzo);
  check('un anno non diventa un prezzo', d.risultati.find(x => /Storia del marchio/.test(x.titolo)).prezzo === null);
  check('nessun prezzo -> null, non NaN', d.risultati.find(x => x.titolo === 'Riempitivo 0').prezzo === null);
  // prezzi tra i primi 8: 45, 30, 1234.5, 60 -> mediana (45+60)/2 = 52.5
  check('mediana sui prezzi trovati', d.prezzi.n === 4 && d.prezzi.mediana === 52.5, d.prezzi);
  check('min e max corretti', d.prezzi.min === 30 && d.prezzi.max === 1234.5, d.prezzi);

  reset();
  risposta = { status: 200, body: JSON.stringify({ shopping_results: [{ title: 'Felpa nuova', link: 'https://x.it/1', source: 'Zalando', extracted_price: 89.9, price: '89,90 €' }] }) };
  const dShop = JSON.parse((await post('3.1.2.0', { query: nuovaQuery('felpa'), tipo: 'shopping' })).body);
  check('extracted_price delle schede shopping usato com\'e\'', dShop.risultati[0].prezzo.valore === 89.9, dShop.risultati[0]);

  reset();
  risposta = { status: 200, body: JSON.stringify({ organic_results: [{ title: 'In dollari', link: 'https://us.shop/1', snippet: 'only $ 40 today' }] }) };
  const dDollari = JSON.parse((await post('3.1.2.1', { query: nuovaQuery('hoodie') })).body);
  check('valuta diversa riconosciuta', dDollari.risultati[0].prezzo.valuta === '$', dDollari.risultati[0].prezzo);
  check('i dollari restano fuori dalla mediana in euro', dDollari.prezzi === null, dDollari.prezzi);

  reset();
  risposta = { status: 200, body: JSON.stringify({}) };
  const dVuoto = JSON.parse((await post('3.1.2.2', { query: nuovaQuery('capo introvabile') })).body);
  check('risposta senza risultati -> lista vuota, non errore', Array.isArray(dVuoto.risultati) && dVuoto.risultati.length === 0);
  check('nessun prezzo -> prezzi null', dVuoto.prezzi === null);

  console.log('\n-- l\'euro scritto a parole, come lo scrivono gli annunci --');
  reset();
  risposta = { status: 200, body: JSON.stringify({ organic_results: [
    { title: 'Prezzo a parole', link: 'https://vinted.it/e', source: 'Vinted', snippet: 'Come nuova, 35 euro spedizione inclusa' },
    { title: 'Euro davanti', link: 'https://subito.it/f', source: 'Subito', snippet: 'Euro 28 trattabili, ritiro a mano' },
    { title: 'Attaccato al numero', link: 'https://depop.it/g', source: 'Depop', snippet: 'prezzo 22euro spedito' },
    { title: 'Solo eur', link: 'https://ebay.it/i', source: 'eBay', snippet: 'base asta 19 EUR' },
    { title: 'Parola che contiene eur', link: 'https://blog.it/h', source: 'Blog', snippet: 'Il neurologo consiglia 8 ore di sonno' }
  ] }) };
  const dEuro = JSON.parse((await post('3.1.1.9', { query: nuovaQuery('felpa a parole') })).body);
  const per = t => dEuro.risultati.find(x => x.titolo === t) || {};
  check('"35 euro" letto come 35', (per('Prezzo a parole').prezzo || {}).valore === 35, per('Prezzo a parole'));
  check('"Euro 28" letto come 28', (per('Euro davanti').prezzo || {}).valore === 28, per('Euro davanti'));
  check('"22euro" attaccato letto come 22', (per('Attaccato al numero').prezzo || {}).valore === 22, per('Attaccato al numero'));
  check('"19 EUR" continua a funzionare', (per('Solo eur').prezzo || {}).valore === 19, per('Solo eur'));
  check('"neurologo" non diventa un prezzo', per('Parola che contiene eur').prezzo === null, per('Parola che contiene eur'));
  check('mediana anche sui prezzi scritti a parole', dEuro.prezzi.n === 4 && dEuro.prezzi.mediana === 25, dEuro.prezzi);

  console.log('\n-- cache: la quota SerpApi e\' 250 al mese --');
  reset();
  const ripetuta = nuovaQuery('giacca levis');
  await post('3.1.2.3', { query: ripetuta });
  const r2 = await post('3.1.2.4', { query: ripetuta.toUpperCase() });
  check('la stessa query non ricerca due volte', ricerche.length === 1, ricerche.length);
  check('la seconda risposta e\' marcata come cache', JSON.parse(r2.body).cache === true);
  await post('3.1.2.5', { query: ripetuta, tipo: 'shopping' });
  check('web e shopping restano due ricerche distinte', ricerche.length === 2, ricerche.length);

  console.log('\n-- errori --');
  reset();
  risposta = { status: 429, body: JSON.stringify({ error: 'You ran out of searches' }) };
  r = await post('3.1.2.6', { query: nuovaQuery('felpa') });
  check('quota finita -> 429 con messaggio chiaro', r.statusCode === 429 && /esaurite/.test(r.body), r.body);
  check('la chiave SerpApi non trapela mai', !/serp-segretissima/.test(r.body), r.body);

  reset();
  risposta = { status: 401, body: JSON.stringify({ error: 'Invalid API key' }) };
  r = await post('3.1.2.7', { query: nuovaQuery('felpa') });
  check('401 upstream -> 502 (non 401: non e\' la sessione)', r.statusCode === 502, r.statusCode);

  reset();
  risposta = { status: 200, body: 'non e json' };
  r = await post('3.1.2.8', { query: nuovaQuery('felpa') });
  check('risposta non JSON -> 502', r.statusCode === 502, r.statusCode);
  reset();
  risposta = { status: 200, body: JSON.stringify({ error: 'Google hasn\'t returned any results' }) };
  r = await post('3.1.2.9', { query: nuovaQuery('felpa') });
  check('errore dentro un 200 -> 502', r.statusCode === 502, r.statusCode);
  // Un guasto passeggero non deve restare impresso: la stessa query, subito
  // dopo, deve tornare a chiedere a SerpApi.
  reset();
  const dopoErrore = nuovaQuery('felpa');
  risposta = { status: 500, body: 'boom' };
  await post('3.1.2.9', { query: dopoErrore });
  risposta = null;
  const rRipresa = await post('3.1.3.0', { query: dopoErrore });
  check('un errore non finisce in cache', ricerche.length === 2 && rRipresa.statusCode === 200, { ricerche: ricerche.length, status: rRipresa.statusCode });

  reset();
  r = await post('3.1.3.1', { query: 'x'.repeat(40 * 1024) });
  check('corpo oltre il limite -> 413', r.statusCode === 413, r.statusCode);
  check('non ci prova nemmeno', ricerche.length === 0);

  console.log('\n-- senza chiave SerpApi --');
  delete require.cache[require.resolve(L.funzione('ricerca.js'))];
  delete process.env.SERPAPI_KEY;
  const senza = require(L.funzione('ricerca.js'));
  r = await senza.handler({ httpMethod: 'POST', headers: { origin: SITE, host: HOST, 'x-nf-client-connection-ip': '3.3.3.3', 'x-session-token': await token('3.3.3.3') }, body: JSON.stringify({ query: 'felpa' }) });
  check('501, cosi la pagina sa di dover nascondere la scheda', r.statusCode === 501, r.statusCode);

  console.log(`\n${pass} passati, ${fail} falliti`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
