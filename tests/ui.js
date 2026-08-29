const L = require('./lib');
const { chromium } = require('playwright-core');
let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${e !== undefined ? ' -> ' + JSON.stringify(e) : ''}`); } };

(async () => {
  const server = await L.serviSito(8899);
  const browser = await chromium.launch({ executablePath: L.chromium(), args: ['--no-sandbox'] });
  const page = await browser.newPage();

  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  // I font di Google sono bloccati dal proxy di questo ambiente: e' rumore
  // dell'infrastruttura, non dell'app.
  const rumore = /Failed to load resource|ERR_CONNECTION|fonts\.g/;
  page.on('console', m => { if (m.type() === 'error' && !rumore.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('requestfailed', r => { if (!/fonts\.g/.test(r.url())) errors.push('richiesta fallita: ' + r.url()); });

  // Finta function: GET rilascia un token, POST risponde con quello che decide il test.
  let postCount = 0, tokenCount = 0, lastAuthHeader = null;
  let reply = { text: JSON.stringify({ prezzoSuggerito: 25, rangeMin: 18, rangeMax: 35, percentuale: 60, motivazione: 'perche si', fattori: ['a', 'b'], consiglio: 'vendi' }), model: 'modello-finto' };
  let delayMs = 0;
  await page.route('**/.netlify/functions/claude', async route => {
    const req = route.request();
    if (req.method() === 'GET') {
      tokenCount++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'finto.token', expiresIn: 900000 }) });
    }
    postCount++;
    lastAuthHeader = req.headers()['x-session-token'];
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) });
  });

  await page.goto('http://127.0.0.1:8899/', { waitUntil: 'load' });
  // La pagina ora si apre sul sole: le prove che seguono partono da dentro una
  // funzione, come se ci fossi arrivato toccando il suo raggio.
  await page.evaluate(() => sw('foto'));

  console.log('\n-- caricamento --');
  check('nessun errore JS al caricamento', errors.length === 0, errors);

  console.log('\n-- accessibilita --');
  await page.click('#nav-annuncio');
  await page.click('label[for="aNome"]');
  check('il tap sulla label porta il focus nel campo', await page.evaluate(() => document.activeElement.id) === 'aNome');
  const senzaFor = await page.evaluate(() =>
    [...document.querySelectorAll('label.fl')].filter(l => !l.getAttribute('for') && l.parentElement.querySelector('input,select,textarea')).length);
  check('nessuna label di campo senza for', senzaFor === 0, senzaFor);

  await page.focus('#toneChips .chip:nth-child(2)');
  await page.keyboard.press('Enter');
  check('i chip si selezionano da tastiera', await page.evaluate(() => document.querySelector('#toneChips .chip:nth-child(2)').classList.contains('on')));
  check('aria-pressed segue la selezione', await page.evaluate(() =>
    document.querySelector('#toneChips .chip:nth-child(2)').getAttribute('aria-pressed') === 'true' &&
    document.querySelector('#toneChips .chip:nth-child(1)').getAttribute('aria-pressed') === 'false'));

  console.log('\n-- token di sessione --');
  await page.click('#nav-prezzo');
  await page.fill('#pNome', 'Giacca');
  await page.click('#btnP');
  await page.waitForSelector('#rPre:not([style*="display: none"])');
  check('la pagina chiede il token', tokenCount === 1, tokenCount);
  check('e lo allega alla POST', lastAuthHeader === 'finto.token', lastAuthHeader);
  await page.click('#btnP');
  await page.waitForFunction(() => !document.getElementById('lPre').style.display.includes('none') === false);
  check('il token viene riusato, non richiesto ogni volta', tokenCount === 1, tokenCount);

  console.log('\n-- doppio invio --');
  delayMs = 400; postCount = 0;
  await page.evaluate(() => { document.getElementById('btnP').click(); document.getElementById('btnP').click(); document.getElementById('btnP').click(); });
  await page.waitForTimeout(900);
  check('tre click di fila = una sola chiamata', postCount === 1, postCount);
  check('il bottone torna attivo a fine richiesta', await page.evaluate(() => !document.getElementById('btnP').disabled));
  delayMs = 0;

  console.log('\n-- numeri fuori scala dal modello --');
  reply = { text: JSON.stringify({ prezzoSuggerito: '42', rangeMin: null, rangeMax: 'boh', percentuale: 999, motivazione: 'x', fattori: 'non un array', consiglio: '' }), model: 'm' };
  await page.click('#btnP');
  await page.waitForTimeout(400);
  check('prezzo come stringa viene interpretato', await page.textContent('#pNum') === '42€', await page.textContent('#pNum'));
  check('range incompleto non stampa "null€"', await page.textContent('#pRng') === '', await page.textContent('#pRng'));
  check('percentuale 999 viene limitata a 100%', await page.evaluate(() => document.getElementById('pBar').style.width) === '100%', await page.evaluate(() => document.getElementById('pBar').style.width));
  check('fattori non-array non rompe il rendering', await page.evaluate(() => document.getElementById('pFact').children.length) === 0);
  check('consiglio vuoto non lascia un box a meta', await page.textContent('#pTip') === '');

  reply = { text: JSON.stringify({ motivazione: 'niente prezzo' }), model: 'm' };
  await page.click('#btnP');
  await page.waitForSelector('#ePre:not([style*="display: none"])');
  check('prezzo mancante -> errore leggibile, non "undefined€"', (await page.textContent('#ePre')).includes('non interpretabile'), await page.textContent('#ePre'));

  console.log('\n-- condizione dal modello --');
  const cond = await page.evaluate(() => {
    const out = {};
    for (const t of ['Nuovo senza etichetta', 'Nuovo con etichetta', 'Buono', 'ottimo stato', 'roba strana']) {
      document.getElementById('pCond').value = 'Buono';
      applyCondizione('pCond', t);
      out[t] = document.getElementById('pCond').value;
    }
    return out;
  });
  check('"Nuovo senza etichetta" non diventa "con etichetta"', cond['Nuovo senza etichetta'] === 'Nuovo senza etichetta', cond);
  check('"Nuovo con etichetta" resta se stessa', cond['Nuovo con etichetta'] === 'Nuovo con etichetta', cond);
  check('"ottimo stato" cade su Ottimo', cond['ottimo stato'] === 'Ottimo', cond);
  check('un valore non riconosciuto lascia la tendina com\'era', cond['roba strana'] === 'Buono', cond);

  console.log('\n-- storico --');
  const hist = await page.evaluate(() => {
    localStorage.clear();
    for (let i = 0; i < 60; i++) upsertHistoryItem('id_' + i, { nome: 'Capo ' + i, updatedAt: i });
    return loadHistory().length;
  });
  check('lo storico si ferma a 50 voci', hist === 50, hist);

  await page.evaluate(() => {
    localStorage.clear();
    upsertHistoryItem('id_x', { nome: '<img src=x onerror=alert(1)>', marca: 'Test', titolo: 'T', foto: 'javascript:alert(1)' });
  });
  await page.click('#nav-storico');
  check('il nome ostile resta testo, non diventa HTML', await page.evaluate(() => document.querySelectorAll('#historyList img[src^="javascript"]').length) === 0);
  check('una foto non valida non finisce in src', await page.evaluate(() => document.querySelectorAll('#historyList img').length) === 0);
  check('il nome si vede per intero come scritto', (await page.textContent('#historyList .hName')).includes('<img src=x'));

  await page.click('#historyList .hDel');
  check('il cestino delegato cancella la voce', await page.evaluate(() => loadHistory().length) === 0);

  await page.evaluate(() => {
    localStorage.clear();
    upsertHistoryItem('id_ok', { nome: 'Con foto', foto: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' });
    renderHistory();
  });
  check('una foto valida invece si vede', await page.evaluate(() => document.querySelectorAll('#historyList img').length) === 1);

  console.log('\n-- errori JS accumulati --');
  check('nessun errore JS in tutta la sessione', errors.length === 0, errors);

  await browser.close();
  server.close();
  console.log(`\n${pass} passati, ${fail} falliti`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
