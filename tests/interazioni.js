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

  console.log('\n-- il sole e la home: i raggi sono le funzioni --');
  check('la pagina si apre sul sole', await page.evaluate(() => document.querySelector('.tp.on').id) === 'tab-sole', await page.evaluate(() => document.querySelector('.tp.on').id));
  check('il sole vive fuori dalle schede, non dentro la home', await page.evaluate(() => !document.getElementById('tab-sole').querySelector('.soleWrap') && !!document.querySelector('#soleApp .soleWrap')));
  check('sei raggi, una funzione ciascuno', await page.evaluate(() => document.querySelectorAll('.raggio').length) === 6);
  check('il nome sta dentro al disco, non in una fascia in cima',
    await page.evaluate(() => document.querySelector('.dSotto').textContent.trim()) === 'ALBA',
    await page.evaluate(() => document.querySelector('.dSotto').textContent));
  check('e sopra al nome c\'e la funzione, che e la cosa che cambia',
    await page.evaluate(() => document.getElementById('dScelta').textContent.trim()) === 'ANALIZZA');
  check('di intestazioni non ce ne sono piu',
    await page.evaluate(() => !document.querySelector('.hdr') && !document.querySelector('.damn')));
  const raggi = await page.evaluate(() => Array.from(document.querySelectorAll('.raggio')).map(r => ({
    scheda: r.dataset.scheda, ruolo: r.getAttribute('role'), nome: r.getAttribute('aria-label'),
    etichetta: r.querySelector('.rEti').textContent, tab: r.getAttribute('tabindex')
  })));
  check('sono bottoni veri, non disegni', raggi.every(r => r.ruolo === 'button' && r.tab === '0' && r.nome && r.nome.length > 5), raggi);
  check('e dicono a voce cosa fanno', raggi.map(r => r.etichetta).join(',') === 'ANALIZZA,ANNUNCIO,PREZZO,RICERCA,STORICO,SCANNER', raggi.map(r => r.etichetta));

  const doveSta = () => page.evaluate(() => {
    const d = document.querySelector('#soleApp .disco').getBoundingClientRect();
    return { centro: Math.round(d.y + d.height / 2), largo: Math.round(d.width), fondo: window.innerHeight };
  });
  const aCasa = await doveSta();
  check('a casa il sole sta in mezzo allo schermo', Math.abs(aCasa.centro - aCasa.fondo / 2) < 40, aCasa);

  console.log('\n-- la ghiera: si gira intorno come sull\'iPod --');
  await page.evaluate(() => sw('sole'));
  const centro = await page.evaluate(() => {
    const r = document.getElementById('soleApp').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, raggio: r.width * 0.36 };
  });
  const gira = async (daGradi, aGradi, passo) => {
    const punto = g => [centro.x + centro.raggio * Math.cos(g * Math.PI / 180),
                        centro.y + centro.raggio * Math.sin(g * Math.PI / 180)];
    await page.mouse.move(...punto(daGradi));
    await page.mouse.down();
    for (let g = daGradi + passo; passo > 0 ? g <= aGradi : g >= aGradi; g += passo) await page.mouse.move(...punto(g));
    await page.mouse.up();
  };
  const scelta = () => page.evaluate(() => document.getElementById('dScelta').textContent);
  const accesi = () => page.evaluate(() => Array.from(document.querySelectorAll('.raggio.selezionato')).map(r => r.dataset.scheda));

  check('si parte dalla prima funzione', await scelta() === 'ANALIZZA', await scelta());
  await gira(0, 90, 10);
  check('mezzo quarto di giro = due scatti', await scelta() === 'PREZZO', await scelta());
  check('e il raggio corrispondente si accende', (await accesi()).join() === 'prezzo', await accesi());
  check('uno solo per volta', (await accesi()).length === 1);

  // Il giro nativo del disegno rubava i movimenti dal secondo giro in poi:
  // questo controllo c'e' perche' e' successo davvero.
  await page.waitForTimeout(300);
  await gira(0, -90, -10);
  check('il secondo giro funziona come il primo', await scelta() === 'ANALIZZA', await scelta());
  await page.waitForTimeout(300);
  await gira(180, 270, 10);
  check('e si puo partire da qualunque punto della corona', await scelta() === 'PREZZO', await scelta());

  await page.waitForTimeout(300);
  await page.evaluate(() => { document.getElementById('soleApp').dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })); });
  check('anche la rotella del mouse scatta', await scelta() === 'RICERCA', await scelta());

  await page.evaluate(() => document.querySelector('#soleApp .soleNav').focus());
  await page.keyboard.press('ArrowLeft');
  check('le frecce girano la ghiera', await scelta() === 'PREZZO', await scelta());
  await page.keyboard.press('Enter');
  check('Invio preme al centro e apre quello scelto', await page.evaluate(() => document.querySelector('.tp.on').id) === 'tab-prezzo', await page.evaluate(() => document.querySelector('.tp.on').id));

  await page.click('#soleApp .dTitolo');
  await page.waitForTimeout(700);
  await gira(0, 90, 10);
  // Subito, senza aspettare: dopo un giro il tasto centrale deve rispondere
  // al primo tocco, non dopo un tempo di grazia.
  await page.click('#soleApp .dTitolo');
  check('il tasto centrale apre quello che il disco mostra', await page.evaluate(() => document.querySelector('.tp.on').id) === 'tab-storico', await page.evaluate(() => document.querySelector('.tp.on').id));
  await page.click('#soleApp .dTitolo');
  await page.waitForTimeout(700);

  // Un giro finisce con il dito su un raggio: quel rilascio non deve aprirlo.
  await page.evaluate(() => sw('sole'));
  await page.waitForTimeout(700);
  const primaDelGiro = await page.evaluate(() => document.querySelector('.tp.on').id);
  await gira(-90, 20, 10);
  check('finire il giro su un raggio non lo apre', await page.evaluate(() => document.querySelector('.tp.on').id) === primaDelGiro);

  console.log('\n-- scegliendo, il sole va a parcheggiarsi sul bordo --');
  await page.evaluate(() => sw('sole'));
  await page.waitForTimeout(700);
  await page.click('.raggio[data-scheda="ricerca"] .presa');
  check('la funzione si apre', await page.evaluate(() => document.querySelector('.tp.on').id) === 'tab-ricerca');
  check('e il sole passa in stato parcheggiato', await page.evaluate(() => document.getElementById('soleApp').classList.contains('parcheggiato')));
  await page.waitForTimeout(700);
  const parcheggiato = await doveSta();
  const ingombro = await page.evaluate(() => {
    const n = document.querySelector('#soleApp .soleNav').getBoundingClientRect();
    return { sopra: Math.round(n.top), sotto: Math.round(n.bottom), schermo: window.innerHeight };
  });
  check('ci sta tutto dentro: non e piu un mezzo sole che spunta dal bordo',
    ingombro.sotto <= ingombro.schermo, ingombro);
  check('e sta appoggiato in fondo, non in mezzo alla pagina',
    ingombro.sotto > ingombro.schermo - 60 && ingombro.sopra > ingombro.schermo / 2, ingombro);
  check('e il contenuto gli riserva almeno tutta la sua altezza', await page.evaluate(() => {
    const riservato = parseInt(getComputedStyle(document.querySelector('.shell')).paddingBottom, 10);
    return riservato >= document.querySelector('#soleApp .soleNav').getBoundingClientRect().height;
  }), await page.evaluate(() => ({
    riservato: parseInt(getComputedStyle(document.querySelector('.shell')).paddingBottom, 10),
    sole: Math.round(document.querySelector('#soleApp .soleNav').getBoundingClientRect().height)
  })));
  check('rimpicciolito, ma ancora visibile', parcheggiato.largo > 40 && parcheggiato.largo < aCasa.largo * 0.6, { parcheggiato: parcheggiato.largo, casa: aCasa.largo });
  check('le scritte dei raggi spariscono: a quella scala sarebbero macchie', await page.evaluate(() => getComputedStyle(document.querySelector('.rEti')).opacity) === '0');
  check('e i raggi non si toccano piu uno per uno', await page.evaluate(() => getComputedStyle(document.querySelector('.raggio')).pointerEvents) === 'none');
  check('il contenuto lascia spazio al sole parcheggiato', await page.evaluate(() => parseInt(getComputedStyle(document.querySelector('.shell')).paddingBottom, 10)) > 90);

  console.log('\n-- parcheggiato resta una ghiera viva --');
  check('il disco dice quale funzione e aperta',
    await page.evaluate(() => document.getElementById('dScelta').textContent.trim()) === 'RICERCA',
    await scelta());
  check('e il raggio di quella funzione e l unico pieno', await page.evaluate(() => {
    const acceso = document.querySelectorAll('.raggio.selezionato');
    return acceso.length === 1 && acceso[0].dataset.scheda === 'ricerca';
  }), await accesi());

  // Il punto di tutto il disegno: da qui si cambia funzione girando, senza
  // dover prima tornare al sole intero.
  const primaDelloScatto = await page.evaluate(() => document.querySelector('.tp.on').id);
  await page.evaluate(() => { document.getElementById('soleApp').dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })); });
  await page.waitForTimeout(120);
  check('uno scatto da parcheggiato cambia funzione da solo',
    await page.evaluate(() => document.querySelector('.tp.on').id) === 'tab-storico',
    { prima: primaDelloScatto, dopo: await page.evaluate(() => document.querySelector('.tp.on').id) });
  check('e il disco lo dice subito', await scelta() === 'STORICO', await scelta());
  check('il sole resta parcheggiato: non si torna a casa a ogni scatto',
    await page.evaluate(() => document.getElementById('soleApp').classList.contains('parcheggiato')));
  await page.evaluate(() => document.querySelector('#soleApp .soleNav').focus());
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(120);
  check('anche le frecce girano la ghiera parcheggiata',
    await page.evaluate(() => document.querySelector('.tp.on').id) === 'tab-ricerca',
    await page.evaluate(() => document.querySelector('.tp.on').id));

  // E arrivarci da un bottone invece che dalla ghiera non deve lasciare il
  // disco a mostrare la funzione sbagliata.
  await page.evaluate(() => sw('prezzo'));
  check('aprendo una scheda da altrove la ghiera segue', await scelta() === 'PREZZO', await scelta());

  await page.click('#soleApp .dTitolo');
  check('toccando il sole si torna a scegliere', await page.evaluate(() => document.querySelector('.tp.on').id) === 'tab-sole');
  check('e il sole risale', await page.evaluate(() => !document.getElementById('soleApp').classList.contains('parcheggiato')));

  // Il tocco su un raggio risale fino al sole, che nel frattempo si e'
  // parcheggiato: senza il controllo apriva la funzione e tornava subito indietro.
  await page.click('.raggio[data-scheda="prezzo"] .presa');
  await page.waitForTimeout(700);
  check('un tocco su un raggio non rimbalza a casa', await page.evaluate(() => document.querySelector('.tp.on').id) === 'tab-prezzo', await page.evaluate(() => document.querySelector('.tp.on').id));

  await page.click('#soleApp .dTitolo');
  await page.evaluate(() => document.querySelector('.raggio[data-scheda="prezzo"]').focus());
  await page.keyboard.press('Enter');
  check('i raggi si aprono anche da tastiera', await page.evaluate(() => document.querySelector('.tp.on').id) === 'tab-prezzo');

  console.log('\n-- la scheda entra dal lato da cui l\'hai chiamata --');
  await page.evaluate(() => sw('foto'));
  check('andando indietro entra da sinistra', await page.evaluate(() => !document.getElementById('tab-foto').classList.contains('daDestra')));
  await page.evaluate(() => sw('ricerca'));
  check('andando avanti entra da destra', await page.evaluate(() => document.getElementById('tab-ricerca').classList.contains('daDestra')));
  check('una sola scheda per volta resta accesa', await page.evaluate(() => document.querySelectorAll('.tp.on').length) === 1);

  console.log('\n-- il bottone dice che sta lavorando --');
  await page.evaluate(() => sw('prezzo'));
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
  await page.evaluate(() => sw('annuncio'));
  await page.evaluate(() => { document.getElementById('rAnnTitolo').textContent = 'Un titolo'; show('rAnn'); });
  const copia = await page.$('#tab-annuncio .cbtn:nth-child(2)');
  await copia.click();
  await page.waitForFunction(() => !!document.querySelector('#tab-annuncio .cbtn.fatto'), null, { timeout: 5000 });
  check('il bottone conferma da se', (await copia.textContent()).includes('Fatto'), await copia.textContent());
  await page.waitForFunction(() => !document.querySelector('#tab-annuncio .cbtn.fatto'), null, { timeout: 5000 });
  check('e torna com\'era da solo', (await copia.textContent()).includes('Copia Titolo'), await copia.textContent());

  console.log('\n-- il focus da tastiera si vede --');
  await page.evaluate(() => sw('prezzo'));
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
  await page.evaluate(() => sw('foto')); await page.evaluate(() => sw('prezzo'));
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
  await fermo.click('.raggio[data-scheda="prezzo"] .presa');
  check('il raggio apre subito', await fermo.evaluate(() => document.querySelector('.tp.on').id) === 'tab-prezzo',
    await fermo.evaluate(() => document.querySelector('.tp.on').id));
  const scivolata = await fermo.evaluate(() => {
    const s = document.getElementById('soleApp');
    return { parcheggiato: s.classList.contains('parcheggiato'), durata: getComputedStyle(s).transitionDuration };
  });
  check('e il sole si parcheggia senza scivolare', scivolata.parcheggiato && parseFloat(scivolata.durata) < 0.001, scivolata);

  check('e non vibra niente', await fermo.evaluate(() => {
    let vibrato = false;
    navigator.vibrate = () => { vibrato = true; return true; };
    tocco();
    return vibrato;
  }) === false);
  await fermo.close();

  console.log('\n-- il sole del foglio --');
  check('il disegno e definito una volta sola', await page.evaluate(() => document.querySelectorAll('#ico-sole').length) === 1);
  check('e riusato dove serve', await page.evaluate(() => document.querySelectorAll('use[href="#ico-sole"]').length) >= 5,
    await page.evaluate(() => document.querySelectorAll('use[href="#ico-sole"]').length));
  check('prende il colore dal CSS, non dal file', await page.evaluate(() => {
    const s = document.querySelector('.soleSpin');
    return getComputedStyle(s).color === 'rgb(232, 200, 74)';
  }), await page.evaluate(() => getComputedStyle(document.querySelector('.soleSpin')).color));
  check('gira mentre l\'app lavora', await page.evaluate(() => getComputedStyle(document.querySelector('.soleSpin')).animationName) === 'spin');
  check('sorge dietro ogni risultato', await page.evaluate(() => {
    const res = Array.from(document.querySelectorAll('.res'));
    return res.length >= 4 && res.every(r => r.querySelector(':scope > .alba'));
  }), await page.evaluate(() => Array.from(document.querySelectorAll('.res')).map(r => r.id + ':' + !!r.querySelector(':scope > .alba'))));
  check('ma resta dietro: non si puo cliccare', await page.evaluate(() => getComputedStyle(document.querySelector('.alba')).pointerEvents) === 'none');
  check('e non lo legge chi usa uno screen reader', await page.evaluate(() => Array.from(document.querySelectorAll('.alba,.soleSpin,.soleLogo')).every(e => e.getAttribute('aria-hidden') === 'true')));
  await page.evaluate(() => sw('storico'));
  check('la versione sole+luna sta dove non c\'e ancora niente', await page.evaluate(() => {
    const vuoto = document.getElementById('historyEmpty');
    return vuoto.style.display !== 'none' ? !!vuoto.querySelector('use[href="#ico-sole-luna"]') : true;
  }));

  console.log('\n-- errori JS accumulati --');
  check('nessun errore JS in tutta la sessione', errors.length === 0, errors);

  await browser.close();
  server.close();
  console.log(`\n${pass} passati, ${fail} falliti`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
