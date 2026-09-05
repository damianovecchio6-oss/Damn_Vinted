#!/usr/bin/env node
// Ridisegna le icone dell'app partendo dal sole del marchio. Non gira ne' in
// CI ne' al deploy: i PNG stanno nel repo gia' fatti. Serve solo quando il
// disegno cambia, ed e' qui perche' rifarle a mano in un editor significava
// non sapere piu' da dove venivano.
//
//   node scripts/icone.js
//
// Le due misure che contano sono 192 e 512 (Android), piu' una 512 "maskable"
// col sole rimpicciolito dentro il quadrato: Android ritaglia l'icona nella
// forma del launcher, e senza margine mangerebbe i raggi. La 180 e' quella che
// iOS mette in home.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const L = require('../tests/lib');

const IMG = path.join(L.SITO, 'img');
const sole = fs.readFileSync(path.join(IMG, 'sole.svg'), 'utf8')
  .replace('fill="currentColor"', 'fill="url(#oro)"')
  .replace('<svg', '<svg style="width:100%;height:100%"')
  .replace('>', `><defs><linearGradient id="oro" x1="0" y1="0" x2="0.45" y2="1">
      <stop offset="0" stop-color="#fbf1cd"/><stop offset="0.34" stop-color="#eed277"/>
      <stop offset="0.62" stop-color="#e8c84a"/><stop offset="1" stop-color="#bf9c31"/>
    </linearGradient></defs>`);

// scala: quanto del quadrato occupa il sole. Piena per le icone normali,
// ridotta per la maskable, che deve sopravvivere a un ritaglio circolare.
const PEZZI = [
  ['icona-192.png', 192, 0.86],
  ['icona-512.png', 512, 0.86],
  ['icona-maskable.png', 512, 0.58],
  ['apple-touch-icon.png', 180, 0.80]
];

(async () => {
  const browser = await chromium.launch({ executablePath: L.chromium(), args: ['--no-sandbox'] });
  for (const [nome, lato, scala] of PEZZI) {
    const page = await browser.newPage({ viewport: { width: lato, height: lato }, deviceScaleFactor: 1 });
    await page.setContent(`<style>
      html,body{margin:0;width:${lato}px;height:${lato}px;background:#0d0d10;display:grid;place-items:center}
      .s{width:${Math.round(lato * scala)}px;height:${Math.round(lato * scala)}px}
    </style><div class="s">${sole}</div>`);
    await page.screenshot({ path: path.join(IMG, nome), type: 'png' });
    await page.close();
    console.log('  ' + nome + '  ' + lato + '×' + lato);
  }
  await browser.close();
})();
