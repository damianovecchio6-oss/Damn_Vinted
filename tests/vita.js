// PIANO, l'app della giornata che sta sotto /vita/. Le domande sono quattro:
// quello che scrivi resta, le regole "chill" sono davvero quelle scritte nel
// codice (tre cose e non di piu', un giorno saltato non rompe la fila), la
// ghiera si gira come quella di ALBA, e le due app sullo stesso dominio non si
// pestano i piedi.
//
// L'ultima non e' teoria: ALBA e PIANO hanno due service worker sulla stessa
// origine, e il primo modo di rompere tutto e' che uno cancelli la cache
// dell'altro o gli serva la propria pagina.
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const { chromium } = require('playwright-core');
const { check, fine } = L.contatore();

const VITA = path.join(L.SITO, 'vita');
const leggi = f => fs.readFileSync(path.join(VITA, f), 'utf8');

(async () => {
  console.log('\n-- il manifest: e\' un\'app a se\', non una pagina di ALBA --');

  let man = null;
  try { man = JSON.parse(leggi('manifest.webmanifest')); } catch (e) { man = null; }
  check('il manifest e\' JSON valido', !!man);

  if (man) {
    check('ha nome e nome corto', !!(man.name && man.short_name), [man.name, man.short_name]);
    check('si apre a schermo intero', man.display === 'standalone', man.display);
    // Il raggio d'azione e' /vita/ e non '/': con '/' l'icona in home di PIANO
    // aprirebbe anche ALBA come se fosse sua, e le due installazioni si
    // sovrascriverebbero a vicenda.
    check('parte da /vita/ e non esce di li\'',
      man.start_url === '/vita/' && man.scope === '/vita/', [man.start_url, man.scope]);
    check('fondo e tema sono il nero della pagina',
      man.background_color === '#07090b' && man.theme_color === '#07090b',
      [man.background_color, man.theme_color]);

    const icone = man.icons || [];
    const misura = m => icone.find(i => i.sizes === m + 'x' + m && (i.purpose || 'any').includes('any'));
    check('c\'e\' l\'icona 192', !!misura(192));
    check('c\'e\' l\'icona 512', !!misura(512));
    check('c\'e\' una maskable per il ritaglio di Android',
      icone.some(i => (i.purpose || '').includes('maskable')));
    check('le icone stanno sotto /vita/ e non rubano quelle di ALBA',
      icone.every(i => i.src.startsWith('/vita/img/')), icone.map(i => i.src));
    check('esistono davvero e sono PNG veri', icone.every(i => {
      const p = path.join(L.SITO, i.src.replace(/^\//, ''));
      if (!fs.existsSync(p)) return false;
      const b = fs.readFileSync(p);
      return b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG';
    }), icone.map(i => i.src));
  }

  console.log('\n-- la pagina --');
  const html = leggi('index.html');
  // I riferimenti sono relativi: con /vita/app.js la pagina aperta da disco
  // (file://) cercherebbe nella radice del filesystem, ed e' cosi' che si
  // controlla una modifica senza deployare niente.
  check('lo script e\' linkato relativo', /<script src="\.\/app\.js"><\/script>/.test(html));
  check('il manifest pure', /<link[^>]+rel="manifest"[^>]+href="\.\/manifest\.webmanifest"/.test(html));
  check('ha il theme-color', /<meta[^>]+name="theme-color"[^>]+content="#07090b"/.test(html));
  check('iOS sa che e\' un\'app', /name="apple-mobile-web-app-capable"[^>]*content="yes"/.test(html));
  check('la barra di stato di iOS non lascia una fascia vuota',
    /apple-mobile-web-app-status-bar-style"[^>]*content="black-translucent"/.test(html));
  check('ha l\'icona di iOS', /<link[^>]+rel="apple-touch-icon"[^>]+href="\.\/img\/apple-touch-icon\.png"/.test(html)
    && fs.existsSync(path.join(VITA, 'img', 'apple-touch-icon.png')));
  // La CSP del sito non concede script-src 'unsafe-inline': uno <script> con
  // dentro del codice, o un onclick, qui non partirebbe mai.
  check('nessuno script inline nel markup', !/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/.test(html));
  check('nessun onclick nel markup', !/\son[a-z]+\s*=/.test(html));

  console.log('\n-- la luna: navigazione, non illustrazione --');
  // Come il sole di ALBA: i raggi sono bottoni veri, con la presa tonda
  // intorno all'icona, perche' un triangolo sottile col pollice non si prende.
  const raggi = html.match(/<g class="raggio" data-sezione="([a-z]+)"/g) || [];
  check('ci sono quattro raggi, uno per sezione', raggi.length === 4, raggi);
  check('e sono bottoni veri, raggiungibili con Tab',
    (html.match(/class="raggio"[^>]*tabindex="0"[^>]*role="button"/g) || []).length === 4);
  check('ognuno ha la presa tonda intorno all\'icona',
    (html.match(/class="presa"/g) || []).length === 4);
  check('il disco fa da schermo: dice dove stai per andare', /id="dScelta"/.test(html));
  check('e sotto c\'e\' il nome, che quindi non serve in cima',
    /class="dSotto"[^>]*>PIANO</.test(html) && !/class="marchio"/.test(html));
  check('niente barra in basso: la navigazione e\' la ghiera',
    !/class="barra"/.test(html) && !/id="nav-oggi"/.test(html));
  check('la ghiera vive anche parcheggiata',
    /#lunaApp\.parcheggiata/.test(html) && /touch-action:none/.test(html));

  console.log('\n-- gli header, sui due host --');
  const headers = fs.readFileSync(path.join(L.SITO, '_headers'), 'utf8');
  check('il worker di PIANO non invecchia in cache', /\/vita\/sw\.js\n\s+Cache-Control: no-cache/.test(headers));
  check('il suo manifest neanche', /\/vita\/manifest\.webmanifest\n\s+Cache-Control: no-cache/.test(headers));
  check('e viene servito col tipo giusto',
    /\/vita\/manifest\.webmanifest\n(\s+.+\n)*\s+Content-Type: application\/manifest\+json/.test(headers));

  const conf = JSON.parse(fs.readFileSync(path.join(L.RADICE, 'vercel.json'), 'utf8'));
  const regola = s => (conf.headers.find(h => h.source === s) || { headers: [] }).headers;
  check('su Vercel il worker di PIANO non invecchia',
    regola('/vita/sw.js').some(h => h.key === 'Cache-Control' && h.value === 'no-cache'));
  check('su Vercel il suo manifest ha il tipo giusto',
    regola('/vita/manifest.webmanifest').some(h => h.key === 'Content-Type' && h.value === 'application/manifest+json'));

  console.log('\n-- i due worker non si pestano i piedi --');
  const swAlba = fs.readFileSync(path.join(L.SITO, 'sw.js'), 'utf8');
  const swPiano = leggi('sw.js');
  check('ALBA lascia stare /vita', /url\.pathname\.startsWith\('\/vita'\)/.test(swAlba));
  check('ALBA cancella solo le cache di ALBA', /startsWith\('alba-'\)/.test(swAlba));
  check('PIANO cancella solo le cache di PIANO', /startsWith\('piano-'\)/.test(swPiano));
  check('PIANO non esce da /vita/', /!url\.pathname\.startsWith\('\/vita\/'\)/.test(swPiano));
  check('solo le GET passano dal worker di PIANO', /req\.method !== 'GET'/.test(swPiano));
  check('il suo guscio contiene la pagina e lo script',
    /'\.\/index\.html'/.test(swPiano) && /'\.\/app\.js'/.test(swPiano));

  /* ============ IL BROWSER ============ */
  const server = await L.serviSito(8912);
  const browser = await chromium.launch({ executablePath: L.chromium(), args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true
  });
  const page = await context.newPage();
  const errori = [];
  page.on('pageerror', e => errori.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errori.push('console: ' + m.text()); });

  const BASE = 'http://127.0.0.1:8912';
  await page.goto(BASE + '/vita/', { waitUntil: 'load' });

  const sezioneAperta = () => page.evaluate(() => (document.querySelector('.sez.on') || {}).id);
  const parcheggiata = () => page.evaluate(() => document.getElementById('lunaApp').classList.contains('parcheggiata'));
  const disco = () => page.textContent('#dScelta');
  const ETICHETTA = { casa: '', oggi: 'OGGI', ritmo: 'RITMO', settimana: 'SETTIMANA', calma: 'CALMA' };

  // Come ci si arriva davvero: si gira la ghiera fino al nome giusto, e da
  // casa si preme al centro per entrare. Da parcheggiata lo scatto e' gia' il
  // cambio di sezione, quindi non c'e' niente da premere.
  const vaiA = async (nome) => {
    await page.locator('.lunaNav').focus();
    for (let i = 0; i < 4 && (await disco()) !== ETICHETTA[nome]; i++) {
      await page.keyboard.press('ArrowRight');
    }
    if (!(await parcheggiata())) await page.keyboard.press('Enter');
    await page.waitForTimeout(80);
  };

  console.log('\n-- si apre sulla luna --');
  check('la pagina si apre sulla casa', (await sezioneAperta()) === 'sez-casa');
  check('la luna e\' al centro, non parcheggiata', (await parcheggiata()) === false);
  // La classe la rimette lo script a ogni avvio: nella copia pubblicata come
  // Artifact il <body> lo scrive il visualizzatore, e senza classe la ghiera
  // non prenderebbe i tocchi.
  check('e la casa se la mette lo script, non solo il markup',
    /classList\.toggle\('casa'/.test(fs.readFileSync(path.join(VITA, 'app.js'), 'utf8'))
    && await page.evaluate(() => document.body.classList.contains('casa')));
  check('il disco dice cosa stai per aprire', (await disco()) === 'OGGI');
  check('e sotto c\'e\' una riga su come sta andando la giornata',
    /tre cose/i.test(await page.textContent('#casaRiga')));
  check('il saluto non e\' vuoto', (await page.locator('#saluto').textContent()).trim().length > 2);

  console.log('\n-- la ghiera --');
  // Un raggio si tocca e si apre: e' la strada corta, quella di sempre.
  await page.click('.raggio[data-sezione="ritmo"] .lama');
  await page.waitForTimeout(120);
  check('toccando un raggio si apre la sua sezione', (await sezioneAperta()) === 'sez-ritmo');
  check('e la luna va a posarsi sotto al contenuto', (await parcheggiata()) === true);
  check('il disco adesso dice dove sei', (await disco()) === 'RITMO');
  // Il contenuto le lascia il posto: senza, l'ultima riga finirebbe sotto la
  // luna e non si potrebbe piu' toccare.
  check('il contenuto le lascia lo spazio sotto',
    await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.shell')).paddingBottom) > 150));

  // Da parcheggiata il giro CAMBIA sezione mentre lo fai: e' la differenza fra
  // un menu da confermare e una manopola.
  await page.locator('.lunaNav').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(80);
  check('uno scatto da parcheggiata cambia sezione', (await sezioneAperta()) === 'sez-settimana');
  check('e il disco lo segue', (await disco()) === 'SETTIMANA');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(80);
  check('e si torna indietro girando dall\'altra parte', (await sezioneAperta()) === 'sez-ritmo');

  // Premere al centro da parcheggiata riporta alla luna intera.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  check('premendo al centro si torna a scegliere', (await sezioneAperta()) === 'sez-casa');
  check('e la luna risale', (await parcheggiata()) === false);
  // Da casa il giro sceglie e basta: non apre niente finche' non premi. La
  // ghiera riparte da dov'era - eravamo sul ritmo, uno scatto porta alla
  // settimana - perche' tornare a scegliere non vuol dire ricominciare.
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(60);
  check('da casa il giro sceglie e non apre', (await sezioneAperta()) === 'sez-casa',
    await sezioneAperta());
  check('e riparte da dov\'eri rimasto', (await disco()) === 'SETTIMANA', await disco());
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  check('Invio apre quello che il disco mostra', (await sezioneAperta()) === 'sez-settimana');

  // L'ombra del morso e i decori sono disegnati sopra i raggi: se prendessero
  // i tocchi, il dito che tocca OGGI aprirebbe quello che il disco mostra.
  // (Il fuoco torna sulla ghiera: toccando un raggio se l'era preso lui, e
  // Invio li' dentro vuol dire "apri", non "torna".)
  await page.locator('.lunaNav').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  await page.click('.raggio[data-sezione="oggi"] .lama');
  await page.waitForTimeout(120);
  check('l\'ombra sul disco non ruba il tocco al raggio sotto',
    (await sezioneAperta()) === 'sez-oggi', await sezioneAperta());

  // La rotella del mouse fa lo stesso lavoro del dito: da oggi, uno scatto in
  // avanti porta al ritmo.
  const centroLuna = await page.evaluate(() => {
    const r = document.getElementById('lunaApp').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(centroLuna.x, centroLuna.y);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(80);
  check('anche la rotella gira la ghiera', (await sezioneAperta()) === 'sez-ritmo',
    await sezioneAperta());

  console.log('\n-- il dito vero --');
  // Il telefono non e' un mouse piccolo: il click che il browser sintetizza
  // dopo un tocco a volte non arriva, e col solo mouse quel buco non si vede.
  const cdp = await context.newCDPSession(page);
  const dito = async (punti) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: punti[0][0], y: punti[0][1] }] });
    for (const p of punti.slice(1)) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p[0], y: p[1] }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const giroDelDito = async (daGradi, aGradi, passo) => {
    const c = await page.evaluate(() => {
      const r = document.getElementById('lunaApp').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, raggio: r.width * 0.36 };
    });
    const punti = [];
    for (let g = daGradi; passo > 0 ? g <= aGradi : g >= aGradi; g += passo) {
      const a = g * Math.PI / 180;
      punti.push([c.x + c.raggio * Math.cos(a), c.y + c.raggio * Math.sin(a)]);
    }
    await dito(punti);
    await page.waitForTimeout(120);
  };

  const primaDelGiro = await sezioneAperta();
  await giroDelDito(-90, 0, 9);   // un quarto di giro in senso orario
  check('il dito che gira fa scattare la ghiera', (await sezioneAperta()) !== primaDelGiro,
    [primaDelGiro, await sezioneAperta()]);
  // Il rilascio del dito genera comunque un click: se contasse come tocco, la
  // fine di ogni giro riporterebbe alla casa.
  check('e il rilascio a fine giro non e\' un tocco', (await parcheggiata()) === true);

  // Un tocco secco al centro invece si': ed e' quello che riporta a scegliere.
  const centro = await page.evaluate(() => {
    const r = document.getElementById('lunaApp').getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  });
  await dito([centro]);
  await page.waitForTimeout(150);
  check('il tocco secco al centro riporta alla luna intera', (await sezioneAperta()) === 'sez-casa');

  console.log('\n-- le tre cose --');
  await vaiA('oggi');
  check('siamo su oggi', (await sezioneAperta()) === 'sez-oggi');
  check('parte senza niente scritto', (await page.locator('#listaTre .cosa').count()) === 0);
  check('e lo dice con parole, non con uno zero',
    /tre cose/i.test(await page.textContent('#statoTre')));
  // Tre caselle vuote disegnate: e' il limite reso visibile prima ancora di
  // scrivere qualcosa.
  check('le tre caselle si vedono da subito', (await page.locator('#slotLiberi .slot').count()) === 3);

  const aggiungi = async (testo) => {
    await page.fill('#nuovaCosa', testo);
    await page.click('#btnAggiungi');
  };
  await aggiungi('portare il cane');
  check('la cosa scritta compare', (await page.locator('#listaTre .cosa').count()) === 1);
  check('il campo si svuota da solo', (await page.inputValue('#nuovaCosa')) === '');
  check('e resta una casella in meno', (await page.locator('#slotLiberi .slot').count()) === 2);

  await page.click('#momenti .chip[data-arg="sera"]');
  await aggiungi('chiamare mamma');
  check('il momento scelto resta appiccicato alla cosa',
    (await page.locator('#listaTre .cosa').nth(1).locator('.tag').textContent()) === 'sera');

  await aggiungi('lavatrice');
  check('tre cose stanno nelle tre', (await page.locator('#listaTre .cosa').count()) === 3);
  check('e non c\'e\' piu\' nessuna casella libera', (await page.locator('#slotLiberi .slot').count()) === 0);

  // La quarta non viene rifiutata: scivola in "se avanza". Dire di no sarebbe
  // rigido, e chi la scrive la vuole scritta da qualche parte.
  await aggiungi('rispondere a Luca');
  check('la quarta non entra tra le tre', (await page.locator('#listaTre .cosa').count()) === 3);
  check('ma non si perde: finisce in "se avanza"',
    (await page.locator('#listaExtra .cosa').count()) === 1);

  console.log('\n-- spuntare --');
  await page.click('#listaTre .cosa >> nth=0 >> .segno');
  check('la cosa spuntata si segna',
    await page.locator('#listaTre .cosa').nth(0).evaluate(el => el.classList.contains('fatta')));
  check('e lo dice anche a chi non vede lo schermo',
    (await page.locator('#listaTre .cosa').nth(0).locator('.segno').getAttribute('aria-checked')) === 'true');
  check('il testo di stato cambia tono',
    /fatta/i.test(await page.textContent('#statoTre')));

  console.log('\n-- quello che scrivi resta --');
  await page.reload({ waitUntil: 'load' });
  check('dopo il ricaricamento si riparte dalla luna', (await sezioneAperta()) === 'sez-casa');
  check('e la casa lo sa gia\' com\'e\' andata',
    /1 su 3|una fatta/i.test(await page.textContent('#casaRiga')), await page.textContent('#casaRiga'));
  await vaiA('oggi');
  check('le cose ci sono ancora', (await page.locator('#listaTre .cosa').count()) === 3);
  check('e quella spuntata e\' ancora spuntata',
    await page.locator('#listaTre .cosa').nth(0).evaluate(el => el.classList.contains('fatta')));

  console.log('\n-- portare su, rimandare --');
  check('senza posto non si puo\' portare su',
    (await page.locator('#listaExtra [data-az="portaSu"]').count()) === 0);
  await page.click('#listaTre .cosa >> nth=2 >> [data-az="togli"]');
  check('liberato un posto, il bottone compare',
    (await page.locator('#listaExtra [data-az="portaSu"]').count()) === 1);
  await page.click('#listaExtra [data-az="portaSu"]');
  check('e la cosa sale tra le tre', (await page.locator('#listaTre .cosa').count()) === 3
    && (await page.locator('#listaExtra .cosa').count()) === 0);

  const domani = await page.evaluate(() => piu(oggi(), 1));
  await page.click('#listaTre .cosa >> nth=1 >> [data-az="rimanda"]');
  check('rimandare toglie la cosa da oggi', (await page.locator('#listaTre .cosa').count()) === 2);
  check('e la mette a domani',
    await page.evaluate(g => S.cose.some(c => c.giorno === g && c.testo === 'chiamare mamma'), domani));

  console.log('\n-- la settimana --');
  await vaiA('settimana');
  check('la settimana ha sette giorni', (await page.locator('#grigliaSettimana .gio').count()) === 7);
  check('oggi e\' segnato', (await page.locator('#grigliaSettimana .gio.oggi').count()) === 1);
  check('i pallini raccontano le cose del giorno',
    (await page.locator('#grigliaSettimana .gio.oggi .gp i').count()) === 2);

  // Di domenica "domani" e' gia' la settimana dopo: si gira pagina prima di
  // cercarlo, che e' esattamente quello che farebbe una persona.
  if (!(await page.locator(`#grigliaSettimana .gio[data-arg="${domani}"]`).count())) {
    await page.click('[data-az="settimana"][data-arg="1"]');
    check('la settimana dopo si puo\' guardare',
      (await page.locator(`#grigliaSettimana .gio[data-arg="${domani}"]`).count()) === 1);
  }
  await page.click(`#grigliaSettimana .gio[data-arg="${domani}"]`);
  await page.waitForTimeout(120);
  check('toccando un giorno si torna alla lista di quel giorno',
    (await sezioneAperta()) === 'sez-oggi');
  // Ci si e' arrivati da un bottone, non dalla ghiera: il disco deve seguire,
  // o annuncerebbe una sezione che non e' quella aperta.
  check('e la ghiera segue chi la scavalca', (await disco()) === 'OGGI');
  check('si vede che non e\' oggi',
    /domani/.test(await page.textContent('#bannerGiorno')));
  check('c\'e\' la cosa rimandata', (await page.locator('#listaTre .cosa').count()) === 1);
  // Guardando un altro giorno, "domani" non ha senso: sposterebbe le cose
  // sempre piu' avanti senza che si capisca dove.
  check('da un altro giorno non si rimanda', (await page.locator('#listaTre [data-az="rimanda"]').count()) === 0);
  await page.click('#bannerGiorno [data-az="tornaOggi"]');
  check('e si torna a oggi', await page.locator('#bannerGiorno').isHidden());

  console.log('\n-- il ritmo --');
  await vaiA('ritmo');
  check('senza abitudini non e\' una lista vuota, e\' un invito',
    /una sola/i.test(await page.textContent('#listaAbitudini')));
  await page.fill('#nuovaAbitudine', 'camminare');
  await page.click('#emoji .chip[data-arg="🚶"]');
  await page.click('#btnAbitudine');
  check('l\'abitudine compare', (await page.locator('#listaAbitudini .ab').count()) === 1);
  check('col suo simbolo', (await page.locator('#listaAbitudini .tondo').textContent()) === '🚶');
  check('e non e\' un rimprovero: "quando vuoi"',
    /quando vuoi/.test(await page.textContent('#listaAbitudini')));

  await page.click('#listaAbitudini .tondo');
  check('segnata oggi, si vede', await page.locator('#listaAbitudini .ab').evaluate(el => el.classList.contains('oggi')));
  check('e la fila comincia', /primo giorno/.test(await page.textContent('#listaAbitudini')));
  check('sette pallini, una settimana', (await page.locator('#listaAbitudini .punti .p').count()) === 7);
  await page.click('#listaAbitudini .tondo');
  check('e si puo\' togliere il segno', (await page.locator('#listaAbitudini .ab.oggi').count()) === 0);

  console.log('\n-- la fila non si rompe per un giorno --');
  // La regola scritta a mano, senza passare dall'interfaccia: e' quella che
  // distingue un'abitudine da un obbligo.
  const filaCon = giorni => page.evaluate(gg => fila({ giorni: gg }), giorni);
  const g = n => page.evaluate(k => piu(oggi(), k), n);
  const [o, i1, i2, i3, i4] = await Promise.all([g(0), g(-1), g(-2), g(-3), g(-4)]);

  check('tre giorni di fila fanno tre', (await filaCon([o, i1, i2])) === 3);
  check('oggi non ancora segnato non azzera ieri', (await filaCon([i1, i2, i3])) === 3);
  check('un giorno saltato non rompe niente', (await filaCon([o, i1, i3, i4])) === 4);
  check('due saltati di fila si\'', (await filaCon([o, i3, i4])) === 1);
  check('e senza niente la fila e\' zero', (await filaCon([])) === 0);

  console.log('\n-- la calma --');
  await vaiA('calma');
  await page.click('#scalaEnergia .liv[data-arg="4"]');
  check('l\'energia scelta resta premuta',
    (await page.locator('#scalaEnergia .liv[data-arg="4"]').getAttribute('aria-pressed')) === 'true');
  check('e la striscia ha quattordici giorni', (await page.locator('#strisciaUmore div').count()) === 14);
  await page.fill('#notaGiorno', 'giornata storta ma ok');
  await page.waitForTimeout(700);
  check('la nota si salva da sola, senza bottoni',
    await page.evaluate(k => (S.giornate[oggi()] || {}).nota === k, 'giornata storta ma ok'));
  // Toccare di nuovo lo stesso viso lo toglie: segnarsi per sbaglio e non
  // poter tornare indietro e' il modo piu' veloce di smettere di segnarsi.
  await page.click('#scalaEnergia .liv[data-arg="4"]');
  check('e si puo\' disdire', (await page.locator('#scalaEnergia .liv[data-arg="4"]').getAttribute('aria-pressed')) === 'false');

  await page.click('#btnRespira');
  await page.waitForTimeout(120);
  check('il respiro comincia dall\'inspirare',
    (await page.locator('#bolla').textContent()) === 'inspira');
  check('e la bolla si allarga', await page.locator('#bolla').evaluate(el => el.classList.contains('dentro')));
  await page.click('#btnRespira');
  check('e si puo\' smettere quando si vuole', (await page.locator('#bolla').textContent()) === 'inizia');

  console.log('\n-- la copia dei dati --');
  await page.click('[data-az="mostraCopia"]');
  const copia = await page.inputValue('#copiaDati');
  check('la copia e\' JSON leggibile', (() => { try { return Array.isArray(JSON.parse(copia).cose); } catch (e) { return false; } })());
  await page.fill('#copiaDati', '{non sono json}');
  await page.click('[data-az="ripristina"]');
  check('una copia rotta non cancella niente',
    /non si legge/.test(await page.textContent('#esitoDati'))
    && (await page.evaluate(() => S.cose.length)) > 0);
  await page.fill('#copiaDati', JSON.stringify({ v: 1, cose: [{ id: 'x', testo: 'ripreso da una copia', giorno: o, fatta: false }], abitudini: [], giornate: {} }));
  await page.click('[data-az="ripristina"]');
  await vaiA('oggi');
  check('una copia buona rientra',
    (await page.locator('#listaTre .cosa .testo').first().textContent()) === 'ripreso da una copia');

  console.log('\n-- senza rete --');
  const registrato = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return !!(r && (r.active || r.installing || r.waiting));
  }).catch(() => false);
  check('il service worker si registra', registrato);
  check('e prende in carico la pagina aperta', await page.evaluate(() => !!navigator.serviceWorker.controller));
  check('col raggio d\'azione su /vita/',
    await page.evaluate(async () => (await navigator.serviceWorker.ready).scope.endsWith('/vita/')));

  await context.setOffline(true);
  let offlineOk = true;
  try { await page.goto(BASE + '/vita/', { waitUntil: 'load' }); } catch (e) { offlineOk = false; }
  check('senza rete l\'app si apre lo stesso', offlineOk && (await page.locator('#lunaApp').count()) > 0);
  check('e anche lo script c\'e\'', offlineOk && await page.evaluate(() => typeof fila === 'function'));
  if (offlineOk) await vaiA('oggi');
  check('con dentro quello che avevi scritto',
    offlineOk && (await page.locator('#listaTre .cosa').count()) === 1);
  await context.setOffline(false);

  console.log('\n-- e ALBA e\' ancora ALBA --');
  // La prova che i due worker convivono: dopo aver installato PIANO, la
  // radice deve aprire il sole - online e, soprattutto, offline.
  const albaPage = await context.newPage();
  await L.senzaGuida(albaPage);
  await albaPage.goto(BASE + '/', { waitUntil: 'load' });
  check('la radice apre ALBA', (await albaPage.locator('#soleApp').count()) > 0);
  await albaPage.evaluate(() => navigator.serviceWorker.ready);
  await albaPage.waitForTimeout(400);
  await context.setOffline(true);
  let albaOffline = true;
  try { await albaPage.goto(BASE + '/', { waitUntil: 'load' }); } catch (e) { albaOffline = false; }
  check('e offline apre ancora il sole, non PIANO',
    albaOffline && (await albaPage.locator('#soleApp').count()) > 0);
  await context.setOffline(false);

  check('nessun errore in pagina', errori.length === 0, errori.slice(0, 3));

  await browser.close();
  server.close();
  fine();
})();
