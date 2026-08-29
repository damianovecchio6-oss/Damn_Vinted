const L = require('./lib');
const { chromium } = require('playwright-core');
let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${e !== undefined ? ' -> ' + JSON.stringify(e) : ''}`); } };

// Le micro-interazioni si vedono, quindi si testano: che compaiano quando
// servono, che spariscano dopo, e che chi ha chiesto meno movimento lo ottenga.
async function apri(browser, opzioni) {
  const page = await browser.newPage(Object.assign({ viewport: { width: 430, height: 900 } }, opzioni));
  await page.route('**/.netlify/functions/claude', async route => {
    const req = route.request();
    if (req.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 't.t', expiresIn: 900000 }) });
    }
    await new Promise(r => setTimeout(r, 500));
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ text: JSON.stringify({ prezzoSuggerito: 30, rangeMin: 20, rangeMax: 40, percentuale: 55, motivazione: 'ok', fattori: ['uno', 'due', 'tre'], consiglio: 'vendi' }), model: 'm', provider: 'p' })
    });
  });
  await page.goto('http://127.0.0.1:8895/', { waitUntil: 'load' });
  return page;
}

(async () => {
  const server = await L.serviSito(8895);
  const browser = await chromium.launch({ executablePath: L.chromium(), args: ['--no-sandbox'] });
  const page = await apri(browser);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  console.log('\n-- la riga della nav segue la scheda --');
  const barra = () => page.evaluate(() => {
    const nav = document.querySelector('.nav');
    return { x: nav.style.getPropertyValue('--nbx'), w: nav.style.getPropertyValue('--nbw') };
  });
  await page.click('#nav-prezzo');
  const suPrezzo = await barra();
  check('la riga si posiziona sulla scheda scelta', suPrezzo.x !== '' && suPrezzo.w !== '', suPrezzo);
  const bottone = await page.evaluate(() => {
    const b = document.getElementById('nav-prezzo');
    return { left: b.offsetLeft, width: b.offsetWidth };
  });
  check('e la misura sul bottone vero', suPrezzo.x === bottone.left + 'px' && suPrezzo.w === bottone.width + 'px', { suPrezzo, bottone });
  await page.click('#nav-storico');
  const suStorico = await barra();
  check('si sposta cambiando scheda', suStorico.x !== suPrezzo.x, { suPrezzo, suStorico });

  console.log('\n-- la scheda entra dal lato da cui l\'hai chiamata --');
  await page.click('#nav-foto');
  check('andando indietro entra da sinistra', await page.evaluate(() => !document.getElementById('tab-foto').classList.contains('daDestra')));
  await page.click('#nav-ricerca');
  check('andando avanti entra da destra', await page.evaluate(() => document.getElementById('tab-ricerca').classList.contains('daDestra')));
  check('una sola scheda per volta resta accesa', await page.evaluate(() => document.querySelectorAll('.tp.on').length) === 1);

  console.log('\n-- il bottone dice che sta lavorando --');
  await page.click('#nav-prezzo');
  await page.fill('#pNome', 'Giacca');
  await page.click('#btnP');
  await page.waitForSelector('#btnP .bspin', { timeout: 5000 });
  check('lo spinner compare dentro il bottone premuto', await page.evaluate(() => !!document.querySelector('#btnP .bspin')));
  check('la scritta del bottone resta la sua', (await page.textContent('#btnP')).includes('Stima Prezzo'), await page.textContent('#btnP'));
  check('e il bottone resta leggibile, non spento a meta', await page.evaluate(() => document.getElementById('btnP').classList.contains('attesa')));
  await page.waitForSelector('#rPre:not([style*="display: none"])', { timeout: 15000 });
  check('a richiesta finita lo spinner sparisce', await page.evaluate(() => !document.querySelector('#btnP .bspin')));
  check('e il bottone torna premibile', await page.evaluate(() => !document.getElementById('btnP').disabled && !document.getElementById('btnP').classList.contains('attesa')));

  console.log('\n-- le liste entrano a scaletta --');
  const ritardi = await page.evaluate(() => Array.from(document.querySelectorAll('#pFact .fli')).map(li => li.style.getPropertyValue('--i')));
  check('ogni riga porta il suo indice', ritardi.join(',') === '0,1,2', ritardi);
  check('e il CSS lo usa come ritardo', await page.evaluate(() => {
    const li = document.querySelectorAll('#pFact .fli')[2];
    return getComputedStyle(li).animationDelay;
  }) === '0.09s', await page.evaluate(() => getComputedStyle(document.querySelectorAll('#pFact .fli')[2]).animationDelay));

  console.log('\n-- la conferma della copia sta sul bottone premuto --');
  await page.evaluate(() => {
    // In Chromium headless la clipboard puo' non essere concessa: quello che
    // conta qui e' il ritorno della promessa, non il contenuto degli appunti.
    navigator.clipboard.writeText = () => Promise.resolve();
  });
  await page.click('#nav-annuncio');
  await page.evaluate(() => { document.getElementById('rAnnTitolo').textContent = 'Un titolo'; show('rAnn'); });
  const copia = await page.$('#tab-annuncio .cbtn:nth-child(2)');
  await copia.click();
  await page.waitForFunction(() => !!document.querySelector('#tab-annuncio .cbtn.fatto'), null, { timeout: 5000 });
  check('il bottone conferma da se', (await copia.textContent()).includes('Fatto'), await copia.textContent());
  await page.waitForFunction(() => !document.querySelector('#tab-annuncio .cbtn.fatto'), null, { timeout: 5000 });
  check('e torna com\'era da solo', (await copia.textContent()).includes('Copia Titolo'), await copia.textContent());

  console.log('\n-- il focus da tastiera si vede --');
  await page.click('#nav-prezzo');
  await page.evaluate(() => document.getElementById('pNome').focus());
  await page.keyboard.press('Tab');
  const focoVisibile = await page.evaluate(() => {
    const el = document.activeElement;
    const s = getComputedStyle(el);
    return { tag: el.tagName, outline: s.outlineStyle, larghezza: s.outlineWidth };
  });
  check('l\'elemento a fuoco ha un contorno vero', focoVisibile.outline !== 'none' && focoVisibile.larghezza !== '0px', focoVisibile);
  check('l\'etichetta del campo attivo si accende', await page.evaluate(() => {
    document.getElementById('pNome').focus();
    return getComputedStyle(document.querySelector('label[for="pNome"]')).color;
  }) === 'rgb(232, 200, 74)');

  console.log('\n-- la vibrazione: solo sui momenti che contano --');
  await page.evaluate(() => { window.__vibrazioni = []; navigator.vibrate = ms => { window.__vibrazioni.push(ms); return true; }; });
  await page.click('#nav-foto'); await page.click('#nav-prezzo');
  check('cambiare scheda non vibra', await page.evaluate(() => window.__vibrazioni.length) === 0);
  await page.click('#btnP');
  await page.waitForSelector('#rPre:not([style*="display: none"])', { timeout: 15000 });
  check('la stima pronta vibra una volta sola', await page.evaluate(() => window.__vibrazioni.length) === 1, await page.evaluate(() => window.__vibrazioni));
  const senzaSupporto = await page.evaluate(() => {
    const prima = navigator.vibrate;
    delete navigator.vibrate;
    let esploso = false;
    try { tocco(); } catch (e) { esploso = true; }
    navigator.vibrate = prima;
    return esploso;
  });
  check('su un dispositivo che non vibra non succede niente', senzaSupporto === false);

  console.log('\n-- chi ha chiesto meno movimento --');
  const fermo = await apri(browser, { reducedMotion: 'reduce' });
  // Chromium riporta la durata in secondi ("1e-05s"), non nell'unita' scritta
  // nel CSS: quello che conta e' che sia sotto il millisecondo.
  const durata = await fermo.evaluate(() => getComputedStyle(document.querySelector('.tp.on')).animationDuration);
  check('le animazioni si azzerano', parseFloat(durata) < 0.001, durata);
  check('lo spinner pero continua a girare', await fermo.evaluate(() => {
    const s = document.createElement('div'); s.className = 'spin'; document.body.appendChild(s);
    const d = getComputedStyle(s).animationDuration, i = getComputedStyle(s).animationIterationCount;
    s.remove();
    return d === '0.9s' && i === 'infinite';
  }));
  check('e non vibra niente', await fermo.evaluate(() => {
    let vibrato = false;
    navigator.vibrate = () => { vibrato = true; return true; };
    tocco();
    return vibrato;
  }) === false);
  await fermo.close();

  console.log('\n-- errori JS accumulati --');
  check('nessun errore JS in tutta la sessione', errors.length === 0, errors);

  await browser.close();
  server.close();
  console.log(`\n${pass} passati, ${fail} falliti`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
