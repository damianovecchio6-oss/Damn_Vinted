// La guida che si apre alla prima visita: due finestre, e mai piu'.
//
// Questa suite e' l'unica che NON chiama L.senzaGuida: le altre partono da un
// browser a cui e' gia' stato detto che la guida l'ha vista, qui invece si
// arriva come chi apre l'app la prima volta e non ha mai visto niente.
const L = require('./lib');
const { chromium } = require('playwright-core');
let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${e !== undefined ? ' -> ' + JSON.stringify(e) : ''}`); } };

const PORTA = 8891;
const aperta = page => page.evaluate(() => !document.getElementById('guida').hidden);
const passo = page => page.evaluate(() => {
  for (let i = 1; i <= 2; i++) if (!document.getElementById('gPasso' + i).hidden) return i;
  return 0;
});

(async () => {
  const server = await L.serviSito(PORTA);
  const browser = await chromium.launch({ executablePath: L.chromium(), args: ['--no-sandbox'] });
  const errori = [];

  // Ogni prova parte da un browser pulito: la guida si segna nel localStorage,
  // e due prove che si passano lo stesso profilo si darebbero la risposta a
  // vicenda.
  const primaVisita = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => errori.push(String(e)));
    await page.goto(`http://127.0.0.1:${PORTA}/`, { waitUntil: 'load' });
    return page;
  };

  console.log('\n-- la prima volta si apre da sola --');
  let page = await primaVisita();
  check('la guida si apre senza che nessuno la chieda', await aperta(page));
  check('e parte dal primo passo', await passo(page) === 1, await passo(page));
  check('il primo passo spiega la ghiera', /gira/i.test(await page.textContent('#gPasso1')), await page.textContent('#gPasso1'));
  check('e dice come si apre una funzione', /premi al centro/i.test(await page.textContent('#gPasso1')));
  check('si annuncia come finestra modale', await page.evaluate(() => {
    const b = document.getElementById('guidaBox');
    return b.getAttribute('role') === 'dialog' && b.getAttribute('aria-modal') === 'true';
  }));
  check('e dice a voce il titolo che si vede', await page.evaluate(() =>
    document.getElementById('guidaBox').getAttribute('aria-labelledby')) === 'gT1');
  check('il fuoco entra nella finestra', await page.evaluate(() =>
    document.getElementById('guida').contains(document.activeElement)),
    await page.evaluate(() => document.activeElement && document.activeElement.id));
  check('la pagina sotto non si scorre', await page.evaluate(() =>
    getComputedStyle(document.body).overflow) === 'hidden');

  console.log('\n-- il sole sotto e coperto: si legge, non si preme --');
  // La finestra sta sopra il sole per un motivo: chi non ha ancora letto come
  // funziona la ghiera non deve poterla girare per sbaglio.
  const schedaPrima = await page.evaluate(() => document.querySelector('.tp.on').id);
  const copre = await page.evaluate(() => {
    const r = document.querySelector('.raggio[data-scheda="prezzo"] .presa').getBoundingClientRect();
    const sopra = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!(sopra && sopra.closest('#guida'));
  });
  check('sopra i raggi c\'e la guida, non i raggi', copre);
  check('e la scheda aperta non cambia', await page.evaluate(() => document.querySelector('.tp.on').id) === schedaPrima);

  console.log('\n-- avanti, indietro, e il segnaposto --');
  await page.click('#gAvanti');
  check('Avanti porta al secondo passo', await passo(page) === 2, await passo(page));
  check('il secondo passo spiega la pagina: il sole parcheggiato', /parcheggia/i.test(await page.textContent('#gPasso2')));
  check('e cosa fanno i sei raggi', await page.evaluate(() => document.querySelectorAll('#gPasso2 .gL li').length) === 6);
  check('dice anche che lo storico resta qui', /questo dispositivo/i.test(await page.textContent('#gPasso2')));
  check('il segnaposto segue il passo', await page.evaluate(() =>
    !document.getElementById('gPunto1').classList.contains('on') && document.getElementById('gPunto2').classList.contains('on')));
  check('il titolo annunciato segue il passo', await page.evaluate(() =>
    document.getElementById('guidaBox').getAttribute('aria-labelledby')) === 'gT2');
  check('sull\'ultimo passo il tasto non dice piu Avanti', (await page.textContent('#gAvanti')).includes('Ho capito'), await page.textContent('#gAvanti'));
  await page.click('#gIndietro');
  check('Indietro torna al primo', await passo(page) === 1, await passo(page));
  check('e li il secondo tasto torna a essere Salta', (await page.textContent('#gIndietro')) === 'Salta', await page.textContent('#gIndietro'));

  console.log('\n-- chiusa una volta, non torna piu --');
  await page.click('#gAvanti');
  await page.click('#gAvanti');
  check('Ho capito la chiude', !(await aperta(page)));
  check('la pagina torna scorribile', await page.evaluate(() => getComputedStyle(document.body).overflow) !== 'hidden');
  check('e sotto c\'e il sole, non una schermata a meta', await page.evaluate(() => document.querySelector('.tp.on').id) === 'tab-sole');
  await page.reload({ waitUntil: 'load' });
  check('ricaricando non si ripresenta', !(await aperta(page)));
  await page.context().close();

  console.log('\n-- il sole si usa appena chiusa --');
  page = await primaVisita();
  await page.click('#gAvanti');
  await page.click('#gAvanti');
  await page.click('.raggio[data-scheda="prezzo"] .presa');
  check('il raggio si preme subito dopo', await page.evaluate(() => document.querySelector('.tp.on').id) === 'tab-prezzo',
    await page.evaluate(() => document.querySelector('.tp.on').id));
  await page.context().close();

  console.log('\n-- chi la salta la salta --');
  page = await primaVisita();
  await page.click('#gIndietro');
  check('Salta chiude dal primo passo', !(await aperta(page)));
  await page.reload({ waitUntil: 'load' });
  check('e non torna nemmeno a lui', !(await aperta(page)));
  await page.context().close();

  console.log('\n-- Esc, la croce, e il fondo --');
  page = await primaVisita();
  await page.keyboard.press('Escape');
  check('Esc chiude', !(await aperta(page)));
  await page.reload({ waitUntil: 'load' });
  check('e vale come lettura: non torna', !(await aperta(page)));
  await page.context().close();

  page = await primaVisita();
  await page.click('.guidaX');
  check('la croce chiude', !(await aperta(page)));
  await page.context().close();

  page = await primaVisita();
  await page.evaluate(() => document.querySelector('.guidaSfondo').click());
  check('toccare il fondo scuro chiude', !(await aperta(page)));
  await page.context().close();

  console.log('\n-- il fuoco resta dentro --');
  page = await primaVisita();
  const dentro = async () => page.evaluate(() => document.getElementById('guida').contains(document.activeElement));
  await page.evaluate(() => document.getElementById('gAvanti').focus());
  await page.keyboard.press('Tab');
  check('dall\'ultimo bottone il Tab rientra in cima', await dentro(),
    await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName)));
  await page.evaluate(() => document.querySelector('.guidaX').focus());
  await page.keyboard.press('Shift+Tab');
  check('e all\'indietro non scappa sotto', await dentro(),
    await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName)));
  await page.context().close();

  console.log('\n-- si puo tornare a leggerla --');
  page = await primaVisita();
  await page.keyboard.press('Escape');
  await page.click('.aiutoBtn');
  check('il "?" la riapre', await aperta(page));
  check('e la riapre dal primo passo', await passo(page) === 1, await passo(page));
  check('il "?" sta fuori dal sole, o ogni tocco aprirebbe una funzione', await page.evaluate(() =>
    !document.getElementById('soleApp').contains(document.querySelector('.aiutoBtn'))));
  await page.context().close();

  console.log('\n-- dove il localStorage e negato --');
  // Senza un posto dove segnarsi che e' stata vista, una finestra che torna a
  // ogni caricamento e' peggio del non averla mostrata: meglio tacere.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get(){ throw new Error('negato'); } });
  });
  const muta = await ctx.newPage();
  const esplosioni = [];
  muta.on('pageerror', e => esplosioni.push(String(e)));
  await muta.goto(`http://127.0.0.1:${PORTA}/`, { waitUntil: 'load' });
  check('la guida non si apre', !(await aperta(muta)));
  check('e la pagina non esplode', esplosioni.length === 0, esplosioni);
  await ctx.close();

  console.log('\n-- errori JS accumulati --');
  check('nessun errore JS in tutta la sessione', errori.length === 0, errori);

  await browser.close();
  server.close();
  console.log(`\n${pass} passati, ${fail} falliti`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
