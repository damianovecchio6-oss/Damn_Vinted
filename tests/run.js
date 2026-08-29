#!/usr/bin/env node
// Esegue tutte le suite e riassume. Nessun framework: i test sono script che
// stampano "N passati, M falliti" ed escono con codice diverso da zero se
// qualcosa non torna.
const { spawnSync } = require('child_process');
const path = require('path');

const SUITE = [
  ['funzione base', 'fn.js', 'metodi, origine, token, validazione, rate limit'],
  ['modelli Groq', 'models.js', 'fallback, cache a scadenza, errori upstream'],
  ['modelli Gemini', 'gemini.js', 'scelta provider, formato richiesta, ripieghi'],
  ['ricerca immagine', 'lens.js', 'multipart SerpApi, prezzi, errori'],
  ['interfaccia', 'ui.js', 'accessibilita, doppio invio, storico'],
  ['analisi foto', 'photo.js', 'codifica adattiva, miniatura, passaggio annuncio'],
  ['etichetta e Lens', 'nuove.js', 'lettura dedicata, merge, identificazione prodotto']
];

let totale = 0, falliti = 0, suiteKo = [];
for (const [nome, file, cosa] of SUITE) {
  process.stdout.write(`\n### ${nome} — ${cosa}\n`);
  const r = spawnSync(process.execPath, [path.join(__dirname, file)], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const riga = (out.match(/^(\d+) passati, (\d+) falliti$/m) || []);
  const p = Number(riga[1] || 0), f = Number(riga[2] || 0);
  totale += p + f; falliti += f;

  if (r.status !== 0 || f > 0) {
    suiteKo.push(nome);
    process.stdout.write(out);
  } else {
    process.stdout.write(`  ${p} controlli, tutti verdi\n`);
  }
}

console.log('\n' + '-'.repeat(50));
console.log(`${totale} controlli, ${falliti} falliti`);
if (suiteKo.length) console.log(`Suite con problemi: ${suiteKo.join(', ')}`);
process.exit(falliti || suiteKo.length ? 1 : 0);
