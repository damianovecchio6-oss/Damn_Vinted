// Il codice di accesso. Due meta': la function, che senza codice non rilascia
// il token, e la pagina, che il codice lo chiede una volta e poi se lo ricorda.
//
// La domanda che questa suite tiene sotto controllo e' una sola: quando ALBA_PIN
// non c'e', tutto deve funzionare esattamente come prima. Un codice acceso per
// sbaglio dal codice invece che dall'ambiente chiuderebbe fuori chi paga.
process.env.URL = 'https://damn-vinted.netlify.app';
process.env.GROQ_API_KEY = 'test-key-non-reale';
process.env.RATE_LIMIT_PER_MIN = '200';
process.env.ALBA_PIN = '4271';

const path = require('path');
const { spawnSync } = require('child_process');
const L = require('./lib');
const { chromium } = require('playwright-core');
const { check, fine } = L.contatore();

const fn = require(L.funzione('claude.js'));
const SITE = 'https://damn-vinted.netlify.app';
const HOST = 'damn-vinted.netlify.app';
const ev = (o) => Object.assign({ httpMethod: 'GET', headers: {}, body: '' }, o);
const hdr = (ip, extra) => Object.assign({ origin: SITE, host: HOST, 'x-nf-client-connection-ip': ip }, extra || {});
const corpo = r => { try { return JSON.parse(r.body); } catch { return {}; } };

(async () => {
  console.log('\n-- la function col codice acceso --');

  let r = await fn.handler(ev({ headers: hdr('3.0.0.1') }));
  check('senza codice il token non esce', r.statusCode === 401, r.statusCode);
  // Due 401 identici - "sessione scaduta" e "serve il codice" - vogliono due
  // cose diverse: la pagina li distingue da qui.
  check('e la pagina capisce che e\' per il codice', corpo(r).codice === 'pin', corpo(r));

  r = await fn.handler(ev({ headers: hdr('3.0.0.2', { 'x-alba-pin': '9999' }) }));
  check('codice sbagliato -> 401', r.statusCode === 401 && corpo(r).codice === 'pin', r.statusCode);

  r = await fn.handler(ev({ headers: hdr('3.0.0.3', { 'x-alba-pin': '4271' }) }));
  const token = corpo(r).token;
  check('codice giusto -> token', r.statusCode === 200 && typeof token === 'string' && token.includes('.'), r.statusCode);

  // Il codice si chiede una volta sola: le POST portano il token, non il PIN.
  r = await fn.handler(ev({ httpMethod: 'POST', headers: hdr('3.0.0.3', { 'x-session-token': token }), body: '{"prompt":""}' }));
  check('la POST col token non richiede piu\' il codice', r.statusCode === 400, r.statusCode);

  const S = require(path.join(L.FUNCTIONS, 'lib', 'shared.js'));
  check('il confronto non passa da == su stringhe', S.pinGiusto('4271') === true && S.pinGiusto('4272') === false);
  check('un codice vuoto non vale come giusto', S.pinGiusto('') === false && S.pinGiusto(undefined) === false);
  check('la pagina puo\' sapere che il codice esiste', S.pinRichiesto() === true);
  check('e l\'header del codice passa la CORS',
    /X-Alba-Pin/.test(S.corsFor(SITE, { host: HOST })['Access-Control-Allow-Headers']));

  // Cambiare il PIN deve scadere i token gia' in giro: entrano nel segreto che
  // li firma. Altrimenti chi era dentro resta dentro un quarto d'ora dopo che
  // gli hai tolto le chiavi.
  const conAltroPin = spawnSync(process.execPath, ['-e', `
    process.env.GROQ_API_KEY = 'test-key-non-reale';
    process.env.ALBA_PIN = 'un-altro-codice';
    const S = require(${JSON.stringify(path.join(L.FUNCTIONS, 'lib', 'shared.js'))});
    console.log(S.verifyToken(${JSON.stringify(token)}, '3.0.0.3') ? 'vale' : 'scaduto');
  `], { encoding: 'utf8' });
  check('cambiare il codice invalida i token gia\' emessi',
    conAltroPin.stdout.trim() === 'scaduto', conAltroPin.stdout + conAltroPin.stderr);

  console.log('\n-- senza ALBA_PIN il sito resta com\'era --');
  const senzaPin = spawnSync(process.execPath, ['-e', `
    process.env.URL = ${JSON.stringify(SITE)};
    process.env.GROQ_API_KEY = 'test-key-non-reale';
    const fn = require(${JSON.stringify(L.funzione('claude.js'))});
    fn.handler({ httpMethod: 'GET', headers: { origin: ${JSON.stringify(SITE)}, host: ${JSON.stringify(HOST)}, 'x-nf-client-connection-ip': '4.0.0.1' }, body: '' })
      .then(r => console.log(r.statusCode + ' ' + (JSON.parse(r.body).token ? 'token' : 'niente')));
  // Senza questo il figlio eredita l'ALBA_PIN di questa suite, e la prova
  // "senza codice" proverebbe il contrario di quello che dice.
  `], { encoding: 'utf8', env: Object.assign({}, process.env, { ALBA_PIN: '' }) });
  check('senza codice impostato il token esce come sempre',
    senzaPin.stdout.trim() === '200 token', senzaPin.stdout + senzaPin.stderr);

  console.log('\n-- la pagina: chiede, ricorda, e sbaglia una volta sola --');
  const server = await L.serviSito(8911);
  const browser = await chromium.launch({ executablePath: L.chromium(), args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errori = [];
  page.on('pageerror', e => errori.push(String(e)));
  await L.senzaGuida(page);

  // La function finta: rilascia il token solo a chi porta 4271.
  let visti = [];
  await page.route('**/api/claude', async route => {
    const req = route.request();
    if (req.method() === 'GET') {
      const pin = req.headers()['x-alba-pin'] || '';
      visti.push(pin);
      if (pin !== '4271') {
        return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Serve il codice di accesso.', codice: 'pin' }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'finto.token', expiresIn: 900000 }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'ok', model: 'finto' }) });
  });

  await page.goto('http://127.0.0.1:8911/', { waitUntil: 'load' });
  check('la finestra del codice non si vede finche\' nessuno la chiede',
    await page.locator('#pin').isHidden());

  // Qualunque cosa chieda un token fa comparire la finestra.
  const inCorso = page.evaluate(() => getSessionToken(false));
  await page.waitForSelector('#pin:not([hidden])', { timeout: 5000 });
  check('appena serve un token, il codice viene chiesto', true);
  check('e il fuoco e\' gia\' nel campo, senza doverlo cercare',
    await page.evaluate(() => document.activeElement && document.activeElement.id === 'pinIn'));

  // Prima un codice sbagliato: la finestra resta, e lo dice.
  await page.fill('#pinIn', '1111');
  await page.click('[data-az="pinConferma"]');
  await page.waitForSelector('#pinE:not(:empty)', { timeout: 5000 });
  check('un codice sbagliato lo dice e richiede', /non valido/i.test(await page.textContent('#pinE')));
  check('e non resta salvato sul dispositivo',
    await page.evaluate(() => localStorage.getItem('albaPin')) === null);

  await page.fill('#pinIn', '4271');
  await page.click('[data-az="pinConferma"]');
  const token2 = await inCorso;
  check('col codice giusto il token arriva', token2 === 'finto.token', token2);
  check('la finestra si chiude da sola', await page.locator('#pin').isHidden());
  check('il codice resta su questo dispositivo',
    await page.evaluate(() => localStorage.getItem('albaPin')) === '4271');
  check('la function ha visto prima il vuoto, poi lo sbagliato, poi il giusto',
    JSON.stringify(visti) === JSON.stringify(['', '1111', '4271']), visti);

  // Ricaricando non si richiede piu': e' il punto di ricordarselo.
  visti = [];
  await page.reload({ waitUntil: 'load' });
  const token3 = await page.evaluate(() => getSessionToken(true));
  check('al ritorno il codice non viene piu\' chiesto', token3 === 'finto.token', token3);
  check('parte gia\' col codice in mano', JSON.stringify(visti) === JSON.stringify(['4271']), visti);
  check('e la finestra resta chiusa', await page.locator('#pin').isHidden());

  // Esc: chi non ha il codice deve poter chiudere, e sentirsi dire perche'
  // non funziona niente invece di restare davanti a una finestra muta.
  await page.evaluate(() => localStorage.removeItem('albaPin'));
  const rifiutata = page.evaluate(() => getSessionToken(true).then(() => 'passata', e => e.message));
  await page.waitForSelector('#pin:not([hidden])', { timeout: 5000 });
  await page.keyboard.press('Escape');
  check('chiudendo la finestra si sente dire perche\' non si va avanti',
    /codice di accesso/i.test(await rifiutata));
  check('nessun errore JS in tutta la sessione', errori.length === 0, errori);

  await browser.close();
  server.close();
  fine();
})().catch(e => { console.error(e); process.exit(1); });
