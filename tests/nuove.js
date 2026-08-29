const L = require('./lib');
const { chromium } = require('playwright-core');
let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${e !== undefined ? ' -> ' + JSON.stringify(e) : ''}`); } };

(async () => {
  const server = await L.serviSito(8897);
  const browser = await chromium.launch({ executablePath: L.chromium(), args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  let aiPost = [], lensPost = [];
  let rispostaCapo = { tipo: 'Giacca', brand: 'Forse Levis', materiale: 'sembra denim', taglie: 'M?', condizione: 'Ottimo', colore: 'blu', vintageStima: 'Non vintage' };
  let rispostaEtichetta = { marca: 'Levi Strauss & Co.', composizione: '100% cotone', taglia: 'L', provenienza: 'Made in Mexico', testoLetto: 'LEVI STRAUSS & CO\n100% COTTON\nTAGLIA L', leggibilita: 'alta' };
  let lensStatus = 200;
  let lensBody = {
    ipotesi: 'Levis Trucker Jacket',
    risultati: [
      { titolo: 'Levi\'s Trucker', fonte: 'Zalando', link: 'https://zalando.it/x', prezzo: { valore: 100, valuta: '€' }, thumbnail: 'https://encrypted-tbn0.gstatic.com/x.jpg' },
      { titolo: 'Giacca jeans', fonte: 'eBay', link: 'https://ebay.it/y', prezzo: { valore: 60, valuta: '€' }, thumbnail: '' }
    ],
    prezzi: { n: 2, min: 60, max: 100, mediana: 80 }
  };

  await page.route('**/.netlify/functions/claude', async route => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 't.t', expiresIn: 900000 }) });
    const b = JSON.parse(req.postData());
    aiPost.push(b);
    // La richiesta con una sola immagine e il prompt corto e' quella dell'etichetta.
    const eEtichetta = /Trascrivi ESATTAMENTE/.test(b.prompt);
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ text: JSON.stringify(eEtichetta ? rispostaEtichetta : rispostaCapo), model: 'gemini-3.7-flash', provider: 'gemini' })
    });
  });
  await page.route('**/.netlify/functions/lens', async route => {
    lensPost.push(JSON.parse(route.request().postData()));
    if (lensStatus !== 200) return route.fulfill({ status: lensStatus, contentType: 'application/json', body: JSON.stringify({ error: 'non configurata' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(lensBody) });
  });

  await page.goto('http://127.0.0.1:8897/', { waitUntil: 'load' });

  const urls = await page.evaluate(() => {
    const out = [];
    for (let k = 0; k < 3; k++) {
      const c = document.createElement('canvas');
      c.width = 2400; c.height = 3200;
      const x = c.getContext('2d');
      const im = x.createImageData(c.width, c.height);
      for (let i = 0; i < im.data.length; i += 4) { im.data[i] = Math.random() * 255; im.data[i + 1] = Math.random() * 255; im.data[i + 2] = Math.random() * 255; im.data[i + 3] = 255; }
      x.putImageData(im, 0, 0);
      out.push(c.toDataURL('image/jpeg', 0.95));
    }
    return out;
  });
  const files = urls.map((u, i) => ({ name: `f${i}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(u.split(',')[1], 'base64') }));

  console.log('\n-- marcare la foto dell\'etichetta --');
  await page.setInputFiles('#fileInput', files);
  check('senza marcatura la scritta invita a farlo', (await page.textContent('#ulabel')).includes('segna quale'), await page.textContent('#ulabel'));
  await page.click('#ps .pw:nth-child(2) .pt');
  check('la scritta dice quale foto e l\'etichetta', (await page.textContent('#ulabel')).includes('etichetta: la 2ª'), await page.textContent('#ulabel'));
  check('il marcatore risulta premuto', await page.evaluate(() => document.querySelector('#ps .pw:nth-child(2) .pt').getAttribute('aria-pressed')) === 'true');
  check('una sola foto per volta puo essere l\'etichetta', await page.evaluate(() => document.querySelectorAll('#ps .pt.on').length) === 1);

  await page.click('#ps .pw:nth-child(1) .pd');   // elimino la prima
  check('eliminando una foto prima, l\'indice segue', await page.evaluate(() => labelIndex) === 0, await page.evaluate(() => labelIndex));
  check('il marcatore si sposta con lei', await page.evaluate(() => document.querySelector('#ps .pw:nth-child(1) .pt').classList.contains('on')));

  console.log('\n-- due letture, non una --');
  aiPost = [];
  await page.click('#btnA');
  await page.waitForSelector('#rFoto:not([style*="display: none"])', { timeout: 30000 });
  check('parte una richiesta in piu per l\'etichetta', aiPost.length === 2, aiPost.length);
  const etReq = aiPost.find(b => /Trascrivi ESATTAMENTE/.test(b.prompt));
  const capoReq = aiPost.find(b => b !== etReq);
  check('la richiesta etichetta porta una foto sola', etReq.images.length === 1, etReq.images.length);
  check('e chiede il JSON garantito', etReq.json === true);
  const lato = b64 => page.evaluate(async s => { const b = await createImageBitmap(await (await fetch('data:image/jpeg;base64,' + s)).blob()); return Math.max(b.width, b.height); }, b64);
  const latoEt = await lato(etReq.images[0].base64), latoCapo = await lato(capoReq.images[0].base64);
  check(`l'etichetta va a piena risoluzione (${latoEt}px contro ${latoCapo}px del capo)`, latoEt > latoCapo, { latoEt, latoCapo });
  check('e a 2000px, non ridotta col resto', latoEt === 2000, latoEt);

  console.log('\n-- quello che c\'e scritto batte quello che sembra --');
  check('la marca letta sostituisce quella dedotta', await page.evaluate(() => lastAnalysis.brand) === 'Levi Strauss & Co.', await page.evaluate(() => lastAnalysis.brand));
  check('la composizione letta sostituisce "sembra denim"', await page.evaluate(() => lastAnalysis.materiale) === '100% cotone');
  check('la taglia letta sostituisce "M?"', await page.evaluate(() => lastAnalysis.taglie) === 'L');
  check('il testo dell\'etichetta si vede nel risultato', (await page.textContent('#rFotoTxt')).includes('LEVI STRAUSS & CO'));
  check('con la leggibilita dichiarata', (await page.textContent('#rFotoTxt')).includes('leggibilità alta'));

  rispostaEtichetta = { marca: 'Non identificato', composizione: '', taglia: '  ', testoLetto: '', leggibilita: 'bassa' };
  await page.evaluate(() => { lastAnalysis = null; });
  await page.click('#btnA');
  await page.waitForFunction(() => lastAnalysis !== null, null, { timeout: 30000 });
  check('"Non identificato" non sovrascrive l\'analisi', await page.evaluate(() => lastAnalysis.brand) === 'Forse Levis', await page.evaluate(() => lastAnalysis.brand));
  check('etichetta illeggibile -> lo dice invece di tacere', (await page.textContent('#rFotoTxt')).includes('non sono riuscito a leggerla'));

  console.log('\n-- se la lettura etichetta fallisce del tutto --');
  await page.unroute('**/.netlify/functions/claude');
  await page.route('**/.netlify/functions/claude', async route => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 't.t', expiresIn: 900000 }) });
    const b = JSON.parse(req.postData());
    aiPost.push(b);
    if (/Trascrivi ESATTAMENTE/.test(b.prompt)) return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'modello giu' }) });
    const risposta = /stima il prezzo di rivendita/i.test(b.prompt)
      ? { prezzoSuggerito: 35, rangeMin: 25, rangeMax: 45, percentuale: 50, motivazione: 'ok', fattori: ['a'], consiglio: 'c' }
      : rispostaCapo;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: JSON.stringify(risposta), model: 'm', provider: 'groq' }) });
  });
  rispostaCapo = Object.assign({}, rispostaCapo, { tipo: 'Cappotto di prova' });
  await page.evaluate(() => { lastAnalysis = null; });
  await page.click('#btnA');
  await page.waitForFunction(() => lastAnalysis !== null, null, { timeout: 30000 });
  check('l\'analisi principale arriva comunque', (await page.textContent('#rFotoTxt')).includes('Cappotto di prova'));
  check('e non compare un errore', await page.evaluate(() => document.getElementById('eFoto').style.display) === 'none');

  console.log('\n-- ricerca per immagine --');
  lensPost = [];
  await page.click('#btnL');
  await page.waitForSelector('#rLens:not([style*="display: none"])', { timeout: 30000 });
  const inviata = lensPost[0];
  const byte = Math.round(inviata.image.length * 3 / 4);
  check(`l'immagine sta sotto il limite di SerpApi (${Math.round(byte / 1024)}KB)`, byte <= 460 * 1024, byte);
  check('non manda la foto dell\'etichetta', lensPost.length === 1);
  check('mostra l\'ipotesi di Lens', (await page.textContent('#rLens')).includes('Levis Trucker Jacket'));
  check('elenca i risultati coi prezzi', (await page.textContent('#rLens')).includes('100€') && (await page.textContent('#rLens')).includes('60€'));
  check('riporta la mediana', (await page.textContent('#rLens')).includes('80€'));
  check('i link escono con noopener', (await page.evaluate(() => document.querySelector('#rLens a').rel)).includes('noopener'));

  console.log('\n-- i prezzi trovati entrano nella stima --');
  await page.click('button[onclick="usaLensPerPrezzo()"]');
  check('il nome prodotto finisce nel campo', (await page.inputValue('#pNome')).includes('Levis Trucker'), await page.inputValue('#pNome'));
  aiPost = [];
  await page.click('#btnP');
  await page.waitForSelector('#rPre:not([style*="display: none"])', { timeout: 30000 });
  const promptPrezzo = aiPost[aiPost.length - 1].prompt;
  check('il prompt della stima contiene i prezzi reali', /mediana 80€, minimo 60€, massimo 100€/.test(promptPrezzo), promptPrezzo.slice(0, 200));
  check('e dice al modello di partire da li', /Parti da qui invece che dalla tua memoria/.test(promptPrezzo));

  console.log('\n-- server senza SERPAPI_KEY --');
  lensStatus = 501;
  await page.evaluate(() => { lastLens = null; });
  await page.click('#nav-foto');
  await page.click('#btnL');
  await page.waitForTimeout(500);
  check('il bottone sparisce invece di ripetere l\'errore', await page.evaluate(() => document.getElementById('btnL').style.display) === 'none');
  check('e non mostra un errore rosso', await page.evaluate(() => document.getElementById('eLens').style.display) === 'none');

  check('nessun errore JS', errors.length === 0, errors);
  await browser.close(); server.close();
  console.log(`\n${pass} passati, ${fail} falliti`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
