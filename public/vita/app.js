// PIANO — tutto lo script della pagina.
//
// Sta fuori dal markup perche' la CSP del sito non concede script-src
// 'unsafe-inline': un permesso che varrebbe per qualunque script inline, non
// solo per il nostro. E' un file classico, non un modulo, cosi' le funzioni
// restano globali e il dispatcher in fondo le raggiunge per nome da data-az.
//
// Non c'e' rete: niente account, niente server, niente chiavi. Tutto quello
// che scrivi resta in localStorage di questo telefono. E' la scelta che
// rende l'app "chill" davvero - non c'e' niente da sincronizzare, niente da
// aspettare, e nessuno a cui stai mandando la tua giornata.

/* ==================== IL DEPOSITO ==================== */

const CHIAVE = 'piano.stato';

// Lo stato nasce cosi' e non cambia forma: aggiungere un campo qui e' gratis,
// toglierne uno no, perche' i telefoni hanno gia' la versione vecchia salvata.
function statoNuovo() {
  return { v: 1, cose: [], abitudini: [], giornate: {}, visto: null };
}

let S = statoNuovo();

function carica() {
  try {
    const grezzo = localStorage.getItem(CHIAVE);
    if (!grezzo) return;
    const letto = JSON.parse(grezzo);
    if (!letto || typeof letto !== 'object') return;
    // Si prende campo per campo: un salvataggio a meta' - o di una versione
    // futura - non deve lasciare l'app senza array su cui girare.
    S = {
      v: 1,
      cose: Array.isArray(letto.cose) ? letto.cose : [],
      abitudini: Array.isArray(letto.abitudini) ? letto.abitudini : [],
      giornate: (letto.giornate && typeof letto.giornate === 'object') ? letto.giornate : {},
      visto: typeof letto.visto === 'string' ? letto.visto : null
    };
  } catch (e) {
    // In navigazione privata localStorage puo' lanciare alla lettura. Meglio
    // un'app che parte vuota di una schermata bianca.
    S = statoNuovo();
  }
}

function salva() {
  try { localStorage.setItem(CHIAVE, JSON.stringify(S)); }
  catch (e) { /* quota piena o storage negato: l'app continua a funzionare in memoria */ }
}

/* ==================== I GIORNI ==================== */

// Le date si scrivono YYYY-MM-DD costruite a mano, non con toISOString():
// quello passa per UTC, e alle 23 di sera in Italia darebbe gia' domani.
function iso(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const g = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + g;
}
function daIso(s) {
  const [a, m, g] = String(s).split('-').map(Number);
  return new Date(a, (m || 1) - 1, g || 1);
}
function oggi() { return iso(new Date()); }
function piu(giorno, n) {
  const d = daIso(giorno);
  d.setDate(d.getDate() + n);
  return iso(d);
}
// Lunedi' e' il primo giorno: la settimana italiana comincia li', non domenica.
function lunediDi(giorno) {
  const d = daIso(giorno);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return iso(d);
}

const GIORNI = ['lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi', 'sabato', 'domenica'];
const GIORNI_CORTI = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
              'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

function dataParlata(giorno) {
  const d = daIso(giorno);
  return GIORNI[(d.getDay() + 6) % 7] + ' ' + d.getDate() + ' ' + MESI[d.getMonth()];
}
// "oggi", "domani", "ieri" quando serve: una data scritta per esteso al posto
// di "domani" costringe a fare il conto ogni volta.
function quandoParlato(giorno) {
  const o = oggi();
  if (giorno === o) return 'oggi';
  if (giorno === piu(o, 1)) return 'domani';
  if (giorno === piu(o, -1)) return 'ieri';
  return dataParlata(giorno);
}

/* ==================== STATO DELLA VISTA ==================== */

// 'casa' e' la luna a schermo intero: non e' una scheda in piu' da riempire,
// e' il posto da cui si sceglie. L'ordine e' quello dei raggi in senso
// orario, cosi' girare la ghiera e scorrere questa lista sono la stessa cosa.
const SEZIONI = ['casa', 'oggi', 'ritmo', 'settimana', 'calma'];
let sezione = 'casa';
let giornoScelto = oggi();
let momentoScelto = '';
let emojiScelta = '🌿';
let offsetSettimana = 0;

const $ = id => document.getElementById(id);
const menoMovimento = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Girando la ghiera parcheggiata la sezione cambia a ogni scatto, e scorrere
// in cima a ognuna vuol dire far ballare la pagina sotto al dito per tutto il
// giro. Mentre giri la pagina sta ferma; in cima ci si va una volta sola,
// quando ti fermi.
let scorriDopoIlGiro = null;
function inCimaQuandoTiFermi() {
  clearTimeout(scorriDopoIlGiro);
  scorriDopoIlGiro = setTimeout(inCima, 260);
}
function inCima() {
  window.scrollTo({ top: 0, behavior: menoMovimento() ? 'auto' : 'smooth' });
}

// Un colpetto quando qualcosa e' andato a segno. Su iOS non c'e' e non fa
// niente; dove c'e', spuntare una cosa si sente anche senza guardare.
function tocco(ms) {
  try { if (navigator.vibrate && !menoMovimento()) navigator.vibrate(ms); } catch (e) {}
}

function dillo(testo) {
  const p = $('annuncio');
  if (p) p.textContent = testo;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function id() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ==================== LE COSE ==================== */

function coseDi(giorno, extra) {
  return S.cose.filter(c => c.giorno === giorno && !c.lasciata && !!c.extra === !!extra);
}

// Le cose non finite dei giorni scorsi. Non vengono trascinate a oggi da sole:
// una lista che si porta dietro tutto quello che non hai fatto diventa un
// registro di colpe, ed e' esattamente cio' che questa app non vuole essere.
// Si guarda indietro una settimana e basta: piu' in la' e' roba archiviata.
function rimaste() {
  const o = oggi();
  const limite = piu(o, -7);
  return S.cose.filter(c => !c.fatta && !c.lasciata && c.giorno < o && c.giorno >= limite);
}

function aggiungiCosa(testo, giorno, momento) {
  const pulito = String(testo).trim();
  if (!pulito) return null;
  // La quarta cosa non viene rifiutata: scivola in "se avanza". Dire di no
  // sarebbe rigido, e chi la scrive la vuole scritta da qualche parte.
  const piene = coseDi(giorno, false).length >= 3;
  const c = {
    id: id(), testo: pulito, momento: momento || '', giorno,
    fatta: false, extra: piene, creata: Date.now()
  };
  S.cose.push(c);
  salva();
  return c;
}

function trova(cid) { return S.cose.find(c => c.id === cid); }

/* ==================== IL RITMO ==================== */

// La fila (lo "streak") con un buco di tolleranza: saltare un giorno non
// azzera niente, saltarne due di fila si'. E' la regola che distingue
// un'abitudine da un obbligo - la maggior parte delle app la rompe al primo
// giorno storto, e a quel punto tanto vale smettere.
//
// Oggi, finche' non e' segnato, non conta contro: alle nove del mattino la
// fila di ieri e' ancora tutta li'.
function fila(ab) {
  const fatti = new Set(ab.giorni || []);
  let g = oggi();
  if (!fatti.has(g)) g = piu(g, -1);
  let n = 0, buco = 0;
  for (let i = 0; i < 400; i++) {
    if (fatti.has(g)) { n++; buco = 0; }
    else { buco++; if (buco > 1) break; }
    g = piu(g, -1);
  }
  return n;
}

function filaParlata(ab) {
  const n = fila(ab);
  const oggiFatto = (ab.giorni || []).includes(oggi());
  if (n === 0) return oggiFatto ? 'ricominciata oggi' : 'quando vuoi';
  if (n === 1) return oggiFatto ? 'primo giorno' : 'un giorno';
  return n + ' giorni di fila';
}

/* ==================== DISEGNARE: OGGI ==================== */

function unaCosa(c) {
  const eOggi = giornoScelto === oggi();
  const etichetta = c.momento
    ? `<span class="tag${c.momento === 'sera' ? ' sera' : ''}">${esc(c.momento)}</span>`
    : '';
  const su = c.extra && coseDi(giornoScelto, false).length < 3
    ? `<button class="mini" data-az="portaSu" data-arg="${c.id}" aria-label="Porta tra le tre cose">↑ su</button>` : '';
  const domani = !c.fatta && eOggi
    ? `<button class="mini" data-az="rimanda" data-arg="${c.id}" aria-label="Sposta a domani">domani</button>` : '';
  return `<li class="cosa${c.fatta ? ' fatta' : ''}">
    <button class="segno" data-az="spunta" data-arg="${c.id}"
            role="checkbox" aria-checked="${c.fatta}" aria-label="${esc(c.testo)}">✓</button>
    <div class="corpo">
      <div class="testo">${esc(c.testo)}</div>
      <div class="meta">${etichetta}${su}${domani}
        <button class="mini" data-az="togli" data-arg="${c.id}" aria-label="Togli">togli</button>
      </div>
    </div>
  </li>`;
}

function disegnaOggi() {
  const tre = coseDi(giornoScelto, false);
  const extra = coseDi(giornoScelto, true);
  const fatte = tre.filter(c => c.fatta).length;

  // Il banner del giorno: c'e' solo quando non stai guardando oggi. Senza,
  // dalla settimana si finisce a spuntare le cose di giovedi' credendo che
  // siano quelle di adesso.
  const banner = $('bannerGiorno');
  if (giornoScelto === oggi()) {
    banner.hidden = true;
  } else {
    banner.hidden = false;
    banner.innerHTML = `<span>Stai guardando ${esc(quandoParlato(giornoScelto))}.</span>
      <button data-az="tornaOggi">torna a oggi</button>`;
  }

  // Le cose rimaste indietro: si chiede, non si decide. E si chiede una volta
  // sola, in un posto solo.
  const indietro = rimaste();
  const b2 = $('bannerRimaste');
  if (indietro.length && giornoScelto === oggi()) {
    b2.hidden = false;
    const q = indietro.length === 1 ? "e' rimasta una cosa" : 'sono rimaste ' + indietro.length + ' cose';
    b2.innerHTML = `<span>Dai giorni scorsi ${q}.</span>
      <span style="display:flex;gap:2px;flex-shrink:0">
        <button data-az="portaTutte">portale qui</button>
        <button data-az="lasciaAndare">lascia</button>
      </span>`;
  } else {
    b2.hidden = true;
  }

  // Il testo di stato e' la voce dell'app: e' qui che si decide se sei
  // seguito o sorvegliato. Nessuna percentuale, nessun "ti manca".
  let stato;
  if (!tre.length) stato = giornoScelto === oggi()
    ? 'Niente ancora. Tre cose bastano per una buona giornata.'
    : 'Niente per ' + quandoParlato(giornoScelto) + '. Puoi prepararle adesso.';
  else if (fatte === 0) stato = tre.length === 1 ? 'Una cosa da fare, con calma.' : tre.length + ' cose da fare, con calma.';
  else if (fatte < tre.length) stato = fatte === 1 ? 'Una fatta. Il resto aspetta.' : fatte + ' fatte. Il resto aspetta.';
  else stato = 'Tutto fatto. Il resto di oggi e\' bonus.';
  $('statoTre').textContent = stato;

  $('listaTre').innerHTML = tre.map(unaCosa).join('');

  // Le caselle libere si vedono: uno spazio disegnato dice "ci sta ancora
  // qualcosa", tre righe piene dicono che oggi basta cosi'.
  const liberi = Math.max(0, 3 - tre.length);
  $('slotLiberi').innerHTML = liberi
    ? Array.from({ length: liberi }, (_, i) =>
        `<div class="slot">${i === 0 && !tre.length ? 'la prima cosa' : 'ancora libero'}</div>`).join('')
    : '';

  $('listaExtra').innerHTML = extra.length
    ? extra.map(unaCosa).join('')
    : '<li class="vuoto">Vuoto. Va benissimo cosi\'.</li>';
}

/* ==================== DISEGNARE: RITMO ==================== */

function disegnaRitmo() {
  const o = oggi();
  const box = $('listaAbitudini');
  if (!S.abitudini.length) {
    box.innerHTML = '<p class="vuoto">Nessuna abitudine. Comincia con una sola, piccola: '
      + 'quella che sopravvive alle settimane storte.</p>';
    return;
  }
  // Sette pallini: gli ultimi sette giorni, il piu' vecchio a sinistra. E'
  // abbastanza per vedere un ritmo e troppo poco per sentirsi in debito.
  box.innerHTML = S.abitudini.map(ab => {
    const fatti = new Set(ab.giorni || []);
    const oggiFatto = fatti.has(o);
    const punti = Array.from({ length: 7 }, (_, i) => {
      const g = piu(o, i - 6);
      return `<span class="p${fatti.has(g) ? ' si' : ''}${g === o ? ' oggi' : ''}"></span>`;
    }).join('');
    return `<div class="ab${oggiFatto ? ' oggi' : ''}">
      <button class="tondo" data-az="segnaAbitudine" data-arg="${ab.id}"
              role="checkbox" aria-checked="${oggiFatto}" aria-label="${esc(ab.nome)}, segna oggi">${esc(ab.emoji || '🌿')}</button>
      <div class="corpo">
        <div class="abNome">${esc(ab.nome)}</div>
        <div class="abFila">${esc(filaParlata(ab))}</div>
        <div class="punti" aria-hidden="true">${punti}</div>
      </div>
      <div class="azioni">
        <button class="mini" data-az="togliAbitudine" data-arg="${ab.id}" aria-label="Togli ${esc(ab.nome)}">togli</button>
      </div>
    </div>`;
  }).join('');
}

/* ==================== DISEGNARE: SETTIMANA ==================== */

function disegnaSettimana() {
  const o = oggi();
  const lun = piu(lunediDi(o), offsetSettimana * 7);
  $('titoloSettimana').textContent = offsetSettimana === 0 ? 'Questa settimana'
    : offsetSettimana === -1 ? 'La settimana scorsa'
    : offsetSettimana === 1 ? 'La settimana prossima'
    : 'Settimana del ' + daIso(lun).getDate() + ' ' + MESI[daIso(lun).getMonth()];

  let fatteTot = 0, cose = 0;
  $('grigliaSettimana').innerHTML = Array.from({ length: 7 }, (_, i) => {
    const g = piu(lun, i);
    const tre = coseDi(g, false);
    cose += tre.length;
    fatteTot += tre.filter(c => c.fatta).length;
    const punti = tre.map(c => `<i class="${c.fatta ? '' : 'att'}"></i>`).join('');
    return `<button class="gio${g === o ? ' oggi' : ''}${g === giornoScelto ? ' scelto' : ''}${g < o ? ' passato' : ''}"
              data-az="scegliGiorno" data-arg="${g}" aria-label="${esc(dataParlata(g))}">
      <span class="gn">${GIORNI_CORTI[i]}</span>
      <span class="gd">${daIso(g).getDate()}</span>
      <span class="gp">${punti}</span>
    </button>`;
  }).join('');

  // Il riassunto guarda al ritmo, non al rendimento: quanti giorni hai
  // toccato, non quanto hai prodotto.
  const giorniConQualcosa = Array.from({ length: 7 }, (_, i) => piu(lun, i))
    .filter(g => coseDi(g, false).some(c => c.fatta)).length;
  const abitudiniSegnate = S.abitudini.reduce((n, ab) =>
    n + Array.from({ length: 7 }, (_, i) => piu(lun, i)).filter(g => (ab.giorni || []).includes(g)).length, 0);

  let testo;
  if (!cose && !abitudiniSegnate) testo = 'Ancora niente scritto in questa settimana.';
  else {
    const pezzi = [];
    if (fatteTot) pezzi.push(fatteTot === 1 ? 'una cosa fatta' : fatteTot + ' cose fatte');
    if (giorniConQualcosa) pezzi.push(giorniConQualcosa === 1 ? 'in un giorno' : 'in ' + giorniConQualcosa + ' giorni');
    if (abitudiniSegnate) pezzi.push('e ' + abitudiniSegnate + ' segni sul ritmo');
    testo = pezzi.length ? pezzi.join(' ') + '.' : 'Cose scritte, nessuna spuntata. Capita.';
  }
  const energie = Array.from({ length: 7 }, (_, i) => (S.giornate[piu(lun, i)] || {}).energia).filter(Boolean);
  const media = energie.length ? (energie.reduce((a, b) => a + b, 0) / energie.length) : 0;
  const umore = media >= 4 ? ' Una buona settimana, a sentire te.'
    : media && media <= 2 ? ' Settimana pesante: tienine conto quando decidi cosa metterci dentro.'
    : '';
  $('riassuntoSettimana').innerHTML = `<p class="sub">${esc(testo + umore)}</p>`;
}

/* ==================== DISEGNARE: CALMA ==================== */

function disegnaCalma() {
  const o = oggi();
  const g = S.giornate[o] || {};
  document.querySelectorAll('#scalaEnergia .liv').forEach(b => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.arg) === g.energia));
  });
  const nota = $('notaGiorno');
  if (document.activeElement !== nota) nota.value = g.nota || '';

  // Quattordici giorni di barrette: alte quando stavi bene, basse quando no.
  // Non c'e' una media, non c'e' un grafico - solo la forma del periodo.
  const colonne = Array.from({ length: 14 }, (_, i) => {
    const giorno = piu(o, i - 13);
    const e = (S.giornate[giorno] || {}).energia;
    const h = e ? 6 + e * 6 : 4;
    const col = !e ? 'rgba(255,255,255,.07)'
      : e >= 4 ? 'rgba(169,220,200,.85)'
      : e === 3 ? 'rgba(169,220,200,.45)'
      : 'rgba(182,173,234,.55)';
    return `<div style="height:${h}px;background:${col}"></div>`;
  }).join('');
  $('strisciaUmore').innerHTML = colonne;

  const segnati = Array.from({ length: 14 }, (_, i) => (S.giornate[piu(o, i - 13)] || {}).energia).filter(Boolean);
  $('leggendaUmore').textContent = segnati.length < 3
    ? 'Due settimane, quando le avrai riempite un po\'.'
    : 'Le ultime due settimane, come le hai raccontate tu.';
}

/* ==================== DISEGNARE: LA CASA ==================== */

// Sotto la luna a schermo intero c'e' una riga sola. Non e' un riassunto di
// produttivita': e' la risposta alla domanda che uno si fa aprendo l'app -
// a che punto e' la giornata - detta come la direbbe una persona.
function disegnaCasa() {
  const tre = coseDi(oggi(), false);
  const fatte = tre.filter(c => c.fatta).length;
  const segni = S.abitudini.filter(ab => (ab.giorni || []).includes(oggi())).length;

  let riga;
  if (!tre.length) riga = 'Per oggi non c\'e\' ancora niente. Tre cose bastano.';
  else if (fatte === tre.length) riga = tre.length === 1
    ? 'La cosa di oggi e\' fatta. Il resto e\' bonus.'
    : 'Le cose di oggi sono fatte. Il resto e\' bonus.';
  else if (fatte) riga = fatte + ' su ' + tre.length + ', e il resto aspetta.';
  else riga = tre.length === 1 ? 'Una cosa da fare, con calma.' : tre.length + ' cose da fare, con calma.';
  if (segni) riga += segni === 1 ? ' Un segno sul ritmo.' : ' ' + segni + ' segni sul ritmo.';

  $('casaRiga').textContent = riga;
}

/* ==================== DISEGNARE: TUTTO ==================== */

function disegna() {
  if (sezione === 'casa') disegnaCasa();
  else if (sezione === 'oggi') disegnaOggi();
  else if (sezione === 'ritmo') disegnaRitmo();
  else if (sezione === 'settimana') disegnaSettimana();
  else if (sezione === 'calma') disegnaCalma();
  intestazione();
}

function intestazione() {
  const ora = new Date().getHours();
  const saluto = ora < 5 ? 'Ancora sveglio' : ora < 12 ? 'Buongiorno'
    : ora < 18 ? 'Buon pomeriggio' : ora < 23 ? 'Buonasera' : 'Notte';
  $('saluto').textContent = saluto;
  $('dataOggi').textContent = dataParlata(oggi());
}

// Torna true se la sezione e' cambiata davvero: chi ha gia' mosso la ghiera
// per arrivare qui deve sapere se rimetterla a posto.
function vai(nome, opzioni) {
  const pannello = $('sez-' + nome);
  if (!pannello) return false;
  // La sezione entra dal lato da cui l'hai chiamata: seguire il movimento
  // costa meno che ritrovare da capo dove sei finito.
  const daDestra = SEZIONI.indexOf(nome) > SEZIONI.indexOf(sezione);
  sezione = nome;

  document.querySelectorAll('.sez').forEach(p => p.classList.remove('on', 'daDestra'));
  pannello.classList.add('on');
  pannello.classList.toggle('daDestra', daDestra);
  document.body.classList.toggle('casa', nome === 'casa');
  // La luna non sparisce mai: o e' al centro, o e' parcheggiata sul bordo.
  const luna = $('lunaApp');
  if (luna) luna.classList.toggle('parcheggiata', nome !== 'casa');

  // Il disco dice sempre dove sei: se ci si arriva da un bottone invece che
  // dalla ghiera - toccando un giorno nella settimana, per esempio - la
  // ghiera deve seguire, o mostrerebbe il nome di una sezione che non e'
  // quella aperta.
  sincronizzaGhiera(nome);
  disegna();

  if (opzioni && opzioni.senzaScorrimento) return true;
  // Una scorsa vera annulla quella rimandata: arrivando qui da un bottone
  // mentre un giro si stava assestando, non deve scorrere due volte.
  clearTimeout(scorriDopoIlGiro);
  inCima();
  return true;
}

/* ==================== LA GHIERA ====================
   Il principio dell'iPod classic, lo stesso di ALBA: la ruota sta ferma, il
   dito ci gira intorno e la selezione salta di voce in voce con uno scatto
   per volta. Qui le voci sono i quattro raggi, il disco al centro fa da
   schermo - dice dove stai per andare - e da tasto: si preme li' per entrare.

   Restano tutte le altre strade: il tocco secco su un raggio lo apre, Tab e
   Invio pure, la rotella del mouse gira. La ghiera si aggiunge, non
   sostituisce. */

const RAGGI = Array.from(document.querySelectorAll('.raggio'));
// Quanti gradi di dito valgono uno scatto. 45 e' la distanza a cui gli scatti
// si sentono senza doversi sbracciare: quanti ne servono per fare il giro
// completo lo decide RAGGI.length, non questo numero.
const GRADI_PER_SCATTO = 45;
let selezione = 0;
// Vero se il giro appena finito ha fatto scattare la ghiera. Il rilascio del
// dito genera comunque un click, e se il dito era fermo su un raggio quel
// click lo aprirebbe: qui si distingue "ho girato" da "ho toccato".
let giroConScatti = false;
// Il tocco lo gestiamo sul rilascio del dito e non sul click, perche' sul
// telefono il click non arriva sempre: dopo un giro il browser lo sopprime, e
// il tasto centrale non aprirebbe niente. Il click resta per mouse e
// tastiera, con questa spia che evita di fare la stessa cosa due volte.
let attivatoDaTocco = false, partenza = null;

function nomeDi(raggio) {
  const eti = raggio.querySelector('.rEti');
  return eti ? eti.textContent : '';
}

function lunaParcheggiata() {
  const l = $('lunaApp');
  return !!(l && l.classList.contains('parcheggiata'));
}

// Chiamata da vai(): allinea la ghiera alla sezione che si sta aprendo, da
// qualunque parte arrivi la richiesta. Dalla casa non si muove: li' il disco
// deve continuare a mostrare cosa stai per aprire.
function sincronizzaGhiera(nome) {
  const i = RAGGI.findIndex(r => r.dataset.sezione === nome);
  if (i < 0 || i === selezione) return;
  selezione = i;
  mostraSelezione();
}

function mostraSelezione() {
  RAGGI.forEach((r, i) => r.classList.toggle('selezionato', i === selezione));
  const nome = nomeDi(RAGGI[selezione]);
  const display = $('dScelta');
  if (display) display.textContent = nome;
  const disco = document.querySelector('.disco');
  if (disco) disco.setAttribute('aria-label', lunaParcheggiata()
    ? nome + ' — tocca per tornare a scegliere'
    : 'Apri ' + nome);
}

// Uno scatto per volta, e a ogni scatto la vibrazione corta: e' il "click"
// della ghiera, l'unica cosa che rende il giro una cosa che si sente e non
// solo si guarda.
function scatta(verso) {
  const prima = selezione;
  selezione = (selezione + verso + RAGGI.length) % RAGGI.length;
  mostraSelezione();
  tocco(6);
  // A casa il giro sceglie e basta: si entra premendo al centro. Da
  // parcheggiata invece il giro CAMBIA sezione mentre lo fai - il contenuto
  // sopra si sostituisce a ogni scatto - perche' li' la luna non e' piu' un
  // menu da confermare, e' la manopola con cui passi da una sezione all'altra
  // senza tornare indietro ogni volta.
  if (lunaParcheggiata()) {
    if (!vai(RAGGI[selezione].dataset.sezione, { senzaScorrimento: true })) {
      selezione = prima;
      mostraSelezione();
      return false;
    }
    inCimaQuandoTiFermi();
  }
  return true;
}

function apriRaggio(raggio) {
  const nome = raggio && raggio.dataset.sezione;
  if (!nome) return;
  const prima = selezione;
  selezione = RAGGI.indexOf(raggio);
  mostraSelezione();
  raggio.classList.add('scelto');
  tocco(10);
  setTimeout(() => raggio.classList.remove('scelto'), 520);
  // Il raggio si accende prima di sapere se la sezione si apre davvero:
  // se il cambio venisse rifiutato, va rispento.
  if (!vai(nome)) { selezione = prima; mostraSelezione(); }
}

RAGGI.forEach(raggio => {
  raggio.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apriRaggio(raggio); }
  });
});

const lunaApp = $('lunaApp');
if (lunaApp) {
  const disegno = lunaApp.querySelector('.lunaNav');
  const parcheggiata = () => lunaApp.classList.contains('parcheggiata');
  const daRaggio = e => !!(e.target && e.target.closest && e.target.closest('.raggio'));

  /* --- il giro del dito --- */
  let giro = null;
  const angolo = (e, centro) => Math.atan2(e.clientY - centro.y, e.clientX - centro.x) * 180 / Math.PI;

  // Un disegno e' trascinabile di default, e il trascinamento nativo si mangia
  // movimenti e rilascio: la ghiera si bloccherebbe dopo il primo giro. Va
  // fermato qui e non sul pointerdown, dove porterebbe via anche il tap.
  lunaApp.addEventListener('dragstart', e => e.preventDefault());

  lunaApp.addEventListener('pointerdown', e => {
    // Ogni tocco nuovo riparte pulito: se il ripristino stesse dopo i
    // controlli qui sotto, un tocco al centro (che li salta) resterebbe
    // marchiato come "fine di un giro" e non aprirebbe niente.
    giroConScatti = false;
    partenza = { x: e.clientX, y: e.clientY };
    const r = disegno.getBoundingClientRect();
    const centro = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    // Il dito deve partire sulla corona, non sul disco: al centro c'e' il tasto.
    if (Math.hypot(e.clientX - centro.x, e.clientY - centro.y) < r.width * 0.17) return;
    giro = { centro, ultimo: angolo(e, centro), residuo: 0 };
    // I movimenti si ascoltano sulla finestra, non sulla luna: girando, il
    // dito esce e rientra dal disegno in continuazione, e dentro un <svg> il
    // vuoto non riceve eventi.
    window.addEventListener('pointermove', muoviGhiera);
    window.addEventListener('pointerup', finisciGiro);
    window.addEventListener('pointercancel', finisciGiro);
  });

  function muoviGhiera(e) {
    if (!giro) return;
    const ora = angolo(e, giro.centro);
    // Il salto fra +180 e -180 non e' mezzo giro del dito: va riportato dentro.
    let delta = ora - giro.ultimo;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    giro.ultimo = ora;
    giro.residuo += delta;

    while (Math.abs(giro.residuo) >= GRADI_PER_SCATTO) {
      const verso = giro.residuo > 0 ? 1 : -1;
      giro.residuo -= verso * GRADI_PER_SCATTO;
      giroConScatti = true;
      if (!scatta(verso)) { giro.residuo = 0; break; }
    }
  }

  function finisciGiro() {
    giro = null;
    window.removeEventListener('pointermove', muoviGhiera);
    window.removeEventListener('pointerup', finisciGiro);
    window.removeEventListener('pointercancel', finisciGiro);
  }

  /* --- la rotella del mouse fa lo stesso lavoro del dito --- */
  lunaApp.addEventListener('wheel', e => {
    e.preventDefault();
    scatta(e.deltaY > 0 || e.deltaX > 0 ? 1 : -1);
  }, { passive: false });

  /* --- l'attivazione: un raggio, il tasto centrale, o il ritorno --- */
  function attiva(e) {
    if (parcheggiata()) { tocco(8); vai('casa'); return; }
    const raggio = e.target && e.target.closest && e.target.closest('.raggio');
    // Fuori dai raggi si e' premuto il centro: apre quello che il disco mostra.
    apriRaggio(raggio || RAGGI[selezione]);
  }

  lunaApp.addEventListener('pointerup', e => {
    const da = partenza;
    partenza = null;
    if (giroConScatti) return;                // era un giro, non un tocco
    if (da && Math.hypot(e.clientX - da.x, e.clientY - da.y) > 12) return;
    attivatoDaTocco = true;
    setTimeout(() => { attivatoDaTocco = false; }, 500);
    attiva(e);
  });

  lunaApp.addEventListener('click', e => {
    if (attivatoDaTocco) return;  // ci ha gia' pensato il rilascio del dito
    if (giroConScatti) return;    // era la fine di un giro
    attiva(e);
  });

  disegno.setAttribute('tabindex', '0');
  disegno.setAttribute('role', 'application');
  disegno.setAttribute('aria-label', 'Ghiera: frecce per scorrere le sezioni, Invio per aprire');
  disegno.addEventListener('keydown', e => {
    if (daRaggio(e)) return;
    // Le frecce girano la ghiera dovunque sia la luna: a casa scelgono, da
    // parcheggiata cambiano sezione. Invio a casa apre, da parcheggiata
    // riporta alla luna intera - e' il solo tasto che cambia significato.
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); scatta(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); scatta(-1); }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (parcheggiata()) { tocco(8); vai('casa'); }
      else apriRaggio(RAGGI[selezione]);
    }
  });
}

/* ==================== IL RESPIRO ==================== */

// 4-7-8: dentro quattro, fermi sette, fuori otto. Tre giri. Il cerchio fa
// quello che devono fare i polmoni, cosi' non c'e' da contare.
let respiroTimer = null, respiroPassi = [];

function fermaRespiro() {
  respiroPassi.forEach(clearTimeout);
  respiroPassi = [];
  clearTimeout(respiroTimer);
  const b = $('bolla');
  b.className = 'bolla';
  b.textContent = 'inizia';
  $('contaRespiro').textContent = '';
  $('btnRespira').textContent = 'comincia';
  $('btnRespira').dataset.attivo = '';
}

function respira() {
  if ($('btnRespira').dataset.attivo === '1') { fermaRespiro(); return; }
  $('btnRespira').dataset.attivo = '1';
  $('btnRespira').textContent = 'basta cosi\'';

  const b = $('bolla');
  const passi = [
    ['dentro', 'inspira', 4000],
    ['tieni', 'tieni', 7000],
    ['fuori', 'butta fuori', 8000]
  ];
  let t = 0;
  for (let giro = 0; giro < 3; giro++) {
    for (const [classe, parola, durata] of passi) {
      respiroPassi.push(setTimeout(() => {
        b.className = 'bolla ' + classe;
        b.textContent = parola;
        $('contaRespiro').textContent = 'giro ' + (giro + 1) + ' di 3';
      }, t));
      t += durata;
    }
  }
  respiroTimer = setTimeout(() => {
    fermaRespiro();
    $('contaRespiro').textContent = 'fatto. non serviva altro.';
  }, t);
}

/* ==================== LE AZIONI ==================== */

const AZIONI = {
  vai(arg) { vai(arg); },

  aggiungi() {
    const campo = $('nuovaCosa');
    const c = aggiungiCosa(campo.value, giornoScelto, momentoScelto);
    if (!c) { campo.focus(); return; }
    campo.value = '';
    tocco(8);
    dillo(c.extra ? 'aggiunta a se avanza' : 'aggiunta');
    disegnaOggi();
    campo.focus();
  },

  momento(arg) {
    momentoScelto = arg || '';
    document.querySelectorAll('#momenti .chip').forEach(b =>
      b.setAttribute('aria-pressed', String((b.dataset.arg || '') === momentoScelto)));
  },

  spunta(arg) {
    const c = trova(arg);
    if (!c) return;
    c.fatta = !c.fatta;
    c.fattaIl = c.fatta ? Date.now() : null;
    salva();
    if (c.fatta) tocco(12);
    dillo(c.fatta ? 'fatta' : 'rimessa da fare');
    disegnaOggi();
  },

  togli(arg) {
    S.cose = S.cose.filter(c => c.id !== arg);
    salva();
    disegnaOggi();
    dillo('tolta');
  },

  portaSu(arg) {
    const c = trova(arg);
    if (!c || coseDi(c.giorno, false).length >= 3) return;
    c.extra = false;
    salva();
    disegnaOggi();
  },

  rimanda(arg) {
    const c = trova(arg);
    if (!c) return;
    c.giorno = piu(c.giorno, 1);
    // Arrivando in un giorno che ha gia' le sue tre, si mette in coda invece
    // di sfondare il limite: domani vale la stessa regola di oggi.
    c.extra = coseDi(c.giorno, false).length >= 3;
    salva();
    disegnaOggi();
    dillo('spostata a domani');
  },

  portaTutte() {
    const o = oggi();
    rimaste().forEach(c => {
      c.giorno = o;
      c.extra = coseDi(o, false).length >= 3;
    });
    salva();
    disegnaOggi();
    dillo('portate a oggi');
  },

  lasciaAndare() {
    // "lasciata" e non cancellata: sparisce dalla vista ma resta nei conti
    // della settimana in cui era, che e' dove e' successa davvero.
    rimaste().forEach(c => { c.lasciata = true; });
    salva();
    disegnaOggi();
    dillo('lasciate andare');
  },

  tornaOggi() {
    giornoScelto = oggi();
    disegnaOggi();
  },

  scegliGiorno(arg) {
    giornoScelto = arg;
    vai('oggi');
  },

  settimana(arg) {
    offsetSettimana = Number(arg) || 0;
    disegnaSettimana();
  },

  aggiungiAbitudine() {
    const campo = $('nuovaAbitudine');
    const nome = campo.value.trim();
    if (!nome) { campo.focus(); return; }
    S.abitudini.push({ id: id(), nome, emoji: emojiScelta, giorni: [] });
    salva();
    campo.value = '';
    disegnaRitmo();
    dillo('abitudine aggiunta');
  },

  emoji(arg) {
    emojiScelta = arg;
    document.querySelectorAll('#emoji .chip').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.arg === emojiScelta)));
  },

  segnaAbitudine(arg) {
    const ab = S.abitudini.find(a => a.id === arg);
    if (!ab) return;
    const o = oggi();
    ab.giorni = ab.giorni || [];
    const i = ab.giorni.indexOf(o);
    if (i >= 0) ab.giorni.splice(i, 1);
    else { ab.giorni.push(o); tocco(12); }
    salva();
    disegnaRitmo();
    dillo(i >= 0 ? 'tolto il segno di oggi' : filaParlata(ab));
  },

  togliAbitudine(arg) {
    S.abitudini = S.abitudini.filter(a => a.id !== arg);
    salva();
    disegnaRitmo();
  },

  energia(arg) {
    const o = oggi();
    const g = S.giornate[o] || (S.giornate[o] = {});
    const n = Number(arg);
    g.energia = g.energia === n ? null : n;
    salva();
    disegnaCalma();
  },

  respira() { respira(); },

  mostraCopia() {
    const t = $('copiaDati');
    t.hidden = false;
    t.value = JSON.stringify(S);
    t.focus();
    t.select();
    $('esitoDati').textContent = 'Copiala e mettila dove vuoi. Per rimetterla dentro, '
      + 'incollala qui sopra e tocca "ripristina".';
  },

  ripristina() {
    const t = $('copiaDati');
    if (t.hidden) { t.hidden = false; t.value = ''; t.focus();
      $('esitoDati').textContent = 'Incolla qui la copia, poi tocca di nuovo "ripristina".'; return; }
    try {
      const letto = JSON.parse(t.value);
      if (!letto || typeof letto !== 'object' || !Array.isArray(letto.cose)) throw new Error('forma');
      S = {
        v: 1,
        cose: letto.cose,
        abitudini: Array.isArray(letto.abitudini) ? letto.abitudini : [],
        giornate: (letto.giornate && typeof letto.giornate === 'object') ? letto.giornate : {},
        visto: oggi()
      };
      salva();
      t.hidden = true;
      $('esitoDati').textContent = 'Rimessa dentro.';
      disegna();
    } catch (e) {
      $('esitoDati').textContent = 'Questa copia non si legge. Niente e\' stato toccato.';
    }
  }
};

/* ==================== IL DISPATCHER ==================== */

// Il nome dell'azione sta in data-az, l'argomento in data-arg. Nessun onclick
// nel markup: e' cio' che permette alla CSP di non concedere unsafe-inline.
// Le azioni si cercano in una tabella e non tra le globali: da data-az
// arriverebbe qualunque nome, e in questa pagina i nomi globali sono tanti.
document.addEventListener('click', e => {
  const el = e.target.closest && e.target.closest('[data-az]');
  if (!el) return;
  const fn = AZIONI[el.dataset.az];
  if (typeof fn !== 'function') return;
  e.preventDefault();
  fn(el.dataset.arg);
});

// Invio dai due campi: sul telefono il tasto verde della tastiera e' la
// strada piu' corta, e senza questo non porta da nessuna parte.
$('nuovaCosa').addEventListener('keydown', e => { if (e.key === 'Enter') AZIONI.aggiungi(); });
$('nuovaAbitudine').addEventListener('keydown', e => { if (e.key === 'Enter') AZIONI.aggiungiAbitudine(); });

// La nota del giorno si salva mentre scrivi, mezzo secondo dopo l'ultima
// lettera: nessun bottone "salva" per una riga di testo.
let notaTimer = null;
$('notaGiorno').addEventListener('input', e => {
  clearTimeout(notaTimer);
  const valore = e.target.value;
  notaTimer = setTimeout(() => {
    const o = oggi();
    const g = S.giornate[o] || (S.giornate[o] = {});
    g.nota = valore;
    salva();
  }, 500);
});

// Tornando all'app dopo mezzanotte il giorno e' cambiato ma la pagina no:
// senza questo si spunterebbero le cose di ieri credendole di oggi.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (S.visto !== oggi()) {
    S.visto = oggi();
    giornoScelto = oggi();
    salva();
  }
  disegna();
});

/* ==================== L'AVVIO ==================== */

carica();
S.visto = oggi();
salva();
// La classe della casa e' nel markup per la prima pennellata, ma va rimessa da
// qui: dove il <body> non e' nostro - la copia pubblicata come Artifact, dove
// l'involucro lo scrive il visualizzatore - senza questa riga la ghiera non
// prenderebbe i tocchi e il contenuto lascerebbe spazio a una luna che non e'
// ancora parcheggiata.
document.body.classList.toggle('casa', sezione === 'casa');
intestazione();
disegna();
mostraSelezione();

// Il service worker: e' questo che fa la differenza tra una pagina aperta a
// schermo intero e un'applicazione. Scoperta a parte: registrato da /vita/,
// il suo raggio d'azione e' /vita/ e non tocca ALBA.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
