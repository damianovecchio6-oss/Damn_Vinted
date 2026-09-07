// L'account personale: email e password, per chi vuole che il suo storico
// sopravviva a un telefono che si svuota (successo su iOS, dove un'app
// aggiunta alla Home ha uno storage separato da Safari e gestito in modo
// aggressivo dal sistema - non e' un guasto di ALBA, e' come funziona
// l'iPhone).
//
// Sei azioni:
//   registrati        - crea l'account
//   accedi             - email+password -> il nostro token, non quello di Supabase
//   richiedi-reset     - manda l'email per reimpostare la password
//   reimposta-password - completa il cambio col token che arriva in quell'email
//   storico-leggi       \  richiedono il nostro token (X-Account-Token):
//   storico-scrivi        \ la voce arriva/parte da qui, non da Supabase
//   storico-cancella       /
//
// Senza deposito configurato ogni azione risponde che non c'e': come
// mercato.js, come SERPAPI_KEY. Il sito funziona uguale, solo senza account.
const S = require('./lib/shared');
const A = require('./lib/account');

// Qui passano testo dell'annuncio e una miniatura in base64: piu' grande del
// tetto di mercato.js (sei numeri), ma resta una miniatura, non una foto.
const MAX_BODY = 512 * 1024;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function tagliato(valore, tetto) {
  if (typeof valore !== 'string') return null;
  const pulito = valore.trim().slice(0, tetto);
  return pulito || null;
}

function numeroOk(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1000000;
}

exports.handler = async (event) => {
  // Niente richiediToken: l'account e' un sistema di accesso suo, separato
  // dal token del PIN che apre le chiavi AI. Chi non ha mai analizzato una
  // foto deve poter comunque registrarsi.
  const g = S.checkRequest(event, { metodi: ['POST'] });
  if (g.risposta) return g.risposta;
  const cors = g.cors;

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');
  if (Buffer.byteLength(rawBody) > MAX_BODY) {
    return S.json(413, cors, { error: 'Richiesta troppo grande' });
  }

  let body;
  try { body = JSON.parse(rawBody || '{}'); }
  catch { return S.json(400, cors, { error: 'Richiesta non valida' }); }

  if (!A.configurato()) {
    return S.json(501, cors, { error: 'Account non configurato sul server (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY)' });
  }

  const azione = body.azione;
  if (azione === 'registrati') return registrati(body, cors);
  if (azione === 'accedi') return accedi(body, cors);
  if (azione === 'richiedi-reset') return richiediReset(body, g.headers, cors);
  if (azione === 'reimposta-password') return reimpostaPassword(body, cors);

  // Da qui in poi serve essere dentro.
  const userId = S.verifyAccountToken(S.lowerKeys(event.headers || {})['x-account-token']);
  if (!userId) return S.json(401, cors, { error: 'Sessione scaduta. Accedi di nuovo.', codice: 'account' });

  if (azione === 'storico-leggi') return storicoLeggi(userId, cors);
  if (azione === 'storico-scrivi') return storicoScrivi(userId, body, cors);
  if (azione === 'storico-cancella') return storicoCancella(userId, body, cors);
  if (azione === 'storico-cancella-tutto') return storicoCancellaTutto(userId, cors);
  return S.json(400, cors, { error: 'Azione sconosciuta' });
};

function credenziali(body) {
  const email = tagliato(body.email, 254);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !EMAIL_RE.test(email)) return { errore: 'Email non valida' };
  if (password.length < 6) return { errore: 'La password deve avere almeno 6 caratteri' };
  return { email, password };
}

async function registrati(body, cors) {
  const c = credenziali(body);
  if (c.errore) return S.json(400, cors, { error: c.errore });
  const r = await A.registrati(c.email, c.password);
  if (!r.ok) return S.json(400, cors, { error: r.errore });
  return S.json(200, cors, { registrato: true, serveConferma: !!r.serveConferma });
}

async function accedi(body, cors) {
  const c = credenziali(body);
  if (c.errore) return S.json(400, cors, { error: c.errore });
  const r = await A.accedi(c.email, c.password);
  if (!r.ok) return S.json(401, cors, { error: r.errore });
  return S.json(200, cors, { token: S.issueAccountToken(r.userId), scadeIn: S.ACCOUNT_TTL_MS });
}

async function richiediReset(body, headers, cors) {
  const email = tagliato(body.email, 254);
  if (!email || !EMAIL_RE.test(email)) return S.json(400, cors, { error: 'Email non valida' });
  // Il link nell'email riporta qui, non su una pagina di Supabase: e' il
  // dominio da cui e' arrivata la richiesta, gia' passato dal controllo
  // same-site di checkRequest.
  const origine = S.normalizeOrigin(headers.origin) || S.normalizeOrigin(headers.referer) || '';
  await A.richiediReset(email, origine ? origine + '/?vai=reset' : undefined);
  // Sempre 200, esista o no quella email: altrimenti questa rotta diventa un
  // modo per scoprire chi e' registrato.
  return S.json(200, cors, { inviata: true });
}

async function reimpostaPassword(body, cors) {
  const tokenRecupero = typeof body.tokenRecupero === 'string' ? body.tokenRecupero : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!tokenRecupero) return S.json(400, cors, { error: 'Link di recupero mancante o scaduto' });
  if (password.length < 6) return S.json(400, cors, { error: 'La password deve avere almeno 6 caratteri' });
  const ok = await A.reimpostaPassword(tokenRecupero, password);
  if (!ok) return S.json(400, cors, { error: 'Link di recupero non valido o scaduto. Richiedine uno nuovo.' });
  return S.json(200, cors, { cambiata: true });
}

// Le colonne cosi' come le tiene storico_utenti: quello che il client manda
// in piu' non entra, ed e' voluto - un consumatore futuro (o uno vecchio)
// che aggiunge un campo alla voce locale non lo fa arrivare qui per sbaglio
// finche' non lo si decide anche da questa parte.
function rigaDaVoce(voce) {
  const riga = {
    id: tagliato(voce.id, 64),
    nome: tagliato(voce.nome, 120),
    marca: tagliato(voce.marca, 60),
    taglia: tagliato(voce.taglia, 20),
    condizione: tagliato(voce.condizione, 30),
    titolo: tagliato(voce.titolo, 200),
    descrizione: tagliato(voce.descrizione, 2000),
    hashtag: tagliato(voce.hashtag, 500),
    consiglio: tagliato(voce.consiglio, 500),
    fiducia: tagliato(voce.fiducia, 20),
    prezzo_suggerito: numeroOk(voce.prezzoSuggerito) ? voce.prezzoSuggerito : null,
    range_min: numeroOk(voce.rangeMin) ? voce.rangeMin : null,
    range_max: numeroOk(voce.rangeMax) ? voce.rangeMax : null,
    // esito e profilo sono gia' oggetti piccoli e piatti (vedi sxProfilo):
    // vanno in due colonne jsonb cosi' come sono, senza spacchettarli campo
    // per campo qui dentro.
    esito: voce.esito && typeof voce.esito === 'object' ? voce.esito : null,
    profilo: voce.profilo && typeof voce.profilo === 'object' ? voce.profilo : null,
    creato_il: Number.isFinite(voce.createdAt) ? new Date(voce.createdAt).toISOString() : new Date().toISOString()
  };
  if (!riga.id || !riga.nome) return null;
  return riga;
}

// Firmare un URL e' una chiamata di rete in piu' per ogni voce con una foto,
// e con lo storico pieno (fino a STORICO_MAX) e i socket condivisi limitati
// a dieci (shared.js) la somma puo' superare il budget della function molto
// prima che finisca l'ultima. Ogni firma resta dentro una scadenza comune:
// oltre quel punto la voce torna senza foto invece di far scadere tutta la
// risposta - una miniatura mancante si nota, una pagina che non risponde no.
function entroScadenza(promessa, scadenza) {
  return Promise.race([
    promessa,
    new Promise(risolvi => setTimeout(() => risolvi(null), Math.max(0, scadenza - Date.now())))
  ]).catch(() => null);
}

async function storicoLeggi(userId, cors) {
  const righe = await A.leggiStorico(userId);
  // Margine per la lettura gia' fatta e per serializzare la risposta: le
  // firme condividono quello che resta del budget della function, non tutto
  // S.TEMPO_MASSIMO da capo.
  const scadenza = Date.now() + S.TEMPO_MASSIMO - 1500;
  const voci = await Promise.all(righe.map(async r => ({
    id: r.id, nome: r.nome, marca: r.marca, taglia: r.taglia, condizione: r.condizione,
    titolo: r.titolo, descrizione: r.descrizione, hashtag: r.hashtag, consiglio: r.consiglio,
    fiducia: r.fiducia,
    prezzoSuggerito: r.prezzo_suggerito, rangeMin: r.range_min, rangeMax: r.range_max,
    esito: r.esito, profilo: r.profilo,
    foto: r.foto_percorso ? await entroScadenza(A.urlFoto(r.foto_percorso), scadenza) : null,
    createdAt: r.creato_il ? Date.parse(r.creato_il) : undefined,
    updatedAt: r.aggiornato_il ? Date.parse(r.aggiornato_il) : undefined
  })));
  return S.json(200, cors, { voci });
}

async function storicoScrivi(userId, body, cors) {
  const riga = rigaDaVoce(body.voce || {});
  if (!riga) return S.json(400, cors, { error: 'Voce non valida' });

  if (typeof body.foto === 'string' && body.foto.startsWith('data:')) {
    const percorso = await A.caricaFoto(userId, riga.id, body.foto);
    if (percorso) riga.foto_percorso = percorso;
  }

  const ok = await A.scriviVoce(userId, riga);
  // Come contribuisci() col mercato: chi sta lavorando ha gia' la sua copia
  // locale, un sync fallito non deve interrompere niente.
  return S.json(ok ? 200 : 202, cors, { salvato: ok });
}

async function storicoCancella(userId, body, cors) {
  const id = tagliato(body.id, 64);
  if (!id) return S.json(400, cors, { error: 'Id mancante' });
  const ok = await A.cancellaVoce(userId, id);
  return S.json(ok ? 200 : 202, cors, { cancellato: ok });
}

async function storicoCancellaTutto(userId, cors) {
  const ok = await A.cancellaTutto(userId);
  return S.json(ok ? 200 : 202, cors, { cancellato: ok });
}
