// L'app: manifest, icone, service worker. La domanda a cui questa suite
// risponde e' una sola - se il telefono la installa in home, quello che si
// apre e' un'applicazione o una pagina web travestita?
//
// Meta' dei controlli sono sui file (il manifest e' valido, le icone
// esistono davvero, gli header non lasciano invecchiare il worker) e meta'
// sul browser vero: si registra il worker, si stacca la rete e si ricarica.
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const { chromium } = require('playwright-core');
const { check, fine } = L.contatore();

const leggi = f => fs.readFileSync(path.join(L.SITO, f), 'utf8');

(async () => {
  /* ===== IL MANIFEST ===== */
  let man = null;
  try { man = JSON.parse(leggi('manifest.webmanifest')); } catch (e) { man = null; }
  check('il manifest e\' JSON valido', !!man);

  if (man) {
    check('ha nome e nome corto', man.name && man.short_name, [man.name, man.short_name]);
    // Senza standalone il telefono apre l'icona dentro il browser, con la
    // barra dell'indirizzo in cima: e' il segno piu' visibile che non e' un'app.
    check('si apre a schermo intero (standalone)', man.display === 'standalone', man.display);
    check('parte dalla radice e la copre tutta', man.start_url === '/' && man.scope === '/', [man.start_url, man.scope]);
    // Il colore di fondo e' quello che si vede nella frazione di secondo tra
    // l'icona e la pagina: se e' bianco, l'app "lampeggia" a ogni apertura.
    check('fondo e tema sono il nero della pagina',
      man.background_color === '#08080a' && man.theme_color === '#08080a',
      [man.background_color, man.theme_color]);

    const icone = man.icons || [];
    const misura = m => icone.find(i => i.sizes === m + 'x' + m && (i.purpose || 'any').includes('any'));
    check('c\'e\' l\'icona 192', !!misura(192));
    check('c\'e\' l\'icona 512', !!misura(512));
    // Android ritaglia l'icona nella forma del launcher: senza una maskable
    // taglia i raggi del sole, o la incolla dentro un quadrato bianco.
    check('c\'e\' una maskable per il ritaglio di Android',
      icone.some(i => (i.purpose || '').includes('maskable')));
    check('tutte le icone del manifest esistono davvero',
      icone.every(i => fs.existsSync(path.join(L.SITO, i.src.replace(/^\//, '')))),
      icone.map(i => i.src));
    // Le icone dichiarate PNG devono esserlo: bastano i primi byte.
    check('le icone sono PNG veri', icone.every(i => {
      const b = fs.readFileSync(path.join(L.SITO, i.src.replace(/^\//, '')));
      return b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG';
    }));
    check('le scorciatoie puntano a schede che esistono',
      (man.shortcuts || []).every(s => /^\/\?vai=(foto|annuncio|prezzo|ricerca|storico|scanner)$/.test(s.url)),
      (man.shortcuts || []).map(s => s.url));
  }

  /* ===== LA PAGINA ===== */
  const html = leggi('index.html');
  check('la pagina dichiara il manifest', /<link[^>]+rel="manifest"[^>]+href="\/manifest\.webmanifest"/.test(html));
  check('ha il theme-color', /<meta[^>]+name="theme-color"[^>]+content="#08080a"/.test(html));
  check('ha l\'icona di iOS', /<link[^>]+rel="apple-touch-icon"/.test(html)
    && fs.existsSync(path.join(L.SITO, 'img', 'apple-touch-icon.png')));
  // iOS il manifest lo legge a meta': senza queste, l'icona in home riapre
  // Safari con la sua barra invece dell'app.
  check('iOS sa che e\' un\'app', /name="apple-mobile-web-app-capable"[^>]*content="yes"/.test(html));
  check('la barra di stato di iOS non lascia una fascia vuota',
    /apple-mobile-web-app-status-bar-style"[^>]*content="black-translucent"/.test(html));

  /* ===== GLI HEADER ===== */
  const headers = leggi('_headers');
  check('il service worker non invecchia in cache', /\/sw\.js\n\s+Cache-Control: no-cache/.test(headers));
  check('il manifest non invecchia in cache', /\/manifest\.webmanifest\n\s+Cache-Control: no-cache/.test(headers));
  // La CSP e' la stessa di prima: il worker non ha portato permessi nuovi.
  // default-src 'self' copre gia' worker-src e manifest-src.
  const csp = (headers.match(/^\s*Content-Security-Policy:.*$/m) || [''])[0];
  check('la CSP non ha ripreso unsafe-inline per gli script',
    !!csp && !/script-src[^;]*unsafe-inline/.test(csp));

  /* ===== IL WORKER, LETTO ===== */
  const sw = leggi('sw.js');
  check('le function non finiscono mai in cache', /url\.pathname\.startsWith\('\/\.netlify\/'\)/.test(sw) && /return;/.test(sw));
  check('solo le GET passano dal worker', /req\.method !== 'GET'/.test(sw));
  check('il guscio contiene la pagina e lo script',
    /'\.\/index\.html'/.test(sw) && /'\.\/app\.js'/.test(sw));

  /* ===== IL WORKER, IN FUNZIONE ===== */
  const server = await L.serviSito(8907);
  const browser = await chromium.launch({ executablePath: L.chromium(), args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  await L.senzaGuida(page);

  await page.goto('http://127.0.0.1:8907/', { waitUntil: 'load' });

  // Il bottone "Installa" c'e' nel markup ma resta spento finche' il browser
  // non offre l'installazione: qui nessuno la offre, e infatti non si vede.
  check('il bottone Installa nasce nascosto',
    await page.locator('#installBtn').isHidden());

  const registrato = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return !!(r && (r.active || r.installing || r.waiting));
  }).catch(() => false);
  check('il service worker si registra', registrato);

  // Prende in carico la pagina: senza questo l'offline non funzionerebbe
  // finche' non ricarichi due volte.
  const controlla = await page.evaluate(() => !!navigator.serviceWorker.controller);
  check('prende in carico la pagina aperta', controlla);

  // La prova vera: si stacca la rete e si ricarica. Se il guscio e' in cache,
  // ALBA si apre lo stesso.
  await context.setOffline(true);
  let offlineOk = true;
  try {
    await page.goto('http://127.0.0.1:8907/', { waitUntil: 'load' });
  } catch (e) { offlineOk = false; }
  const soleOffline = offlineOk && await page.locator('#soleApp').count() > 0;
  const scriptOffline = offlineOk && await page.evaluate(() => typeof window.sw === 'function');
  check('senza rete la pagina si apre lo stesso', soleOffline);
  check('senza rete anche lo script c\'e\' (non solo il markup)', scriptOffline);

  // E le function no: una risposta AI di ieri servita dalla cache sarebbe
  // peggio di un errore onesto.
  const funzioneOffline = await page.evaluate(async () => {
    try { const r = await fetch('/.netlify/functions/claude'); return 'risposta ' + r.status; }
    catch (e) { return 'errore'; }
  });
  check('le function non vengono servite dalla cache', funzioneOffline === 'errore', funzioneOffline);

  await context.setOffline(false);

  /* ===== LE SCORCIATOIE DELL'ICONA ===== */
  await page.goto('http://127.0.0.1:8907/?vai=scanner', { waitUntil: 'load' });
  check('?vai=scanner apre lo scanner',
    await page.locator('#tab-scanner').evaluate(el => el.classList.contains('on')));

  // Un indirizzo scritto a caso non deve rompere niente: resta il sole.
  await page.goto('http://127.0.0.1:8907/?vai=inventata', { waitUntil: 'load' });
  check('un ?vai= inventato lascia il sole',
    await page.locator('#tab-sole').evaluate(el => el.classList.contains('on')));

  await browser.close();
  server.close();
  fine();
})();
