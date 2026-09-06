#!/usr/bin/env node
// Ridisegna le icone di PIANO, l'app che sta sotto /vita/. Come per ALBA non
// gira ne' in CI ne' al deploy: i PNG stanno nel repo gia' fatti, e questo
// script serve solo quando cambia il disegno.
//
//   node scripts/icone-piano.js
//
// Il glifo e' la luna con qualche raggio - la stessa mano del sole di ALBA,
// ma la luce di dopo - e il verde salvia e' il colore dell'app.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const L = require('../tests/lib');

const IMG = path.join(L.SITO, 'vita', 'img');
const luna = fs.readFileSync(path.join(IMG, 'luna.svg'), 'utf8')
  .replace('fill="currentColor"', 'fill="url(#salvia)"')
  .replace('<svg', '<svg style="width:100%;height:100%"')
  .replace('>', `><defs><linearGradient id="salvia" x1="0" y1="0" x2="0.42" y2="1">
      <stop offset="0" stop-color="#e2f5ec"/><stop offset="0.36" stop-color="#b8e4d1"/>
      <stop offset="0.64" stop-color="#a9dcc8"/><stop offset="1" stop-color="#79b3a0"/>
    </linearGradient></defs>`);

// scala: quanto del quadrato occupa il glifo. Piena per le icone normali,
// ridotta per la maskable, che deve sopravvivere al ritaglio circolare di
// Android.
const PEZZI = [
  ['icona-192.png', 192, 0.84],
  ['icona-512.png', 512, 0.84],
  ['icona-maskable.png', 512, 0.56],
  ['apple-touch-icon.png', 180, 0.78]
];

(async () => {
  const browser = await chromium.launch({ executablePath: L.chromium(), args: ['--no-sandbox'] });
  for (const [nome, lato, scala] of PEZZI) {
    const page = await browser.newPage({ viewport: { width: lato, height: lato }, deviceScaleFactor: 1 });
    await page.setContent(`<style>
      html,body{margin:0;width:${lato}px;height:${lato}px;background:#0b0f10;display:grid;place-items:center}
      .s{width:${Math.round(lato * scala)}px;height:${Math.round(lato * scala)}px}
    </style><div class="s">${luna}</div>`);
    await page.screenshot({ path: path.join(IMG, nome), type: 'png' });
    await page.close();
    console.log('  ' + nome + '  ' + lato + '×' + lato);
  }
  await browser.close();
})();
