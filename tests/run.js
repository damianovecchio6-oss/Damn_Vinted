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
  ['Gemini assente', 'gemini-assente.js', 'senza chiave: si ripiega, e si dice perche'],
  ['Gemini a freddo', 'gemini-freddo.js', 'il catalogo non si mangia il budget delle foto'],
  ['riserva per il ripiego', 'gemini-riserva.js', 'Gemini pieno non si mangia il tempo di Groq'],
  ['Gemini lento', 'gemini-lento.js', 'la sua deadline non uccide la richiesta: ripiega'],
  ['ricerca immagine', 'lens.js', 'multipart SerpApi, prezzi, errori'],
  ['ricerca online', 'ricerca.js', 'query, prezzi negli snippet, cache, errori'],
  ['interfaccia', 'ui.js', 'accessibilita, doppio invio, storico'],
  ['la guida', 'guida.js', 'due finestre alla prima visita, e mai piu'],
  ['analisi foto', 'photo.js', 'codifica adattiva, miniatura, passaggio annuncio'],
  ['etichetta e Lens', 'nuove.js', 'lettura dedicata, merge, identificazione prodotto'],
  ['agente di ricerca', 'agente.js', 'piano, ricerche, raffinamento, rapporto'],
  ['scanner', 'scanner.js', 'identita e fonti, usato vs nuovo, giri, banda dei prezzi'],
  ['i conti sui prezzi', 'prezzi.js', 'quantile pesato, peso delle prove, casi limite, calibrazione'],
  ['profilo e confidenza', 'profilo.js', 'fiducia per campo, fonti, comparabili, punteggio del campione'],
  ['micro-interazioni', 'interazioni.js', 'ghiera, attesa, focus, vibrazione, motion'],
  ['dito sul telefono', 'tocco.js', 'tocchi veri: ghiera, tasto centrale, parcheggio'],
  ['app installabile', 'app.js', 'manifest, icone, service worker, offline'],
  ['porta su Vercel', 'vercel.js', 'adattatore, header uguali sui due host, origini'],
  ['codice di accesso', 'pin.js', 'la function lo pretende, la pagina lo chiede una volta'],
  ['mercato condiviso', 'mercato.js', 'cosa esce dal telefono, la banda, il tasto del codice'],
  ['account personale', 'account.js', 'login, reset password, storico sincronizzato, foto private']
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
