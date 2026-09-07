// Il mercato condiviso: quello che ALBA impara da chi la usa. Nessuna rete e
// nessun database veri - https.request e' sostituito da uno stub, come nelle
// altre suite delle function - quindi qui si guarda esattamente cosa ALBA
// manderebbe a Supabase e come tratta quello che si sente rispondere.
//
// La domanda piu' importante non e' se funziona: e' cosa esce da questo
// telefono. Un campo di troppo in quella riga - il nome del capo scritto a
// mano, una nota - e sarebbe finito in un database condiviso per sempre.
const https = require('https');
const { EventEmitter } = require('events');

let richieste = [], risposte = [];
https.request = function (opts, cb) {
  const req = new EventEmitter();
  let corpo = '';
  req.write = c => { corpo += c; };
  req.destroy = e => setImmediate(() => req.emit('error', e || new Error('x')));
  req.end = function () {
    setImmediate(() => {
      richieste.push({ path: opts.path, method: opts.method, headers: opts.headers, corpo: corpo ? JSON.parse(corpo) : null });
      const out = risposte.shift() || { status: 200, body: '[]' };
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
process.env.RATE_LIMIT_PER_MIN = '0';
process.env.SUPABASE_URL = 'https://finto.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'chiave-di-servizio-finta';

const path = require('path');
const L = require('./lib');
const { chromium } = require('playwright-core');
const { check, fine } = L.contatore();

const S = require(path.join(L.FUNCTIONS, 'lib', 'shared.js'));
const D = require(path.join(L.FUNCTIONS, 'lib', 'deposito.js'));
const fn = require(L.funzione('mercato.js'));

const SITE = 'https://damn-vinted.netlify.app';
const HOST = 'damn-vinted.netlify.app';
const IP = '5.0.0.1';
const token = S.issueToken(IP);
const chiama = (body) => fn.handler({
  httpMethod: 'POST',
  headers: { origin: SITE, host: HOST, 'x-nf-client-connection-ip': IP, 'x-session-token': token },
  body: JSON.stringify(body)
});
const chiamaCon = (body, extra) => fn.handler({
  httpMethod: 'POST',
  headers: Object.assign({ origin: SITE, host: HOST, 'x-nf-client-connection-ip': IP, 'x-session-token': token }, extra),
  body: JSON.stringify(body)
});
const dati = r => { try { return JSON.parse(r.body); } catch { return {}; } };
const reset = () => { richieste = []; risposte = []; D.scordaImpostazioni(); };

const ESITO = { azione: 'segna', marca: 'Carhartt', categoria: 'Felpa', condizione: 'Buono',
  prezzoSuggerito: 40, prezzoVenduto: 30, giorni: 9, dispositivo: 'abcdef0123456789' };

(async () => {
  console.log('\n-- cosa esce davvero da questo telefono --');
  reset();
  risposte = [{ status: 200, body: '[]' }, { status: 201, body: '' }];
  let r = await chiama(ESITO);
  check('un esito valido viene accettato', r.statusCode === 200 && dati(r).salvato === true, r.body);

  const scritta = richieste[richieste.length - 1].corpo[0];
  check('la riga porta solo i campi dei conti',
    JSON.stringify(Object.keys(scritta).sort()) ===
    JSON.stringify(['categoria', 'condizione', 'dispositivo', 'giorni', 'marca', 'prezzo_suggerito', 'prezzo_venduto'].sort()),
    Object.keys(scritta));
  check('e i numeri sono quelli segnati',
    scritta.prezzo_suggerito === 40 && scritta.prezzo_venduto === 30 && scritta.giorni === 9, scritta);
  // La chiave di servizio e' quella che scavalca le policy di riga: va al
  // deposito e da nessun'altra parte. La pagina non la vede mai, perche' qui
  // dentro ci arriva solo la function.
  check('la chiave di servizio viaggia solo verso il deposito',
    richieste.every(x => x.headers.apikey === 'chiave-di-servizio-finta'
      && /^\/rest\/v1\//.test(x.path)), richieste.map(x => x.path));

  console.log('\n-- quello che non entra --');
  const rifiuta = async (nome, patch, atteso) => {
    reset();
    risposte = [{ status: 200, body: '[]' }, { status: 201, body: '' }];
    const rr = await chiama(Object.assign({}, ESITO, patch));
    check(nome, rr.statusCode === (atteso || 400), rr.statusCode + ' ' + rr.body);
  };
  await rifiuta('senza marca non si sa a chi attribuirlo', { marca: '' });
  // Un capo venduto a un ventesimo o a cinque volte il suggerito e' un errore
  // di battitura o qualcuno che gioca: e' la riga che tiene puliti i prezzi.
  await rifiuta('un prezzo venduto venti volte piu\' basso resta fuori', { prezzoVenduto: 1 });
  await rifiuta('e uno dieci volte piu\' alto pure', { prezzoVenduto: 400 });
  await rifiuta('giorni impossibili restano fuori', { giorni: 99999 });
  await rifiuta('senza dispositivo non si puo\' contare niente', { dispositivo: '' });
  await rifiuta('un prezzo scritto a parole non e\' un prezzo', { prezzoVenduto: 'trenta' });

  reset();
  // Il tetto giornaliero: il deposito risponde che di esiti oggi ne sono gia'
  // arrivati venti da qui.
  risposte = [{ status: 200, body: JSON.stringify(Array.from({ length: D.ESITI_AL_GIORNO }, (_, i) => ({ id: i }))) }];
  r = await chiama(ESITO);
  check('oltre il tetto giornaliero non si accetta piu\'', r.statusCode === 429, r.statusCode);

  reset();
  // Deposito muto: l'esito si perde, ma chi ha segnato la vendita non deve
  // vedere un errore - il suo storico ce l'ha comunque.
  risposte = [{ status: 200, body: '[]' }, { status: 500, body: '{"message":"boom"}' }];
  r = await chiama(ESITO);
  check('se il deposito non accetta, non e\' un errore di chi vende',
    r.statusCode === 202 && dati(r).salvato === false, r.statusCode);

  console.log('\n-- la banda del mercato --');
  reset();
  risposte = [{ status: 200, body: JSON.stringify([{ n: 180, scarto: -22.4, giorni: 11.2, ambito: 'marca' }]) }];
  r = await chiama({ azione: 'banda', marca: 'Carhartt', categoria: 'Felpa' });
  check('i conti li fa il database, non la function',
    richieste[0].path === '/rest/v1/rpc/banda_mercato', richieste[0].path);
  check('la banda torna arrotondata', JSON.stringify(dati(r).banda) === JSON.stringify({ n: 180, scarto: -22, giorni: 11, ambito: 'marca' }), r.body);

  reset();
  risposte = [{ status: 200, body: '[]' }];
  r = await chiama({ azione: 'banda', marca: 'Marchio Mai Visto' });
  check('sotto la soglia il mercato non dice niente', dati(r).banda === null, r.body);

  console.log('\n-- l\'interruttore del codice --');
  reset();
  risposte = [{ status: 200, body: JSON.stringify([{ valore: '1' }]) }];
  r = await chiama({ azione: 'impostazioni' });
  check('senza ALBA_PIN l\'interruttore non si mostra',
    dati(r).pinDisponibile === false && dati(r).pinAttivo === false, r.body);

  reset();
  r = await chiama({ azione: 'impostazioni', cambia: true, valore: true });
  check('e non si puo\' accendere quello che non c\'e\'', r.statusCode === 409, r.statusCode);

  // Con il codice configurato: il resto lo prova un processo a parte, perche'
  // ALBA_PIN si legge una volta sola all'avvio.
  const { spawnSync } = require('child_process');
  const conPin = spawnSync(process.execPath, [path.join(__dirname, 'aiuto-mercato-pin.js')], {
    encoding: 'utf8', env: Object.assign({}, process.env, { ALBA_PIN: '4271' })
  });
  const esiti = (conPin.stdout || '').trim().split('\n');
  check('col codice configurato l\'interruttore si mostra', esiti[0] === 'mostra', conPin.stdout + conPin.stderr);
  check('girarlo senza codice -> 401', esiti[1] === '401', conPin.stdout + conPin.stderr);
  check('col codice giusto si spegne, e il deposito lo scrive', esiti[2] === 'spento', conPin.stdout + conPin.stderr);
  // Il senso di tutto il tasto: da spento, il token esce senza codice.
  check('e da spento ALBA torna aperta', esiti[3] === 'aperta', conPin.stdout + conPin.stderr);
  check('mentre da acceso il codice serve di nuovo', esiti[4] === 'chiusa', conPin.stdout + conPin.stderr);

  console.log('\n-- senza deposito il sito resta com\'era --');
  const senza = spawnSync(process.execPath, ['-e', `
    process.env.URL = ${JSON.stringify(SITE)};
    process.env.GROQ_API_KEY = 'groq-finta';
    process.env.SUPABASE_URL = ''; process.env.SUPABASE_SERVICE_KEY = '';
    const S = require(${JSON.stringify(path.join(L.FUNCTIONS, 'lib', 'shared.js'))});
    const fn = require(${JSON.stringify(L.funzione('mercato.js'))});
    fn.handler({ httpMethod:'POST', headers:{ origin:${JSON.stringify(SITE)}, host:${JSON.stringify(HOST)},
      'x-nf-client-connection-ip':'6.0.0.1', 'x-session-token': S.issueToken('6.0.0.1') },
      body: JSON.stringify({ azione:'banda', marca:'Carhartt' }) })
      .then(r => console.log(r.statusCode));
  `], { encoding: 'utf8' });
  check('senza SUPABASE_* il mercato dice che non c\'e\' (501, non un guasto)',
    senza.stdout.trim() === '501', senza.stdout + senza.stderr);

  console.log('\n-- la pagina: l\'interruttore e quello che manda --');
  const server = await L.serviSito(8913);
  const browser = await chromium.launch({ executablePath: L.chromium(), args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errori = [];
  page.on('pageerror', e => errori.push(String(e)));
  await L.senzaGuida(page);

  let mandati = [];
  await page.route('**/api/claude', route => route.request().method() === 'GET'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'finto.token', expiresIn: 900000 }) })
    : route.fulfill({ status: 200, contentType: 'application/json', body: '{"text":"ok"}' }));
  await page.route('**/api/mercato', async route => {
    const b = JSON.parse(route.request().postData() || '{}');
    mandati.push(b);
    if (b.azione === 'impostazioni') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pinDisponibile: true, pinAttivo: true }) });
    if (b.azione === 'banda') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ banda: { n: 180, scarto: -22, giorni: 11, ambito: 'marca' } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"salvato":true}' });
  });

  await page.goto('http://127.0.0.1:8913/', { waitUntil: 'load' });
  await page.evaluate(() => {
    localStorage.clear();
    upsertHistoryItem('m1', { nome: 'Felpa tech', marca: 'Carhartt', condizione: 'Buono', prezzoSuggerito: 40 });
    sw('storico');
  });
  await page.waitForSelector('#impPin:not([hidden])', { timeout: 5000 });
  check('l\'interruttore del codice compare se il server ne ha uno',
    await page.locator('#swPin').isChecked());
  check('e quello del contributo nasce acceso', await page.locator('#swContributo').isChecked());

  // Segnare una vendita manda l'esito, e manda solo quello che deve.
  mandati = [];
  await page.evaluate(() => { esitoChiedi('m1'); });
  await page.fill('#esP_m1', '30');
  await page.fill('#esG_m1', '9');
  await page.click('[data-az="esitoSalva"][data-arg="m1"]');
  await page.waitForFunction(() => true);
  await page.waitForTimeout(300);
  const esito = mandati.find(m => m.azione === 'segna');
  check('segnare una vendita la manda al mercato', !!esito, mandati);
  if (esito) {
    check('con marca, categoria, condizione, prezzi e giorni',
      esito.marca === 'Carhartt' && esito.categoria === 'Felpa tech' && esito.prezzoSuggerito === 40
      && esito.prezzoVenduto === 30 && esito.giorni === 9, esito);
    check('e un dispositivo che e\' un numero a caso, non un nome',
      /^[0-9a-f]{24}$/.test(esito.dispositivo), esito.dispositivo);
    check('niente foto, niente testo scritto a mano',
      !('foto' in esito) && !('consiglio' in esito) && !('annuncio' in esito), Object.keys(esito));
  }

  // Spento, non parte piu' niente.
  mandati = [];
  await page.click('#swContributo');
  await page.evaluate(() => {
    upsertHistoryItem('m2', { nome: 'Giacca', marca: 'Carhartt', condizione: 'Buono', prezzoSuggerito: 50 });
    renderHistory();
    esitoChiedi('m2');
  });
  await page.fill('#esP_m2', '38');
  await page.click('[data-az="esitoSalva"][data-arg="m2"]');
  await page.waitForTimeout(300);
  check('spento, la vendita resta su questo dispositivo',
    !mandati.some(m => m.azione === 'segna'), mandati);
  check('e la scelta si ricorda', await page.evaluate(() => localStorage.getItem('albaContributo')) === '0');

  console.log('\n-- e la stima sente la voce degli altri --');
  let promptVisto = '';
  await page.unroute('**/api/claude');
  await page.route('**/api/claude', route => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'finto.token', expiresIn: 900000 }) });
    promptVisto = JSON.parse(req.postData() || '{}').prompt || '';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: JSON.stringify({ prezzoSuggerito: 30, rangeMin: 24, rangeMax: 38, percentuale: 60, motivazione: 'm', fattori: [], consiglio: 'c' }) }) });
  });
  await page.evaluate(() => {
    sw('prezzo');
    document.getElementById('pNome').value = 'Felpa tech';
    document.getElementById('pMarca').value = 'Carhartt';
  });
  await page.click('#btnP');
  await page.waitForSelector('#rPre:not([style*="display: none"])', { timeout: 20000 });
  check('il prompt riceve gli esiti degli altri venditori',
    /GLI ALTRI VENDITORI[^\n]*180 capi di questa marca/.test(promptVisto), promptVisto.slice(-400));
  check('detti come vendite concluse, non come opinione',
    /vendono il 22% sotto il prezzo suggerito, in 11 giorni/.test(promptVisto), promptVisto.slice(-400));
  // Contano meno dei suoi: chi vende deve restare la voce piu' forte.
  check('e sotto quelli di chi sta vendendo qui',
    /Pesano meno degli esiti di chi sta vendendo qui/.test(promptVisto));

  console.log('\n-- il codice corretto a meta\' del tentativo non lascia a meta\' anche il tasto --');
  // Un pin vecchio salvato sul dispositivo, un token di sessione ancora
  // valido (quindi nessuna finestra finche' non si preme il tasto), e il
  // server che sull'azione "cambia" pretende il pin nuovo. Il primo giro va
  // sotto 401, la finestra chiede il codice, l'utente scrive quello giusto -
  // e il tentativo che segue deve usarlo, non il valore congelato da prima
  // della finestra.
  await page.evaluate(() => { localStorage.setItem('albaPin', 'vecchio'); sessionToken='gia-valido'; sessionTokenExp=Date.now()+900000; });
  let vistiClaudePin = [], vistiMercatoPin = [];
  await page.unroute('**/api/claude');
  await page.route('**/api/claude', route => {
    const req = route.request();
    if (req.method() !== 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"text":"ok"}' });
    const pin = req.headers()['x-alba-pin'] || '';
    vistiClaudePin.push(pin);
    if (pin !== 'nuovo') return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Serve il codice.', codice: 'pin' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'finto.token.2', expiresIn: 900000 }) });
  });
  await page.unroute('**/api/mercato');
  await page.route('**/api/mercato', route => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (b.azione === 'impostazioni' && b.cambia) {
      const pin = route.request().headers()['x-alba-pin'] || '';
      vistiMercatoPin.push(pin);
      if (pin !== 'nuovo') return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Codice sbagliato.', codice: 'pin' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pinAttivo: false }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pinDisponibile: true, pinAttivo: true }) });
  });

  await page.evaluate(() => sw('storico'));
  await page.waitForSelector('#impPin:not([hidden])', { timeout: 5000 });
  await page.click('#swPin');
  await page.waitForSelector('#pin:not([hidden])', { timeout: 5000 });
  await page.fill('#pinIn', 'nuovo');
  await page.click('[data-az="pinConferma"]');
  await page.waitForFunction(() => document.getElementById('swPin').disabled === false, null, { timeout: 5000 });
  await page.waitForTimeout(200);
  const toastFinale = await page.textContent('#toast');
  check('va a buon fine al primo tentativo, senza dover ricliccare',
    !/Sessione non valida/.test(toastFinale), toastFinale);
  // Il primo tentativo prova legittimamente il pin che c'era gia' (il token
  // di sessione era ancora valido, quindi parte prima di sapere che serve
  // aggiornarlo): quello che conta e' che il secondo - quello dopo la
  // finestra - usi il pin appena corretto, non lo stesso di prima congelato.
  check('e il tentativo dopo la finestra usa il pin appena corretto',
    vistiMercatoPin[vistiMercatoPin.length - 1] === 'nuovo' && vistiMercatoPin.length <= 2, vistiMercatoPin);
  check('il tasto riflette la risposta del server, non e\' rimasto a meta\'',
    await page.locator('#swPin').isChecked() === false);

  check('nessun errore JS in tutta la sessione', errori.length === 0, errori);

  await browser.close();
  server.close();
  fine();
})().catch(e => { console.error(e); process.exit(1); });
