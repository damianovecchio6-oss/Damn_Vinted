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

  console.log('\n-- il JSON arriva quasi mai da solo --');
  // Le forme in cui i modelli rispondono davvero. La prima e' quella che ha
  // rotto lo scanner sul sito: i modelli con visione rimasti su Groq sono
  // della famiglia Qwen3, che ragiona ad alta voce prima di rispondere.
  const risposte = [
    ['ragionamento davanti', '<think>Vedo una giacca di jeans, la marca non si legge.</think>{"tipo":"giacca"}'],
    ['ragionamento su piu righe', '<think>\nprimo\nsecondo\n</think>\n{"tipo":"giacca"}'],
    ['dentro i backtick', '```json\n{"tipo":"giacca"}\n```'],
    ['con una frase di cortesia prima', 'Ecco l\'analisi richiesta:\n{"tipo":"giacca"}'],
    ['e anche dopo', '{"tipo":"giacca"}\nSpero sia utile!'],
    ['tutto insieme', '<think>rifletto</think>Ecco:\n```json\n{"tipo":"giacca"}\n```\nfine'],
    ['pulito, come dovrebbe', '{"tipo":"giacca"}']
  ];
  for (const [nome, grezzo] of risposte) {
    const letto = await page.evaluate(t => { const d = estraiJson(t); return d && d.tipo; }, grezzo);
    check('lo capisce col ' + nome, letto === 'giacca', letto);
  }
  // E quello che NON si puo' salvare deve restare non salvato, invece di
  // diventare un oggetto vuoto che sembra un'analisi riuscita.
  const nonSalvabili = [
    ['risposta a parole', 'Mi dispiace, non riesco ad analizzare questa immagine.'],
    ['ragionamento troncato', '<think>sto ancora pensando e i token sono finiti'],
    ['vuota', '']
  ];
  for (const [nome, grezzo] of nonSalvabili) {
    check('si arrende sulla ' + nome, await page.evaluate(t => estraiJson(t) === null, grezzo));
  }

  console.log('\n-- il tetto che ci diamo --');
  // Il guasto vero era qui, e nessuna foto di prova lo faceva vedere: il
  // budget che ci davamo (4.2MB) stava SOPRA il limite di Groq (4MB per
  // richiesta), quindi encodeAll accettava payload che il provider rifiutava
  // con un 400. Solo le foto che cadevano fra i due numeri si rompevano, ed
  // e' una fascia stretta: un controllo end-to-end la manca quasi sempre.
  // Questo invece dice il fatto: il nostro tetto non puo' stare sopra il suo.
  check('il budget di codifica sta sotto i 4MB di Groq',
    await page.evaluate(() => MAX_PAYLOAD_B64) <= 4 * 1024 * 1024,
    (await page.evaluate(() => MAX_PAYLOAD_B64) / 1024 / 1024).toFixed(2) + 'MB');

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
  // Il metro vero e' Groq, non noi: sopra i 4MB di base64 PER RICHIESTA
  // risponde 400. Il controllo di prima misurava un budget nostro che stava
  // sopra quel limite, e passava mentre il sito si prendeva l'errore.
  const base64Totale = payload.images.reduce((n, i) => n + i.base64.length, 0);
  check('il base64 sta sotto i 4MB oltre i quali Groq risponde 400',
    base64Totale <= 4 * 1024 * 1024, (base64Totale / 1024 / 1024).toFixed(2) + 'MB');
  check('e la richiesta intera, prompt compreso, pure',
    Buffer.byteLength(inviato) <= 4 * 1024 * 1024, mb.toFixed(2) + 'MB');
  check('la miniatura per lo storico e\' stata prodotta', await page.evaluate(() => typeof lastThumbnail === 'string' && lastThumbnail.startsWith('data:image/jpeg;base64,')));
  check('la miniatura e\' piccola (< 30KB)', await page.evaluate(() => lastThumbnail.length) < 30000, await page.evaluate(() => lastThumbnail.length));

  console.log('\n-- anche l\'etichetta, che viaggia da sola --');
  bodies = [];
  await page.setInputFiles('#fileInput', files);
  await page.evaluate(() => segnaEtichetta(0));
  await page.click('#btnA');
  await page.waitForSelector('#rFoto:not([style*="display: none"])', { timeout: 30000 });
  const richieste = bodies.map(b => JSON.parse(b));
  const etichetta = richieste.find(b => /Trascrivi ESATTAMENTE/.test(b.prompt || ''));
  check('la foto dell\'etichetta parte in una richiesta sua', !!etichetta, richieste.length);
  check('e anche lei sta sotto i 4MB', etichetta && etichetta.images[0].base64.length <= 4 * 1024 * 1024,
    etichetta ? (etichetta.images[0].base64.length / 1024 / 1024).toFixed(2) + 'MB' : 'assente');
  check('nessuna delle richieste sfonda il limite',
    bodies.every(b => Buffer.byteLength(b) <= 4 * 1024 * 1024),
    bodies.map(b => (Buffer.byteLength(b) / 1024 / 1024).toFixed(2) + 'MB'));
  await page.evaluate(() => segnaEtichetta(0));

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
