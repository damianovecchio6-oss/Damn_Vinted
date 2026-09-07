// L'account personale: email+password via Supabase Auth, il nostro token al
// posto del suo, e lo storico che si legge/scrive/carica foto solo per chi
// quel token ce l'ha. Gira in un file suo perche' serve un https.request
// finto che sa rispondere a rotte diverse (auth, rest, storage) - lo stesso
// principio di tests/gemini-freddo.js, applicato a un altro servizio.
const https = require('https');
const path = require('path');
const { spawnSync } = require('child_process');
const { EventEmitter } = require('events');
const L = require('./lib');
const { chromium } = require('playwright-core');
const { check, fine } = L.contatore();

process.env.URL = 'https://damn-vinted.netlify.app';
process.env.GROQ_API_KEY = 'test-key-non-reale';
process.env.RATE_LIMIT_PER_MIN = '200';
delete process.env.ALBA_PIN;

const SITE = 'https://damn-vinted.netlify.app', HOST = 'damn-vinted.netlify.app';
const ev = (body, extra) => ({ httpMethod: 'POST', headers: Object.assign({ origin: SITE, host: HOST }, extra || {}), body: JSON.stringify(body) });
const corpo = r => { try { return JSON.parse(r.body); } catch { return {}; } };

// Il finto Supabase: risponde diverso secondo la rotta, e registra ogni
// chiamata cosi' i controlli possono guardare cosa e' arrivato davvero -
// soprattutto il filtro user_id, che e' l'unica cosa che tiene separati gli
// storici di due persone.
let credenzialiValide = { email: 'io@esempio.it', password: 'segreta1' };
let emailGiaRegistrata = '';
let righeStorico = [];
let chiamate = [];

https.request = function (opts, cb) {
  const req = new EventEmitter();
  let corpoInviato = '';
  req.write = p => { corpoInviato += (Buffer.isBuffer(p) ? p : Buffer.from(String(p))); };
  req.destroy = e => setImmediate(() => req.emit('error', e || new Error('x')));
  req.end = function () {
    chiamate.push({ path: opts.path, method: opts.method });
    setImmediate(() => {
      const res = new EventEmitter();
      res.setEncoding = () => {};
      let status = 200, out = '{}';

      if (opts.path === '/auth/v1/signup') {
        const b = JSON.parse(corpoInviato || '{}');
        if (b.email === emailGiaRegistrata) { status = 400; out = JSON.stringify({ msg: 'User already registered' }); }
        else { status = 200; out = JSON.stringify({ id: 'u_' + b.email, confirmed_at: null, identities: [{}] }); }
      } else if (opts.path === '/auth/v1/token?grant_type=password') {
        const b = JSON.parse(corpoInviato || '{}');
        if (b.email === credenzialiValide.email && b.password === credenzialiValide.password) {
          status = 200; out = JSON.stringify({ access_token: 'sb.finto', user: { id: 'uid_1' } });
        } else { status = 400; out = JSON.stringify({ error_description: 'Invalid login credentials' }); }
      } else if (opts.path === '/auth/v1/recover') {
        status = 200; out = '{}';
      } else if (opts.path === '/auth/v1/user') {
        status = (opts.headers.Authorization === 'Bearer token-di-recupero-valido') ? 200 : 401;
        out = status === 200 ? '{}' : JSON.stringify({ msg: 'invalid token' });
      } else if (/^\/rest\/v1\/storico_utenti\?user_id=eq\./.test(opts.path) && opts.method === 'GET') {
        const uid = decodeURIComponent(opts.path.match(/user_id=eq\.([^&]+)/)[1]);
        status = 200; out = JSON.stringify(righeStorico.filter(r => r.user_id === uid));
      } else if (opts.path === '/rest/v1/storico_utenti' && opts.method === 'POST') {
        const righe = JSON.parse(corpoInviato || '[]');
        righe.forEach(r => { righeStorico = righeStorico.filter(x => !(x.user_id === r.user_id && x.id === r.id)); righeStorico.push(r); });
        status = 200; out = '';
      } else if (/^\/rest\/v1\/storico_utenti\?id=eq\./.test(opts.path) && opts.method === 'DELETE') {
        const m = opts.path.match(/id=eq\.([^&]+)&user_id=eq\.([^&]+)/);
        const id = decodeURIComponent(m[1]), uid = decodeURIComponent(m[2]);
        righeStorico = righeStorico.filter(x => !(x.user_id === uid && x.id === id));
        status = 200; out = '';
      } else if (/^\/storage\/v1\/object\/storico-foto\//.test(opts.path) && opts.method === 'POST') {
        status = 200; out = '{}';
      } else if (/^\/storage\/v1\/object\/sign\/storico-foto\//.test(opts.path)) {
        status = 200; out = JSON.stringify({ signedURL: '/object/sign/storico-foto/finto?token=abc' });
      } else {
        status = 404; out = '{}';
      }

      res.statusCode = status;
      cb(res);
      res.emit('data', out);
      res.emit('end');
    });
  };
  return req;
};

process.env.SUPABASE_URL = 'https://progetto.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-finta';
process.env.SUPABASE_SERVICE_KEY = 'service-finta';
const fn = require(L.funzione('account.js'));
const S = require(L.funzione('lib/shared.js'));

(async () => {
  console.log('\n-- senza deposito configurato --');
  // In un processo suo: account.js legge SUPABASE_ANON_KEY una volta sola al
  // require, e require() lo stesso file nello stesso processo tornerebbe la
  // copia gia' in cache, configurata, qualunque cosa si faccia alle env var
  // dopo.
  const senza = spawnSync(process.execPath, ['-e', `
    process.env.URL = ${JSON.stringify(SITE)};
    process.env.GROQ_API_KEY = 'test-key-non-reale';
    const fn = require(${JSON.stringify(L.funzione('account.js'))});
    fn.handler({ httpMethod: 'POST', headers: { origin: ${JSON.stringify(SITE)}, host: ${JSON.stringify(HOST)} },
      body: JSON.stringify({ azione: 'accedi', email: 'a@b.it', password: 'qualunque' }) })
      .then(r => console.log(r.statusCode));
  `], {
    encoding: 'utf8',
    // spawnSync eredita per default tutto process.env, comprese le
    // SUPABASE_* che questo file ha gia' impostato qui sopra: senza toglierle
    // esplicitamente il figlio si ritroverebbe "configurato" lo stesso.
    env: Object.assign({}, process.env, { SUPABASE_URL: '', SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_KEY: '' })
  });
  check('501, non un guasto', senza.stdout.trim() === '501', senza.stdout + senza.stderr);

  console.log('\n-- registrazione --');
  let r = await fn.handler(ev({ azione: 'registrati', email: 'nuovo@esempio.it', password: 'segreta1' }));
  check('email valida, password ok -> 200', r.statusCode === 200 && corpo(r).registrato === true, r.statusCode + ' ' + r.body);

  r = await fn.handler(ev({ azione: 'registrati', email: 'non-una-email', password: 'segreta1' }));
  check('email non valida -> 400', r.statusCode === 400, r.statusCode);

  r = await fn.handler(ev({ azione: 'registrati', email: 'corta@esempio.it', password: '123' }));
  check('password troppo corta -> 400', r.statusCode === 400, r.statusCode);

  emailGiaRegistrata = 'gia@esempio.it';
  r = await fn.handler(ev({ azione: 'registrati', email: emailGiaRegistrata, password: 'segreta1' }));
  check('email gia\' registrata -> 400 col messaggio giusto', r.statusCode === 400 && /gia\'/.test(corpo(r).error), corpo(r));

  console.log('\n-- login --');
  r = await fn.handler(ev({ azione: 'accedi', email: credenzialiValide.email, password: credenzialiValide.password }));
  check('credenziali giuste -> 200 con un token', r.statusCode === 200 && typeof corpo(r).token === 'string', r.body);
  const tokenAccount = corpo(r).token;
  check('il token e\' verificabile, e porta l\'id giusto',
    S.verifyAccountToken(tokenAccount) === 'uid_1', S.verifyAccountToken(tokenAccount));

  r = await fn.handler(ev({ azione: 'accedi', email: credenzialiValide.email, password: 'sbagliata' }));
  check('password sbagliata -> 401', r.statusCode === 401, r.statusCode);

  console.log('\n-- il codice di accesso (ALBA_PIN) non c\'entra --');
  process.env.ALBA_PIN = '4271';
  r = await fn.handler(ev({ azione: 'accedi', email: credenzialiValide.email, password: credenzialiValide.password }));
  check('login riesce anche senza X-Session-Token, sono due sistemi diversi',
    r.statusCode === 200, r.statusCode + ' ' + r.body);
  delete process.env.ALBA_PIN;

  console.log('\n-- reset password --');
  chiamate = [];
  r = await fn.handler(ev({ azione: 'richiedi-reset', email: 'chiunque@esempio.it' }));
  check('sempre 200, anche per un\'email che non esiste', r.statusCode === 200 && corpo(r).inviata === true, r.body);
  const chiamataRecover = chiamate.find(c => c.path === '/auth/v1/recover');
  check('e la richiesta e\' partita davvero verso Supabase', !!chiamataRecover, chiamate);

  r = await fn.handler(ev({ azione: 'reimposta-password', tokenRecupero: 'token-di-recupero-valido', password: 'nuovapass1' }));
  check('token di recupero valido -> cambiata', r.statusCode === 200 && corpo(r).cambiata === true, r.body);

  r = await fn.handler(ev({ azione: 'reimposta-password', tokenRecupero: 'token-scaduto', password: 'nuovapass1' }));
  check('token di recupero sbagliato -> 400, non un 200 silenzioso', r.statusCode === 400, r.statusCode);

  r = await fn.handler(ev({ azione: 'reimposta-password', tokenRecupero: '', password: 'nuovapass1' }));
  check('nessun token -> 400 subito, non arriva nemmeno a Supabase', r.statusCode === 400, r.statusCode);

  console.log('\n-- lo storico personale, dietro al token dell\'account --');
  r = await fn.handler(ev({ azione: 'storico-leggi' }));
  check('senza X-Account-Token -> 401', r.statusCode === 401 && corpo(r).codice === 'account', r.body);

  r = await fn.handler(ev({ azione: 'storico-leggi' }, { 'x-account-token': 'qualunque-cosa' }));
  check('con un token finto -> 401 lo stesso', r.statusCode === 401, r.statusCode);

  const conToken = extra => ev({}, Object.assign({ 'x-account-token': tokenAccount }, extra || {}));

  r = await fn.handler(Object.assign(conToken(), { body: JSON.stringify({
    azione: 'storico-scrivi',
    voce: { id: 'i1', nome: 'Felpa Carhartt', marca: 'Carhartt', prezzoSuggerito: 40, esito: { venduto: true, prezzo: 35 } }
  }) }));
  check('scrivere una voce riesce', r.statusCode === 200 && corpo(r).salvato === true, r.body);
  check('e finisce nel database con lo user_id giusto',
    righeStorico.some(x => x.user_id === 'uid_1' && x.id === 'i1' && x.nome === 'Felpa Carhartt'), righeStorico);
  check('l\'esito arriva intero, come oggetto', righeStorico.find(x => x.id === 'i1').esito.prezzo === 35);

  r = await fn.handler(Object.assign(conToken(), { body: JSON.stringify({
    azione: 'storico-scrivi', voce: { id: 'i2', nome: 'Giacca', marca: 'Zara' },
    foto: 'data:image/jpeg;base64,AAAA'
  }) }));
  check('una voce con la foto riesce, e la carica su Storage',
    r.statusCode === 200 && chiamate.some(c => /^\/storage\/v1\/object\/storico-foto\/uid_1\/i2\.jpg$/.test(c.path)), chiamate.slice(-4));

  r = await fn.handler(Object.assign(conToken(), { body: JSON.stringify({ azione: 'storico-leggi' }) }));
  const voci = corpo(r).voci || [];
  check('leggere torna le voci scritte', voci.length === 2, voci);
  check('e la foto e\' un URL firmato, non il base64', /token=abc/.test((voci.find(v => v.id === 'i2') || {}).foto || ''), voci);

  console.log('\n-- due account non si vedono a vicenda --');
  // Il mock accetta solo credenzialiValide come login riuscito: per un secondo
  // utente basta un token firmato a mano con un altro uid, senza rifare tutto
  // il giro del login.
  const tokenAltro = S.issueAccountToken('uid_2');
  const rAltro = await fn.handler(Object.assign(ev({ azione: 'storico-leggi' }, { 'x-account-token': tokenAltro })));
  check('un secondo utente non vede le voci del primo', (corpo(rAltro).voci || []).length === 0, corpo(rAltro));

  r = await fn.handler(Object.assign(conToken(), { body: JSON.stringify({ azione: 'storico-cancella', id: 'i1' }) }));
  check('cancellare una voce riesce', r.statusCode === 200 && corpo(r).cancellato === true, r.body);
  check('e sparisce davvero', !righeStorico.some(x => x.user_id === 'uid_1' && x.id === 'i1'), righeStorico);

  console.log('\n-- il corpo troppo grande si rifiuta subito --');
  const grande = { azione: 'storico-scrivi', voce: { id: 'i3', nome: 'x' }, foto: 'data:image/jpeg;base64,' + 'A'.repeat(600 * 1024) };
  r = await fn.handler(Object.assign(conToken(), { body: JSON.stringify(grande) }));
  check('413, non un tentativo di salvare comunque', r.statusCode === 413, r.statusCode);

  console.log('\n-- la pagina: login, sync, logout --');
  const server = await L.serviSito(8915);
  const browser = await chromium.launch({ executablePath: L.chromium(), args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errori = [];
  page.on('pageerror', e => errori.push(String(e)));
  await L.senzaGuida(page);

  let mandatiAccount = [];
  await page.route('**/api/account', async route => {
    const b = JSON.parse(route.request().postData() || '{}');
    mandatiAccount.push(b);
    if (b.azione === 'accedi') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'pagina.token.finto' }) });
    if (b.azione === 'storico-leggi') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ voci: [] }) });
    if (b.azione === 'richiedi-reset') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ inviata: true }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"salvato":true}' });
  });

  await page.goto('http://127.0.0.1:8915/', { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.clear(); sw('storico'); });

  check('da sloggato si vede il modulo di login', await page.locator('#accLoggedOut').isVisible());
  check('e non quello di chi e\' dentro', await page.locator('#accLoggedIn').isHidden());

  await page.fill('#accEmail', 'io@esempio.it');
  await page.fill('#accPassword', 'segreta1');
  await page.click('[data-az="accediAccount"]');
  await page.waitForSelector('#accLoggedIn:not([hidden])', { timeout: 5000 });
  check('dopo il login si vede "sei dentro come"', /io@esempio\.it/.test(await page.textContent('#accEmailMostrata')));
  check('il token resta sul dispositivo', await page.evaluate(() => localStorage.getItem('albaAccountToken')) === 'pagina.token.finto');

  mandatiAccount = [];
  await page.evaluate(() => { sw('scanner'); upsertHistoryItem('sync_1', { nome: 'Prova sync', marca: 'Test', prezzoSuggerito: 20 }); });
  await page.waitForTimeout(300);
  const scrittura = mandatiAccount.find(m => m.azione === 'storico-scrivi');
  check('scrivere in locale manda la voce anche all\'account', !!scrittura, mandatiAccount);
  if (scrittura) check('la voce intera, non solo il pezzo nuovo', scrittura.voce.nome === 'Prova sync' && scrittura.voce.marca === 'Test', scrittura.voce);

  await page.evaluate(() => sw('storico'));
  await page.click('[data-az="esciAccount"]');
  check('dopo "esci" si torna al modulo di login', await page.locator('#accLoggedOut').isVisible());
  check('e il token sparisce dal dispositivo', await page.evaluate(() => localStorage.getItem('albaAccountToken')) === null);
  check('ma lo storico locale resta', (await page.evaluate(() => loadHistory().length)) > 0);

  console.log('\n-- password dimenticata --');
  await page.click('[data-az="mostraResetAccount"]');
  check('si apre il modulo del reset', await page.locator('#accFormReset').isVisible());
  await page.fill('#accEmailReset', 'io@esempio.it');
  await page.click('[data-az="richiediResetAccount"]');
  await page.waitForSelector('#accFormLogin:not([hidden])', { timeout: 5000 });
  check('manda la richiesta e torna al login', mandatiAccount.some(m => m.azione === 'richiedi-reset'));

  console.log('\n-- il link di recupero apre lo storico col modulo giusto --');
  // Una pagina nuova apposta: un goto sulla stessa pagina che cambia solo il
  // frammento e' una navigazione "nel documento" per il browser - niente
  // ricarica, lo script non riparte, e apriDaRecupero() non si vedrebbe mai
  // rieseguire. Chi apre il link della mail parte invece da zero, come qui.
  const page2 = await (await browser.newContext()).newPage();
  const errori2 = [];
  page2.on('pageerror', e => errori2.push(String(e)));
  await L.senzaGuida(page2);
  await page2.goto('http://127.0.0.1:8915/#access_token=recupero.finto&type=recovery', { waitUntil: 'load' });
  check('la scheda Storico e\' quella aperta', await page2.evaluate(() => document.getElementById('tab-storico').classList.contains('on')));
  check('e si vede il modulo per la nuova password', await page2.locator('#accFormResetCompleta').isVisible());
  check('il token del recupero non resta nell\'indirizzo', !/access_token/.test(await page2.evaluate(() => location.href)));
  check('nessun errore JS nella pagina del recupero', errori2.length === 0, errori2);

  check('nessun errore JS in tutta la sessione', errori.length === 0, errori);

  await browser.close();
  server.close();
  fine();
})().catch(e => { console.error(e); process.exit(1); });
