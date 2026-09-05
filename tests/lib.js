// Utilita' comuni ai test: dove sta il sito, dove sta Chromium, e un server
// statico usa e getta per servire la pagina al browser.
const fs = require('fs');
const http = require('http');
const path = require('path');

const RADICE = path.join(__dirname, '..');
const SITO = path.join(RADICE, 'public');
const FUNCTIONS = path.join(RADICE, 'netlify', 'functions');

// playwright-core non si porta dietro i browser: va detto dove sono.
// CHROMIUM_PATH ha la precedenza, altrimenti si cerca dove li mette Playwright.
function chromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;

  const basi = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers',
                path.join(process.env.HOME || '', '.cache', 'ms-playwright')].filter(Boolean);
  // Il percorso dentro la cartella cambia con la versione di Playwright: le
  // build vecchie mettono chrome-linux/chrome, quelle nuove (Chrome for
  // Testing) chrome-linux64/chrome. Cercarne uno solo faceva fallire i test
  // sui runner di GitHub, dove il browser c'era ma in un'altra cartella.
  const percorsi = [
    'chrome-linux/chrome',
    'chrome-linux64/chrome',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
  ];
  const guardato = [];
  for (const base of basi) {
    let voci = [];
    try { voci = fs.readdirSync(base); } catch { continue; }
    guardato.push(base);
    for (const v of voci.filter(v => v.startsWith('chromium-')).sort().reverse()) {
      for (const rel of percorsi) {
        const p = path.join(base, v, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  throw new Error('Chromium non trovato. Imposta CHROMIUM_PATH, oppure PLAYWRIGHT_BROWSERS_PATH '
    + 'alla cartella dei browser.' + (guardato.length ? ' Ho guardato in: ' + guardato.join(', ') : ''));
}

function serviSito(porta) {
  const server = http.createServer((req, res) => {
    const richiesto = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const completo = path.join(SITO, richiesto);
    if (!completo.startsWith(SITO) || !fs.existsSync(completo)) { res.writeHead(404); return res.end('no'); }
    // Il tipo giusto per i .js non e' pignoleria: servito come text/plain, uno
    // <script src> viene rifiutato dal browser appena c'e' un nosniff di mezzo,
    // e in produzione public/_headers il nosniff ce l'ha. Meglio che la suite
    // giri nelle stesse condizioni del sito vero.
    const tipo = richiesto.endsWith('.html') ? 'text/html'
      : richiesto.endsWith('.js') ? 'text/javascript'
      : richiesto.endsWith('.css') ? 'text/css'
      : richiesto.endsWith('.svg') ? 'image/svg+xml'
      : 'text/plain';
    res.writeHead(200, { 'Content-Type': tipo });
    res.end(fs.readFileSync(completo));
  });
  return new Promise(r => server.listen(porta, () => r(server)));
}

// La guida si apre da sola alla prima visita, e da sola coprirebbe la pagina
// all'inizio di ogni suite: qui si dice al browser che l'utente l'ha gia'
// vista, prima ancora che la pagina parta. Va chiamata prima della goto. Chi
// la guida la sta provando davvero - tests/guida.js - questa non la chiama.
function senzaGuida(pagina) {
  return pagina.addInitScript(() => {
    try { localStorage.setItem('albaGuidaVista', '1'); } catch (e) {}
  });
}

function funzione(nome) {
  return path.join(FUNCTIONS, nome);
}

// Contatore condiviso: ogni suite stampa le proprie righe e il totale finale.
function contatore() {
  const stato = { pass: 0, fail: 0 };
  stato.check = (nome, cond, extra) => {
    if (cond) { stato.pass++; console.log(`  ok   ${nome}`); }
    else { stato.fail++; console.log(`  FAIL ${nome}${extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''}`); }
  };
  stato.fine = () => {
    console.log(`\n${stato.pass} passati, ${stato.fail} falliti`);
    process.exit(stato.fail ? 1 : 0);
  };
  return stato;
}

module.exports = { RADICE, SITO, FUNCTIONS, chromium, serviSito, senzaGuida, funzione, contatore };
