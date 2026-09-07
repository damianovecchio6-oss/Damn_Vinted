// L'account personale: l'unico pezzo di ALBA che sa chi sei, perche' e' l'unico
// per cui serve saperlo. Tutto il resto del sito - lo storico locale, il
// deposito dei prezzi condivisi - resta senza identita' per scelta.
//
// Qui dentro: Supabase Auth (via REST, come deposito.js fa col database - una
// dipendenza sola, niente SDK) per email+password e reset, e Supabase Storage
// per le foto. Il client non parla mai con Supabase: passa sempre da qui,
// stessa regola delle chiavi AI.
//
// Senza SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_KEY l'account non
// esiste e ogni funzione qui dentro lo dice invece di fallire - stessa regola
// di deposito.js e di SERPAPI_KEY.
const S = require('./shared');

const URL_BASE = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const ANON_KEY = (process.env.SUPABASE_ANON_KEY || '').trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();
const BUCKET = 'storico-foto';

function configurato() {
  return !!(URL_BASE && ANON_KEY && SERVICE_KEY);
}

function hostname() {
  try { return new global.URL(URL_BASE).hostname; } catch (e) { return ''; }
}

async function chiama(metodo, percorso, corpo, opzioni) {
  const o = opzioni || {};
  const payload = corpo !== undefined ? JSON.stringify(corpo) : null;
  try {
    const r = await S.inviaHttp({
      hostname: hostname(),
      path: percorso,
      method: metodo,
      headers: Object.assign({
        'apikey': o.chiave || ANON_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }, o.headers || {})
    }, payload, Date.now() + (o.timeoutMs || 5000));
    let dati = null;
    try { dati = r.body ? JSON.parse(r.body) : null; } catch (e) { dati = null; }
    return { status: r.status, dati };
  } catch (e) {
    return { status: 0, dati: null, errore: e.message };
  }
}

/* ===== AUTENTICAZIONE ===== */
// Tutte e tre passano dalla chiave anon: e' quella pensata per queste rotte,
// e Supabase la accompagna con le sue policy di RLS su auth.users - che qui
// non ci interessano, perche' la function non legge quella tabella, chiede
// solo a Supabase di verificare o creare le credenziali.

// { ok, sessione:{accessToken}, servonoConferma } oppure { ok:false, errore }.
// La sessione che torna e' quella di Supabase, usata una volta sola per capire
// se l'email va confermata prima di poter accedere: il token che il client
// tiene davvero e' il nostro (issueAccountToken), rilasciato da accedi().
async function registrati(email, password) {
  const r = await chiama('POST', '/auth/v1/signup', { email, password },
    { headers: { 'Authorization': 'Bearer ' + ANON_KEY } });
  if (r.status >= 200 && r.status < 300 && r.dati && r.dati.id) {
    return { ok: true, serveConferma: !r.dati.confirmed_at && !(r.dati.identities && r.dati.identities.length === 0) };
  }
  return { ok: false, errore: erroreDi(r) };
}

// { ok, userId } oppure { ok:false, errore }.
async function accedi(email, password) {
  const r = await chiama('POST', '/auth/v1/token?grant_type=password', { email, password },
    { headers: { 'Authorization': 'Bearer ' + ANON_KEY } });
  if (r.status >= 200 && r.status < 300 && r.dati && r.dati.user && r.dati.user.id) {
    return { ok: true, userId: r.dati.user.id };
  }
  return { ok: false, errore: erroreDi(r) };
}

async function richiediReset(email, redirectTo) {
  const r = await chiama('POST', '/auth/v1/recover',
    Object.assign({ email }, redirectTo ? { options: { redirect_to: redirectTo } } : {}),
    { headers: { 'Authorization': 'Bearer ' + ANON_KEY } });
  // Supabase risponde 200 anche se l'email non esiste - di proposito, cosi'
  // chi chiede il reset non scopre quali email sono registrate. Si tiene lo
  // stesso comportamento qui.
  return r.status >= 200 && r.status < 300;
}

// tokenRecupero e' quello che arriva nel link dell'email (il client lo legge
// dal frammento dell'URL), non il nostro token di sessione: vale una volta,
// solo per cambiare la password.
async function reimpostaPassword(tokenRecupero, nuovaPassword) {
  const r = await chiama('PUT', '/auth/v1/user', { password: nuovaPassword },
    { headers: { 'Authorization': 'Bearer ' + tokenRecupero } });
  return r.status >= 200 && r.status < 300;
}

function erroreDi(r) {
  if (r.errore) return 'Servizio account non raggiungibile.';
  const msg = r.dati && (r.dati.msg || r.dati.error_description || r.dati.error);
  if (r.status === 400 && /already registered|already exists/i.test(msg || '')) return 'Questa email ha gia\' un account.';
  if (r.status === 400 && /invalid login credentials/i.test(msg || '')) return 'Email o password sbagliate.';
  if (r.status === 422 && /password/i.test(msg || '')) return 'Password troppo corta (minimo 6 caratteri).';
  return msg || 'Richiesta non riuscita.';
}

/* ===== LO STORICO PERSONALE ===== */
// Qui invece serve la chiave service: bypassa le RLS (accese e senza policy,
// come esiti/impostazioni) perche' e' la function - dopo aver verificato il
// nostro token - a garantire che ogni riga letta o scritta sia dell'utente
// giusto. Postgres non lo sa fare da solo in questo schema, e va bene cosi':
// la stessa regola vale gia' per il deposito dei prezzi.
function conServizio(extra) {
  return Object.assign({ 'Authorization': 'Bearer ' + SERVICE_KEY }, extra || {});
}

// Lo stesso tetto di MAX_HISTORY lato client: oltre, il locale le taglierebbe
// comunque, e ogni voce in piu' con una foto e' un URL da firmare in piu'
// dentro il budget della function.
const STORICO_MAX = 50;

async function leggiStorico(userId) {
  const r = await chiama('GET',
    `/rest/v1/storico_utenti?user_id=eq.${encodeURIComponent(userId)}&order=aggiornato_il.desc&limit=${STORICO_MAX}`,
    undefined, { chiave: SERVICE_KEY, headers: conServizio() });
  return Array.isArray(r.dati) ? r.dati : [];
}

async function scriviVoce(userId, voce) {
  const riga = Object.assign({}, voce, { user_id: userId, aggiornato_il: new Date().toISOString() });
  const r = await chiama('POST', '/rest/v1/storico_utenti', [riga], {
    chiave: SERVICE_KEY,
    headers: conServizio({ 'Prefer': 'resolution=merge-duplicates,return=minimal' })
  });
  return r.status >= 200 && r.status < 300;
}

async function cancellaVoce(userId, id) {
  const r = await chiama('DELETE',
    `/rest/v1/storico_utenti?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
    undefined, { chiave: SERVICE_KEY, headers: conServizio({ 'Prefer': 'return=minimal' }) });
  return r.status >= 200 && r.status < 300;
}

// Una riga sola, non una per voce: "cancella tutto" su uno storico di
// qualche decina di elementi mandato come N DELETE in parallelo sbatteva
// contro il limite di richieste al minuto, e le voci oltre la ventesima
// tornavano al login successivo - cancellate solo in apparenza.
async function cancellaTutto(userId) {
  const r = await chiama('DELETE', `/rest/v1/storico_utenti?user_id=eq.${encodeURIComponent(userId)}`,
    undefined, { chiave: SERVICE_KEY, headers: conServizio({ 'Prefer': 'return=minimal' }) });
  return r.status >= 200 && r.status < 300;
}

/* ===== LE FOTO ===== */
// Bucket privato: le foto di quello che qualcuno sta vendendo non sono un
// dato pubblico, e la stessa attenzione la app la usa gia' per lo storico
// locale, mai mandato al deposito condiviso.
async function caricaFoto(userId, id, base64) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(base64 || '');
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  const percorso = `${userId}/${id}.jpg`;
  try {
    const r = await S.inviaHttp({
      hostname: hostname(),
      path: `/storage/v1/object/${BUCKET}/${percorso}`,
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + SERVICE_KEY,
        'apikey': SERVICE_KEY,
        'Content-Type': m[1] || 'image/jpeg',
        'x-upsert': 'true'
      }
    }, buf, Date.now() + 8000);
    if (r.status < 200 || r.status >= 300) return null;
    return percorso;
  } catch (e) {
    return null;
  }
}

// URL firmato, un'ora di vita: basta a mostrare lo Storico appena aperto,
// senza tenere le foto raggiungibili da chiunque abbia il link per sempre.
async function urlFoto(percorso) {
  if (!percorso) return null;
  const r = await chiama('POST', `/storage/v1/object/sign/${BUCKET}/${percorso}`, { expiresIn: 3600 },
    { chiave: SERVICE_KEY, headers: conServizio() });
  if (r.status < 200 || r.status >= 300 || !r.dati || !r.dati.signedURL) return null;
  return URL_BASE + '/storage/v1' + r.dati.signedURL;
}

module.exports = {
  configurato, registrati, accedi, richiediReset, reimpostaPassword,
  leggiStorico, scriviVoce, cancellaVoce, cancellaTutto, caricaFoto, urlFoto, BUCKET
};
