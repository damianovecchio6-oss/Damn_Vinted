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
    res.writeHead(200, { 'Content-Type': richiesto.endsWith('.html') ? 'text/html' : 'text/plain' });
    res.end(fs.readFileSync(completo));
  });
  return new Promise(r => server.listen(porta, () => r(server)));
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

module.exports = { RADICE, SITO, FUNCTIONS, chromium, serviSito, funzione, contatore };
