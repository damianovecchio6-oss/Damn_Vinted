// PIANO, l'app della giornata che sta sotto /vita/. Le domande sono tre:
// quello che scrivi resta, le regole "chill" sono davvero quelle scritte nel
// codice (tre cose e non di piu', un giorno saltato non rompe la fila), e le
// due app sullo stesso dominio non si pestano i piedi.
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
  check('la barra in basso e\' navigazione vera (tab e pannelli)',
    /role="tablist"/.test(html) && (html.match(/role="tabpanel"/g) || []).length === 4);

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
  // Senza questa riga la pagina di PIANO passerebbe dal ramo "navigate" di
  // ALBA e finirebbe salvata come suo index.html: offline, al posto del sole,
  // si aprirebbe l'altra app.
  check('ALBA lascia stare /vita', /url\.pathname\.startsWith\('\/vita'\)/.test(swAlba));
  // E la pulizia delle cache vecchie deve guardare solo le proprie: ALBA
  // cancellava tutto quello che non si chiamava come lei, cache di PIANO
  // compresa, a ogni attivazione.
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

  console.log('\n-- si apre --');
  check('la pagina si apre sull\'oggi', await page.locator('#sez-oggi').evaluate(el => el.classList.contains('on')));
  check('e il saluto non e\' vuoto', (await page.locator('#saluto').textContent()).trim().length > 2);
  check('parte senza niente scritto', (await page.locator('#listaTre .cosa').count()) === 0);
  check('e lo dice con parole, non con uno zero',
    /tre cose/i.test(await page.locator('#statoTre').textContent()));
  // Tre caselle vuote disegnate: e' il limite reso visibile prima ancora di
  // scrivere qualcosa.
  check('le tre caselle si vedono da subito', (await page.locator('#slotLiberi .slot').count()) === 3);

  console.log('\n-- le tre cose --');
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
    /fatta/i.test(await page.locator('#statoTre').textContent()));

  console.log('\n-- quello che scrivi resta --');
  await page.reload({ waitUntil: 'load' });
  check('dopo il ricaricamento le cose ci sono ancora',
    (await page.locator('#listaTre .cosa').count()) === 3);
  check('e quella spuntata e\' ancora spuntata',
    await page.locator('#listaTre .cosa').nth(0).evaluate(el => el.classList.contains('fatta')));

  console.log('\n-- portare su, rimandare --');
  // Tolta una delle tre, la cosa in "se avanza" puo' salire: il bottone
  // compare solo quando c'e' posto.
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
  await page.click('#nav-settimana');
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
  check('toccando un giorno si torna alla lista di quel giorno',
    await page.locator('#sez-oggi').evaluate(el => el.classList.contains('on')));
  check('e si vede che non e\' oggi',
    /domani/.test(await page.locator('#bannerGiorno').textContent()));
  check('c\'e\' la cosa rimandata', (await page.locator('#listaTre .cosa').count()) === 1);
  // Guardando un altro giorno, "domani" non ha senso: sposterebbe le cose
  // sempre piu' avanti senza che si capisca dove.
  check('da un altro giorno non si rimanda', (await page.locator('#listaTre [data-az="rimanda"]').count()) === 0);
  await page.click('#bannerGiorno [data-az="tornaOggi"]');
  check('e si torna a oggi', await page.locator('#bannerGiorno').isHidden());

  console.log('\n-- il ritmo --');
  await page.click('#nav-ritmo');
  check('senza abitudini non e\' una lista vuota, e\' un invito',
    /una sola/i.test(await page.locator('#listaAbitudini').textContent()));
  await page.fill('#nuovaAbitudine', 'camminare');
  await page.click('#emoji .chip[data-arg="🚶"]');
  await page.click('#btnAbitudine');
  check('l\'abitudine compare', (await page.locator('#listaAbitudini .ab').count()) === 1);
  check('col suo simbolo', (await page.locator('#listaAbitudini .tondo').textContent()) === '🚶');
  check('e non e\' un rimprovero: "quando vuoi"',
    /quando vuoi/.test(await page.locator('#listaAbitudini .abFila').textContent()));

  await page.click('#listaAbitudini .tondo');
  check('segnata oggi, si vede', await page.locator('#listaAbitudini .ab').evaluate(el => el.classList.contains('oggi')));
  check('e la fila comincia', /primo giorno/.test(await page.locator('#listaAbitudini .abFila').textContent()));
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
  await page.click('#nav-calma');
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
    /non si legge/.test(await page.locator('#esitoDati').textContent())
    && (await page.evaluate(() => S.cose.length)) > 0);
  await page.fill('#copiaDati', JSON.stringify({ v: 1, cose: [{ id: 'x', testo: 'ripreso da una copia', giorno: new Date().toISOString().slice(0, 10), fatta: false }], abitudini: [], giornate: {} }));
  await page.click('[data-az="ripristina"]');
  await page.click('#nav-oggi');
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
  check('senza rete l\'app si apre lo stesso', offlineOk && (await page.locator('#sez-oggi').count()) > 0);
  check('e anche lo script c\'e\'', offlineOk && await page.evaluate(() => typeof fila === 'function'));
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
