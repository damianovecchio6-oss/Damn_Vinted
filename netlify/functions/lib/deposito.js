// Il deposito: l'unico pezzo di ALBA che ricorda qualcosa fra un visitatore e
// l'altro. Tutto il resto e' senza memoria per scelta - lo storico vive nel
// telefono di chi lo scrive - ma due cose hanno bisogno di un posto comune:
// gli esiti di vendita di tutti (perche' l'app impari da chi la usa) e
// l'interruttore del codice di accesso (perche' sia un tasto e non un deploy).
//
// Dentro c'e' un Postgres di Supabase, raggiunto dalla sua API REST. Non c'e'
// nessuna libreria: una POST e una GET fatte con inviaHttp, come per gli altri
// servizi esterni. Una dipendenza per tre chiamate sarebbe stata piu' codice di
// quello che risparmiava.
//
// Senza SUPABASE_URL e SUPABASE_SERVICE_KEY il deposito non esiste e ogni
// funzione qui dentro lo dice invece di fallire: il sito continua a funzionare
// come prima, solo senza i prezzi condivisi. E' la stessa regola di SERPAPI_KEY.
const S = require('./shared');

const URL_BASE = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const CHIAVE = (process.env.SUPABASE_SERVICE_KEY || '').trim();

// La chiave di servizio scavalca le policy di riga: e' il motivo per cui la
// tabella puo' restare chiusa a chiunque altro. Non deve mai finire nella
// pagina - sta qui, in una function, come le chiavi AI.
function configurato() {
  return !!(URL_BASE && CHIAVE);
}

function hostname() {
  try { return new global.URL(URL_BASE).hostname; } catch (e) { return ''; }
}

// Ogni chiamata ha la sua deadline: il deposito e' un di piu', e un Postgres
// lento non deve tenere in ostaggio la risposta all'utente.
async function chiama(metodo, percorso, corpo, opzioni) {
  const o = opzioni || {};
  if (!configurato()) return { status: 0, dati: null, assente: true };
  const payload = corpo ? JSON.stringify(corpo) : null;
  try {
    const r = await S.inviaHttp({
      hostname: hostname(),
      path: '/rest/v1' + percorso,
      method: metodo,
      headers: Object.assign({
        'apikey': CHIAVE,
        'Authorization': 'Bearer ' + CHIAVE,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }, o.headers || {})
    }, payload, Date.now() + (o.timeoutMs || 4000));
    let dati = null;
    try { dati = r.body ? JSON.parse(r.body) : null; } catch (e) { dati = null; }
    return { status: r.status, dati };
  } catch (e) {
    return { status: 0, dati: null, errore: e.message };
  }
}

/* ===== GLI ESITI CONDIVISI ===== */

// Quante volte al giorno un dispositivo puo' aggiungere un esito. Non e' una
// difesa contro chi vuole avvelenare i prezzi sul serio - per quello ci sono le
// mediane e i limiti sui valori - ma taglia lo script banale che ne manda mille.
const ESITI_AL_GIORNO = 20;

async function troppiEsiti(dispositivo) {
  const da = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const r = await chiama('GET', `/esiti?dispositivo=eq.${encodeURIComponent(dispositivo)}`
    + `&creato_il=gte.${encodeURIComponent(da)}&select=id&limit=${ESITI_AL_GIORNO + 1}`);
  // Se il conteggio non si riesce a fare, si lascia passare: un deposito
  // irraggiungibile non deve trasformarsi in un rifiuto all'utente.
  if (!Array.isArray(r.dati)) return false;
  return r.dati.length >= ESITI_AL_GIORNO;
}

async function segnaEsito(riga) {
  const r = await chiama('POST', '/esiti', [riga], { headers: { 'Prefer': 'return=minimal' } });
  return r.status >= 200 && r.status < 300;
}

// La banda del mercato per un capo: mediana dello scarto fra suggerito e
// incassato, mediana dei giorni, e su quanti capi e' fatta. I conti li fa
// Postgres con percentile_cont: farli qui avrebbe voluto dire scaricare
// migliaia di righe per calcolarne due numeri.
async function banda(marca, categoria) {
  const r = await chiama('POST', '/rpc/banda_mercato', {
    p_marca: marca || null,
    p_categoria: categoria || null
  });
  const riga = Array.isArray(r.dati) ? r.dati[0] : r.dati;
  if (!riga || typeof riga.n !== 'number' || !riga.n) return null;
  return {
    n: riga.n,
    scarto: riga.scarto === null ? null : Math.round(Number(riga.scarto)),
    giorni: riga.giorni === null ? null : Math.round(Number(riga.giorni)),
    ambito: riga.ambito || 'tutti'
  };
}

/* ===== LE IMPOSTAZIONI ===== */

// Lette a ogni richiesta sarebbero un viaggio in piu' verso il database prima
// di ogni token: qui si tengono per un minuto. E' anche il ritardo massimo fra
// il tasto premuto e il codice che entra in vigore, ed e' un compromesso
// accettabile per una serratura di casa.
const TTL_IMPOSTAZIONI = 60 * 1000;
const memoria = new Map();

async function impostazione(chiave) {
  const ora = Date.now();
  const avuta = memoria.get(chiave);
  if (avuta && ora < avuta.scade) return avuta.valore;

  const r = await chiama('GET', `/impostazioni?chiave=eq.${encodeURIComponent(chiave)}&select=valore`,
    null, { timeoutMs: 2500 });
  if (!Array.isArray(r.dati)) {
    // Deposito muto: si tiene l'ultimo valore conosciuto, anche scaduto. E'
    // meglio di una serratura che si apre da sola perche' il database e' lento.
    return avuta ? avuta.valore : null;
  }
  const valore = r.dati.length ? String(r.dati[0].valore) : null;
  memoria.set(chiave, { valore, scade: ora + TTL_IMPOSTAZIONI });
  return valore;
}

async function impostaImpostazione(chiave, valore) {
  const r = await chiama('POST', '/impostazioni', [{ chiave, valore: String(valore), aggiornato_il: new Date().toISOString() }],
    { headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' } });
  const ok = r.status >= 200 && r.status < 300;
  // La cache si aggiorna subito: chi ha premuto il tasto deve vedere l'effetto
  // adesso, non fra un minuto.
  if (ok) memoria.set(chiave, { valore: String(valore), scade: Date.now() + TTL_IMPOSTAZIONI });
  return ok;
}

function scordaImpostazioni() {
  memoria.clear();
}

module.exports = {
  configurato, chiama, segnaEsito, troppiEsiti, banda,
  impostazione, impostaImpostazione, scordaImpostazioni,
  ESITI_AL_GIORNO
};
