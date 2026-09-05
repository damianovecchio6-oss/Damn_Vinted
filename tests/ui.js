const fs = require('fs');
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

  await L.senzaGuida(page);
  await page.goto('http://127.0.0.1:8899/', { waitUntil: 'load' });
  // La pagina ora si apre sul sole: le prove che seguono partono da dentro una
  // funzione, come se ci fossi arrivato toccando il suo raggio.
  await page.evaluate(() => sw('foto'));

  console.log('\n-- caricamento --');
  check('nessun errore JS al caricamento', errors.length === 0, errors);

  console.log('\n-- accessibilita --');
  await page.evaluate(() => sw('annuncio'));
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
  await page.evaluate(() => sw('prezzo'));
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
  await page.evaluate(() => sw('storico'));
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

  // L'esito vero: il prezzo suggerito e' una previsione, e questa e' l'unica
  // riga dell'app che la mette a confronto con com'e' andata davvero.
  console.log('\n-- l\'esito: venduto? a quanto? in quanto tempo? --');
  await page.evaluate(() => {
    localStorage.clear();
    upsertHistoryItem('id_e1', { nome: 'Felpa', prezzoSuggerito: 40 });
    renderHistory();
  });
  check('a un capo col prezzo suggerito viene chiesto com\'e andata',
    (await page.textContent('#historyList .hEs')).includes('Venduto?'), await page.textContent('#historyList .hEs'));
  check('il modulo parte chiuso', await page.evaluate(() => document.getElementById('es_id_e1').hidden));
  await page.click('#historyList [data-az="esitoChiedi"]');
  check('"si" apre i due campi: a quanto, e in quanto tempo',
    await page.evaluate(() => !document.getElementById('es_id_e1').hidden
      && !!document.getElementById('esP_id_e1') && !!document.getElementById('esG_id_e1')));
  await page.fill('#esP_id_e1', '34');
  await page.fill('#esG_id_e1', '9');
  await page.click('#historyList [data-az="esitoSalva"]');
  const salvato = await page.evaluate(() => (loadHistory().find(x => x.id === 'id_e1') || {}).esito);
  check('l\'esito finisce nello storico', salvato && salvato.venduto === true && salvato.prezzo === 34 && salvato.giorni === 9, salvato);
  check('e si rilegge nella voce, con lo scarto dal suggerito',
    /Venduto a 34€ in 9 giorni/.test(await page.textContent('#historyList .hEs'))
    && /15% sotto/.test(await page.textContent('#historyList .hEs')), await page.textContent('#historyList .hEs'));

  // Il capo su cui lo scanner non se l'e' sentita di dire un numero ha solo la
  // banda. Chiedergli com'e' andata e' proprio il caso che insegna di piu':
  // finche' la domanda non arrivava, quei capi restavano fuori dal giro.
  await page.evaluate(() => {
    localStorage.clear();
    upsertHistoryItem('id_banda', { nome: 'Felpa incerta', rangeMin: 30, rangeMax: 48 });
    renderHistory();
  });
  check('anche senza un numero singolo la domanda arriva',
    /Venduto\?/.test(await page.textContent('#historyList .hEs')), await page.textContent('#historyList .hEs'));
  await page.click('#historyList [data-az="esitoChiedi"]');
  await page.fill('#historyList input[id^="esP_"]', '36');
  await page.click('#historyList [data-az="esitoSalva"]');
  check('e l\'esito si salva senza inventare uno scarto da un suggerito che non c\'era',
    /Venduto a 36€/.test(await page.textContent('#historyList .hEs'))
    && !/%/.test(await page.textContent('#historyList .hEs')), await page.textContent('#historyList .hEs'));

  await page.evaluate(() => {
    localStorage.clear();
    upsertHistoryItem('id_n', { nome: 'Jeans', prezzoSuggerito: 30 });
    renderHistory();
  });
  await page.click('#historyList [data-az="esitoNonVenduto"]');
  check('"non ancora" si segna senza chiedere altro',
    await page.evaluate(() => { const e = (loadHistory().find(x => x.id === 'id_n') || {}).esito; return !!e && e.venduto === false; }));
  check('e resta la strada per correggersi dopo',
    (await page.textContent('#historyList .hEs')).includes('è venduto'), await page.textContent('#historyList .hEs'));

  // Sotto i tre capi venduti non si dice niente: due esiti non sono una media,
  // sono due episodi.
  await page.evaluate(() => {
    localStorage.clear();
    upsertHistoryItem('id_c1', { nome: 'A', prezzoSuggerito: 40, esito: { venduto: true, prezzo: 34, giorni: 10 } });
    upsertHistoryItem('id_c2', { nome: 'B', prezzoSuggerito: 50, esito: { venduto: true, prezzo: 40, giorni: 12 } });
    renderHistory();
  });
  check('con due soli esiti non tira ancora nessuna media',
    await page.evaluate(() => document.getElementById('calibra').style.display === 'none'));
  await page.evaluate(() => {
    upsertHistoryItem('id_c3', { nome: 'C', prezzoSuggerito: 20, esito: { venduto: true, prezzo: 18, giorni: 20 } });
    renderHistory();
  });
  const calib = await page.textContent('#calibra');
  check('dal terzo in poi dice come vendono davvero i suoi capi', /3 capi venduti/.test(calib), calib);
  check('col divario dal suggerito', /15% sotto/.test(calib), calib);
  check('e col tempo che ci mettono', /12 giorni/.test(calib), calib);
  // Lo storico sta solo qui dentro: se l'export perde un campo, quel campo e'
  // perso davvero il giorno che il browser cancella i dati del sito.
  console.log('\n-- export dello storico --');
  const CAMPI = ['id', 'createdAt', 'updatedAt', 'nome', 'marca', 'taglia', 'condizione', 'titolo',
                 'descrizione', 'hashtag', 'prezzoSuggerito', 'rangeMin', 'rangeMax', 'consiglio', 'foto', 'esito'];
  await page.evaluate(() => {
    localStorage.clear();
    upsertHistoryItem('id_pieno', {
      nome: 'Felpa', marca: 'Nike', taglia: 'M', condizione: 'Buono',
      titolo: 'Felpa Nike taglia M', descrizione: 'Descrizione lunga', hashtag: '#nike #felpa',
      prezzoSuggerito: 22, rangeMin: 18, rangeMax: 28, consiglio: 'vendi ora',
      esito: { venduto: true, prezzo: 20, giorni: 11 },
      foto: 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
    });
    upsertHistoryItem('id_scarno', { nome: 'Jeans' });
    renderHistory();
  });
  const [scarico] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btnExportStorico')
  ]);
  check('il nome del file porta data e ora, cosi due export non si sovrascrivono',
    /^storico-alba-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/.test(scarico.suggestedFilename()), scarico.suggestedFilename());
  // path() torna null se il download e' fallito: senza questa guardia la suite
  // moriva di TypeError e si portava via tutte le righe dopo, proprio quelle
  // che spiegavano cosa era uscito dal file.
  const percorso = await scarico.path();
  const pacco = percorso ? JSON.parse(fs.readFileSync(percorso, 'utf8')) : {};
  check('il file scaricato esiste davvero su disco', !!percorso, percorso);
  check('il file dichiara il formato', pacco.formato === 1, pacco.formato);
  check('e quando e stato esportato', !isNaN(Date.parse(pacco.esportatoIl)), pacco.esportatoIl);
  check('ci sono tutte le voci', Array.isArray(pacco.voci) && pacco.voci.length === 2, pacco.voci);
  const pieno = (pacco.voci || []).find(x => x && x.id === 'id_pieno') || {};
  const mancanti = CAMPI.filter(k => pieno[k] === undefined);
  check('la voce esce intera, nessun campo perso per strada', mancanti.length === 0, mancanti);
  check('la miniatura esce com\'era, non svuotata', pieno.foto === 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', pieno.foto);

  let scaricato = false;
  const spia = () => { scaricato = true; };
  page.on('download', spia);
  await page.evaluate(() => { localStorage.clear(); renderHistory(); });
  await page.click('#btnExportStorico');
  await page.waitForTimeout(500);
  page.off('download', spia);
  check('storico vuoto: non scarica un file vuoto', scaricato === false);
  check('storico vuoto: lo dice invece di far finta di niente',
    (await page.textContent('#toast')).includes('vuoto'), await page.textContent('#toast'));

  // -- niente codice inline, o la CSP stretta non regge --
  // Questo si legge dai file e non dalla pagina apposta: la CSP vera non passa
  // da serviSito, quindi una violazione qui la suite non la vedrebbe mai. Il
  // controllo e' sulla causa - inline nel sorgente - non sul sintomo.
  console.log('\n-- niente codice inline --');
  const markup = fs.readFileSync(L.SITO + '/index.html', 'utf8');
  const script = fs.readFileSync(L.SITO + '/app.js', 'utf8');
  const headers = fs.readFileSync(L.SITO + '/_headers', 'utf8');

  const handlerInline = /\son[a-z]+\s*=\s*["']/gi;
  check('nessun handler inline nel markup', !handlerInline.test(markup),
    (markup.match(handlerInline) || []).slice(0, 5));
  // Anche l'HTML generato a runtime conta: e' markup come l'altro, solo scritto
  // piu' tardi.
  const generati = script.match(/\son(click|change|input|submit)\s*=\s*["']/gi) || [];
  check('nessun handler inline nell HTML generato da app.js', generati.length === 0, generati);
  check('nessun blocco <script> senza src', !/<script(?![^>]*\ssrc=)[^>]*>/i.test(markup),
    (markup.match(/<script[^>]*>/gi) || []));
  // Solo la riga della direttiva, non tutto il file: in _headers ci sono anche
  // i commenti, e uno che spiega perche' unsafe-inline non c'e' contiene quella
  // parola come qualunque altro testo.
  const csp = (headers.match(/^\s*Content-Security-Policy:.*$/m) || [''])[0];
  const scriptSrc = (csp.match(/script-src[^;]*/) || [''])[0];
  check('la CSP non concede unsafe-inline agli script',
    scriptSrc === "script-src 'self'", scriptSrc);

  console.log('\n-- errori JS accumulati --');
  check('nessun errore JS in tutta la sessione', errors.length === 0, errors);

  await browser.close();
  server.close();
  console.log(`\n${pass} passati, ${fail} falliti`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
