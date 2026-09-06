#!/usr/bin/env node
// Prepara la copia di PIANO da pubblicare come Artifact su claude.ai - quella
// che si apre da un link, senza deployare il sito.
//
//   node scripts/artifact-piano.js [file-di-uscita]
//
// Esiste per un motivo solo: la copia pubblicata non deve essere un fork
// scritto a mano. Qui si parte sempre da public/vita/, cosi' quello che gira
// nel link e' lo stesso codice che passa dalla suite.
//
// Tre differenze, e sono tutte obbligate dal posto in cui finisce:
//   - l'involucro (<!doctype>, <head>, <body>) lo mette il visualizzatore: qui
//     si scrive solo il contenuto, quindi lo script va incorporato invece che
//     linkato;
//   - il service worker non c'e', perche' la pagina non e' servita da /vita/;
//   - in piu' c'e' il deposito: se il visualizzatore lo concede, lo stato va
//     anche li' e la stessa giornata si apre da telefono e da computer.
//     Il posto dove vive resta localStorage, e senza deposito non cambia
//     niente.
const fs = require('fs');
const path = require('path');

const VITA = path.join(__dirname, '..', 'public', 'vita');
const uscita = process.argv[2] || path.join(__dirname, '..', 'piano-artifact.html');

const html = fs.readFileSync(path.join(VITA, 'index.html'), 'utf8');
let app = fs.readFileSync(path.join(VITA, 'app.js'), 'utf8');

let stile = html.match(/<style>[\s\S]*?<\/style>/)[0];
let corpo = html.match(/<body>\n([\s\S]*?)\n<\/body>/)[1];

corpo = corpo.replace('\n<script src="./app.js"></script>', '');
// Senza color-scheme i controlli di sistema - cursore, selezione - restano
// chiari su un fondo nero.
stile = stile.replace(':root{', ':root{\n  color-scheme:dark;');

// Il testo sui dati deve dire la verita' anche qui: in questa copia una copia
// va anche nel deposito.
const vecchioTesto = `<p class="sub">Stanno solo qui dentro, in questo telefono. Non c'e' nessun account e niente esce
        da questa pagina - il che vuol dire anche che se cancelli i dati del browser se ne vanno.
        Questa e' la copia da tenere da parte.</p>`;
const nuovoTesto = `<p class="sub">Stanno su questo dispositivo, e - se claude.ai lo permette - anche nel tuo
        deposito privato: cosi' la stessa giornata si apre dal telefono e dal computer, e non se ne va
        se il browser fa pulizia. Nessun account, nessun'altra rete. Qui sotto c'e' la copia da tenere
        da parte comunque.</p>
      <p class="sub" id="statoDeposito"></p>`;
if (!corpo.includes(vecchioTesto)) {
  console.error('Il testo della scheda "I tuoi dati" e\' cambiato: aggiorna questo script,\n'
    + 'o la copia pubblicata dira\' una cosa falsa su dove finiscono i dati.');
  process.exit(1);
}
corpo = corpo.replace(vecchioTesto, nuovoTesto);

const tagliato = app.replace(/\n\/\/ Il service worker: e' questo[\s\S]*$/, '\n');
if (tagliato === app) {
  console.error('Non ho trovato la registrazione del service worker da togliere: '
    + 'controlla la fine di public/vita/app.js.');
  process.exit(1);
}
app = tagliato;

const deposito = `
/* ==================== LA COPIA IN RETE ==================== */
// Questo pezzo esiste solo nella copia pubblicata su claude.ai. Il posto dove
// la giornata vive resta localStorage - sincrono, immediato, e l'app funziona
// identica se qui sotto non risponde nessuno. In piu', se il visualizzatore
// concede il deposito, lo stato ci finisce anche dentro: serve ad aprire la
// stessa giornata da due dispositivi, e a non perderla quando il browser fa
// pulizia dei dati del sito.

const QUANDO = 'piano.aggiornato';
const quandoLocale = () => Number(localStorage.getItem(QUANDO) || 0);

let deposito = null, spedizione = null;

function spedisci() {
  if (!deposito) return;
  // Mezzo secondo di respiro: spuntare tre cose di fila e' una scrittura, non tre.
  clearTimeout(spedizione);
  spedizione = setTimeout(() => {
    const quando = Date.now();
    deposito.set({ stato: JSON.stringify(S), aggiornato: quando })
      .then(() => { try { localStorage.setItem(QUANDO, String(quando)); } catch (e) {} })
      .catch(() => {});
  }, 500);
}

// salva() resta quello di prima e continua a scrivere sul telefono: qui gli si
// mette accanto la spedizione, cosi' nessuna delle azioni non deve saperne niente.
const salvaSoloQui = salva;
salva = function () { salvaSoloQui(); spedisci(); };

(async () => {
  if (!window.claude || typeof claude.use !== 'function') return;
  let db = null;
  try { db = await claude.use('db'); } catch (e) { db = null; }
  // null vuol dire "questo visualizzatore non puo'": non e' un errore da
  // mostrare, e' un pezzo che semplicemente non si accende.
  if (!db) return;

  deposito = db.doc('piano/stato');
  try {
    const remoto = await deposito.get();
    // Si adotta la copia in rete solo se e' piu' recente di quella locale:
    // l'ultimo che scrive vince, ed e' la regola giusta quando la persona e'
    // una sola su due dispositivi.
    if (remoto && remoto.stato && Number(remoto.aggiornato || 0) > quandoLocale()) {
      localStorage.setItem(CHIAVE, remoto.stato);
      localStorage.setItem(QUANDO, String(remoto.aggiornato));
      carica();
      giornoScelto = oggi();
      disegna();
    } else if (S.cose.length || S.abitudini.length || Object.keys(S.giornate).length) {
      // Al contrario: qui c'e' roba che la rete non ha ancora visto.
      spedisci();
    }
  } catch (e) { /* deposito non raggiungibile: si continua sul telefono */ }

  const riga = document.getElementById('statoDeposito');
  if (riga) riga.textContent = 'La copia nel deposito e\\' attiva.';
})();
`;

fs.writeFileSync(uscita, `<title>PIANO</title>\n${stile}\n\n${corpo}\n\n<script>\n${app}${deposito}</script>\n`);
console.log('  ' + uscita);
console.log('  Da pubblicare con capabilities {"db": {}} - senza, il deposito resta spento.');
