const L = require('./lib');
const { chromium } = require('playwright-core');
let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${e !== undefined ? ' -> ' + JSON.stringify(e) : ''}`); } };

// Il telefono non e' un mouse piccolo. Le altre suite guidano il puntatore, e
// col puntatore andava tutto: sul telefono no, perche' il click che il browser
// sintetizza dopo un tocco a volte non arriva - dopo un giro della ghiera, per
// esempio, Chromium lo sopprime e il tasto centrale non apriva niente.
// Qui i tocchi sono veri, mandati come li manda un dito.
(async () => {
  const server = await L.serviSito(8894);
  const browser = await chromium.launch({ executablePath: L.chromium(), args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  const errori = [];
  page.on('pageerror', e => errori.push(String(e)));
  await page.goto('http://127.0.0.1:8894/', { waitUntil: 'load' });
  const cdp = await ctx.newCDPSession(page);

  const dito = async (punti) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: punti[0][0], y: punti[0][1] }] });
    for (const p of punti.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p[0], y: p[1] }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const ditoTrattenuto = async (punti) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: punti[0][0], y: punti[0][1] }] });
    for (const p of punti.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p[0], y: p[1] }] });
    return () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const puntiDelGiro = async (daGradi, aGradi, passo) => {
    const c = await page.evaluate(() => {
      const r = document.getElementById('soleApp').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, raggio: r.width * 0.36 };
    });
    const punti = [];
    for (let g = daGradi; passo > 0 ? g <= aGradi : g >= aGradi; g += passo) {
      const a = g * Math.PI / 180;
      punti.push([c.x + c.raggio * Math.cos(a), c.y + c.raggio * Math.sin(a)]);
    }
    return punti;
  };
  const dove = sel => page.evaluate(s => {
    const r = document.querySelector(s).getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  }, sel);
  const giroDelDito = async (daGradi, aGradi, passo) => {
    const c = await page.evaluate(() => {
      const r = document.getElementById('soleApp').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, raggio: r.width * 0.36 };
    });
    const punti = [];
    for (let g = daGradi; passo > 0 ? g <= aGradi : g >= aGradi; g += passo) {
      const a = g * Math.PI / 180;
      punti.push([c.x + c.raggio * Math.cos(a), c.y + c.raggio * Math.sin(a)]);
    }
    await dito(punti);
  };
  const scheda = () => page.evaluate(() => document.querySelector('.tp.on').id);
  const scelta = () => page.evaluate(() => document.getElementById('dScelta').textContent);
  const aspetta = () => page.waitForTimeout(700);

  console.log('\n-- il dito sulla ghiera --');
  check('si parte dal sole', await scheda() === 'tab-sole', await scheda());
  const partenza = await scelta();
  await giroDelDito(0, 90, 10);
  const dopoAvanti = await scelta();
  check('girando il dito la selezione avanza', dopoAvanti !== partenza, { partenza, dopoAvanti });
  await giroDelDito(0, -90, -10);
  check('e girando indietro torna dov\'era', await scelta() === partenza, { partenza, ora: await scelta() });

  console.log('\n-- il tasto centrale, che col dito non generava nessun click --');
  await giroDelDito(0, 90, 10);
  const mostrata = await scelta();
  await dito([await dove('#soleApp .disco')]);
  await aspetta();
  check('il tap al centro apre quello che il disco mostra',
    (await scheda()).toUpperCase().endsWith(mostrata), { mostrata, scheda: await scheda() });

  console.log('\n-- il sole parcheggiato --');
  check('il sole e parcheggiato', await page.evaluate(() => document.getElementById('soleApp').classList.contains('parcheggiato')));
  const visibile = await page.evaluate(() => {
    const d = document.querySelector('#soleApp .disco').getBoundingClientRect();
    return Math.round(window.innerHeight - (d.y));
  });
  check('e se ne vede una parte buona', visibile > 40, { visibile });
  check('anzi, ci sta tutto dentro: e una ghiera, non un ornamento', await page.evaluate(() => {
    const n = document.querySelector('#soleApp .soleNav').getBoundingClientRect();
    return n.bottom <= window.innerHeight;
  }), await page.evaluate(() => {
    const n = document.querySelector('#soleApp .soleNav').getBoundingClientRect();
    return { sotto: Math.round(n.bottom), schermo: window.innerHeight };
  }));

  // Il pezzo nuovo, e quello che col solo mouse non si vedrebbe: da
  // parcheggiato il giro del dito non prepara una scelta, la fa.
  const schedaPrima = await scheda();
  await giroDelDito(0, 60, 10);
  await aspetta();
  check('girandolo da parcheggiato il dito cambia funzione',
    await scheda() !== schedaPrima, { prima: schedaPrima, ora: await scheda() });
  check('e il sole resta parcheggiato invece di tornare a casa',
    await page.evaluate(() => document.getElementById('soleApp').classList.contains('parcheggiato')));
  check('il disco mostra quella nuova',
    (await scheda()).toUpperCase().endsWith(await scelta()), { disco: await scelta(), scheda: await scheda() });

  await dito([await dove('#soleApp .disco')]);
  await aspetta();
  check('toccandolo si torna a scegliere', await scheda() === 'tab-sole', await scheda());

  console.log('\n-- il tocco secco su un raggio --');
  await dito([await dove('.raggio[data-scheda="ricerca"] .presa')]);
  await aspetta();
  check('apre la sua funzione', await scheda() === 'tab-ricerca', await scheda());
  await dito([await dove('#soleApp .disco')]);
  await aspetta();

  console.log('\n-- un giro non apre per sbaglio --');
  const prima = await scheda(), sceltaPrima = await scelta();
  await giroDelDito(-90, 30, 10);   // finisce con il dito su un raggio
  check('finire il giro su un raggio non lo apre', await scheda() === prima, await scheda());
  check('ma la selezione e cambiata', await scelta() !== sceltaPrima, { prima: sceltaPrima, ora: await scelta() });

  console.log('\n-- la pagina non scorre mentre giri --');
  const scorrimento = await page.evaluate(() => window.scrollY);
  await giroDelDito(0, 180, 15);
  check('lo scorrimento resta fermo', await page.evaluate(() => window.scrollY) === scorrimento);

  console.log('\n-- la pagina sta ferma mentre giri il sole parcheggiato --');
  // Serve una pagina piu' alta dello schermo, o non c'e' niente da tenere fermo.
  await page.evaluate(() => {
    document.querySelectorAll('.tp').forEach(t => {
      const d = document.createElement('div');
      d.className = 'riempitivoDiProva'; d.style.height = '1600px';
      t.appendChild(d);
    });
  });
  await dito([await dove('.raggio[data-scheda="scanner"] .presa')]);
  await aspetta();
  check('si parte da una funzione aperta e dal sole parcheggiato',
    await page.evaluate(() => document.getElementById('soleApp').classList.contains('parcheggiato')));
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForTimeout(400);
  const scorrimentoPrima = await page.evaluate(() => Math.round(window.scrollY));

  const rilascia = await ditoTrattenuto(await puntiDelGiro(0, 100, 10));
  const scorrimentoDurante = await page.evaluate(() => Math.round(window.scrollY));
  const schedaDurante = await page.evaluate(() => document.querySelector('.tp.on').id);
  check('la funzione e gia cambiata mentre il dito e ancora giu',
    schedaDurante !== 'tab-scanner', schedaDurante);
  check('ma la pagina non si e mossa di un pixel',
    scorrimentoDurante === scorrimentoPrima, { prima: scorrimentoPrima, durante: scorrimentoDurante });
  await rilascia();
  await page.waitForTimeout(1200);
  check('e quando ti fermi va in cima una volta sola',
    await page.evaluate(() => Math.round(window.scrollY)) === 0,
    await page.evaluate(() => Math.round(window.scrollY)));
  await page.evaluate(() => document.querySelectorAll('.riempitivoDiProva').forEach(d => d.remove()));

  console.log('\n-- errori JS accumulati --');
  check('nessun errore JS in tutta la sessione', errori.length === 0, errori);

  await browser.close();
  server.close();
  console.log(`\n${pass} passati, ${fail} falliti`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
