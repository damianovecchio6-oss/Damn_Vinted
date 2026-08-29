const L = require('./lib');
const { chromium } = require('playwright-core');
let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${e !== undefined ? ' -> ' + JSON.stringify(e) : ''}`); } };

(async () => {
  const server = await L.serviSito(8898);
  const browser = await chromium.launch({ executablePath: L.chromium(), args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  let bodies = [];
  await page.route('**/.netlify/functions/claude', async route => {
    const req = route.request();
    if (req.method() === 'GET')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 't.t', expiresIn: 900000 }) });
    bodies.push(req.postData());
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ text: JSON.stringify({ tipo: 'Giacca', brand: 'Non identificato', colore: 'blu', condizione: 'Nuovo senza etichetta', fasciaPrezzoMin: 20, fasciaPrezzoMax: 40, vintageStima: 'Non vintage' }), model: 'vision-finto' })
    });
  });

  await page.goto('http://127.0.0.1:8898/', { waitUntil: 'load' });
  // La pagina ora si apre sul sole: le prove che seguono partono da dentro una
  // funzione, come se ci fossi arrivato toccando il suo raggio.
  await page.evaluate(() => sw('foto'));

  // Foto grandi e rumorose (il rumore impedisce al JPEG di comprimere a niente),
  // come quelle che escono davvero da un telefono.
  const dataUrls = await page.evaluate(() => {
    const out = [];
    for (let k = 0; k < 4; k++) {
      const c = document.createElement('canvas');
      c.width = 3024; c.height = 4032;
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(c.width, c.height);
      for (let i = 0; i < img.data.length; i += 4) {
        img.data[i] = Math.random() * 255; img.data[i + 1] = Math.random() * 255;
        img.data[i + 2] = Math.random() * 255; img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      out.push(c.toDataURL('image/jpeg', 0.95));
    }
    return out;
  });
  const files = dataUrls.map((u, i) => ({ name: `foto${i}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(u.split(',')[1], 'base64') }));
  console.log('\n  (4 foto da ' + files.map(f => Math.round(f.buffer.length / 1024) + 'KB').join(', ') + ')');

  console.log('\n-- analisi foto --');
  await page.setInputFiles('#fileInput', files);
  check('le 4 foto vengono prese', await page.evaluate(() => selFiles.length) === 4);
  check('il bottone Analizza si attiva', await page.evaluate(() => !document.getElementById('btnA').disabled));
  check('si vedono 4 anteprime', await page.evaluate(() => document.querySelectorAll('#ps .pw').length) === 4);

  await page.click('#btnA');
  await page.waitForSelector('#rFoto:not([style*="display: none"])', { timeout: 30000 });
  check('l\'analisi arriva a mostrare il risultato', (await page.textContent('#rFotoTxt')).includes('Giacca'));
  check('mostra quale modello ha risposto', (await page.textContent('#rFotoModel')).includes('vision-finto'));

  const inviato = bodies[bodies.length - 1];
  const payload = JSON.parse(inviato);
  const mb = Buffer.byteLength(inviato) / 1024 / 1024;
  console.log(`  (payload inviato: ${mb.toFixed(2)}MB)`);
  check('4 immagini nel payload', payload.images.length === 4);
  check('il payload sta sotto il limite di 6MB della function', mb < 6, mb.toFixed(2) + 'MB');
  check('e sotto il budget che ci siamo dati (4.2MB di base64)', payload.images.reduce((n, i) => n + i.base64.length, 0) <= 4.2 * 1024 * 1024);
  check('la miniatura per lo storico e\' stata prodotta', await page.evaluate(() => typeof lastThumbnail === 'string' && lastThumbnail.startsWith('data:image/jpeg;base64,')));
  check('la miniatura e\' piccola (< 30KB)', await page.evaluate(() => lastThumbnail.length) < 30000, await page.evaluate(() => lastThumbnail.length));

  console.log('\n-- una foto sola: si tiene la risoluzione alta --');
  bodies = [];
  await page.setInputFiles('#fileInput', [files[0]]);
  await page.click('#btnA');
  await page.waitForSelector('#rFoto:not([style*="display: none"])', { timeout: 30000 });
  const uno = JSON.parse(bodies[bodies.length - 1]);
  const lato = await page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/jpeg;base64,' + b64)).blob());
    return Math.max(bmp.width, bmp.height);
  }, uno.images[0].base64);
  check('con una foto sola resta a 1600px (etichetta leggibile)', lato === 1600, lato);

  console.log('\n-- passaggio ad annuncio --');
  await page.click('button[onclick="toAnnuncio()"]');
  await page.waitForTimeout(200);
  check('il tipo finisce nel campo nome', await page.inputValue('#aNome') === 'Giacca');
  check('"Non identificato" non finisce nel campo marca', await page.inputValue('#aMarca') === '');
  check('la condizione cade sulla voce giusta', await page.inputValue('#aCond') === 'Nuovo senza etichetta', await page.inputValue('#aCond'));
  check('il prezzo di partenza e\' la media della fascia', await page.inputValue('#pPrezzo') === '30', await page.inputValue('#pPrezzo'));

  check('nessun errore JS', errors.length === 0, errors);
  await browser.close(); server.close();
  console.log(`\n${pass} passati, ${fail} falliti`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
