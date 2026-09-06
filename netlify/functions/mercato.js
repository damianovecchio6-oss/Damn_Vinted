// Il mercato condiviso: quello che ALBA impara da chi la usa.
//
// Tre azioni, tutte dietro al token di sessione come le altre function:
//   segna         - "questo capo l'ho venduto a X in Y giorni", e finisce nel
//                   deposito insieme a quelli di tutti gli altri
//   banda         - "quanto vanno sotto i capi di questa marca?", e torna una
//                   mediana su cui il prompt della stima puo' appoggiarsi
//   impostazioni  - lo stato del tasto del codice di accesso, e il tasto stesso
//
// Senza deposito configurato ogni azione risponde che non c'e': il sito
// funziona come prima, senza prezzi condivisi e senza tasto. Come SERPAPI_KEY.
const S = require('./lib/shared');
const D = require('./lib/deposito');

const MAX_BODY = 4 * 1024;   // qui passano sei numeri, non delle foto

// Quello che si accetta di sentirsi dire. Tutto il resto della riga - il nome
// del capo, le note, la foto - non arriva nemmeno: non serve ai conti, e non
// deve stare in un database condiviso.
const MAX_TESTO = 40;

function testoBreve(valore, tetto) {
  if (typeof valore !== 'string') return null;
  const pulito = valore.trim().replace(/\s+/g, ' ').slice(0, tetto || MAX_TESTO);
  return pulito || null;
}

exports.handler = async (event) => {
  const g = S.checkRequest(event, { metodi: ['POST'], richiediToken: true });
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

  if (!D.configurato()) {
    // 501 e non 500: non e' un guasto, e' una parte che questo sito non ha.
    return S.json(501, cors, { error: 'Mercato condiviso non configurato sul server (SUPABASE_URL, SUPABASE_SERVICE_KEY)' });
  }

  if (body.azione === 'segna') return segna(body, cors);
  if (body.azione === 'banda') return banda(body, cors);
  if (body.azione === 'impostazioni') return impostazioni(body, S.lowerKeys(event.headers || {}), cors);
  return S.json(400, cors, { error: 'Azione sconosciuta' });
};

async function segna(body, cors) {
  const marca = testoBreve(body.marca);
  const suggerito = Number(body.prezzoSuggerito);
  const venduto = Number(body.prezzoVenduto);
  const dispositivo = testoBreve(body.dispositivo, 64);

  // La marca e' la chiave di tutto: un esito senza marca non si puo' chiedere
  // a nessuno, e sporcherebbe solo la media generale.
  if (!marca) return S.json(400, cors, { error: 'Marca mancante' });
  if (!dispositivo || dispositivo.length < 8) return S.json(400, cors, { error: 'Dispositivo mancante' });
  if (!(suggerito > 0) || !(venduto > 0)) return S.json(400, cors, { error: 'Prezzi non validi' });
  // Le stesse due soglie che ha il database. Qui si dice perche', li' si e'
  // sicuri che valga anche per chi scrivesse da un'altra strada.
  if (venduto < suggerito * 0.05 || venduto > suggerito * 5) {
    return S.json(400, cors, { error: 'Prezzo fuori scala rispetto al suggerito' });
  }

  const giorni = body.giorni === undefined || body.giorni === null ? null : Number(body.giorni);
  if (giorni !== null && (!Number.isFinite(giorni) || giorni < 0 || giorni > 3650)) {
    return S.json(400, cors, { error: 'Giorni non validi' });
  }

  if (await D.troppiEsiti(dispositivo)) {
    return S.json(429, cors, { error: 'Troppi esiti da questo dispositivo oggi' });
  }

  const ok = await D.segnaEsito({
    marca,
    categoria: testoBreve(body.categoria),
    condizione: testoBreve(body.condizione, 30),
    prezzo_suggerito: Math.round(suggerito * 100) / 100,
    prezzo_venduto: Math.round(venduto * 100) / 100,
    giorni: giorni === null ? null : Math.round(giorni),
    dispositivo
  });
  // Un esito che non entra non e' un problema di chi lo ha scritto: il suo
  // storico ce l'ha lo stesso, e la pagina non deve mostrargli un errore.
  return S.json(ok ? 200 : 202, cors, { salvato: ok });
}

async function banda(body, cors) {
  const dati = await D.banda(testoBreve(body.marca), testoBreve(body.categoria));
  return S.json(200, cors, { banda: dati });
}

// Il tasto del codice. Leggerlo lo puo' fare chiunque abbia una sessione -
// serve alla pagina per disegnare l'interruttore nella posizione giusta -
// ma per girarlo bisogna sapere il codice, in un senso e nell'altro. Con il
// sito aperto, il codice e' quello che permette di richiuderlo.
async function impostazioni(body, headers, cors) {
  const attivo = async () => (await D.impostazione('pin_attivo')) !== '0';

  if (!body.cambia) {
    return S.json(200, cors, { pinDisponibile: S.pinRichiesto(), pinAttivo: S.pinRichiesto() && await attivo() });
  }

  if (!S.pinRichiesto()) {
    return S.json(409, cors, { error: 'Nessun codice impostato sul server (ALBA_PIN): non c\'e\' niente da accendere.' });
  }
  if (!S.pinGiusto(headers['x-alba-pin'])) {
    return S.json(401, cors, { error: 'Serve il codice per cambiare questa impostazione.', codice: 'pin' });
  }

  const valore = body.valore ? '1' : '0';
  const ok = await D.impostaImpostazione('pin_attivo', valore);
  if (!ok) return S.json(502, cors, { error: 'Il deposito non ha accettato la modifica.' });
  return S.json(200, cors, { pinDisponibile: true, pinAttivo: valore === '1' });
}
