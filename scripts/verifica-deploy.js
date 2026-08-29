#!/usr/bin/env node
// Controlla un deploy vero: la pagina, le tre function, e quali chiavi sono
// arrivate davvero sul sito. Si usa dopo il primo deploy e dopo ogni modifica
// alle variabili d'ambiente.
//
//   node scripts/verifica-deploy.js https://il-tuo-sito.netlify.app
//
// Consuma una ricerca SerpApi (su 250 al mese) e una richiesta AI: e' il solo
// modo di sapere se le chiavi funzionano davvero invece di sembrare a posto.
const https = require('https');

const base = (process.argv[2] || '').trim().replace(/\/+$/, '');
if (!/^https:\/\/[^/]+$/.test(base)) {
  console.error('Uso: node scripts/verifica-deploy.js https://il-tuo-sito.netlify.app');
  process.exit(2);
}
const origin = base;
const host = new URL(base).host;

function chiamata(percorso, metodo, corpo, headers) {
  return new Promise((risolvi, rifiuta) => {
    const payload = corpo ? JSON.stringify(corpo) : null;
    const req = https.request({
      hostname: host,
      path: percorso,
      method: metodo,
      timeout: 30000,
      headers: Object.assign({
        'Origin': origin,
        'Content-Type': 'application/json'
      }, payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}, headers || {})
    }, res => {
      let dati = '';
      res.setEncoding('utf8');
      res.on('data', c => { dati += c; });
      res.on('end', () => risolvi({ status: res.statusCode, body: dati }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', rifiuta);
    if (payload) req.write(payload);
    req.end();
  });
}

const json = res => { try { return JSON.parse(res.body); } catch { return null; } };

// Un sito che non risponde puo' essere rotto, spento, o semplicemente dietro a
// una rete che non lo lascia passare: sono cose diverse e vanno dette diverse.
function motivoIrraggiungibile(res) {
  const corpo = (res.body || '').slice(0, 300);
  if (/not in allowlist|egress|proxy/i.test(corpo)) {
    return `la rete da cui stai lanciando il controllo non raggiunge questo host `
         + `(HTTP ${res.status}: ${corpo.trim()}). Non e' un problema del sito: `
         + `rilancia da una rete senza filtri.`;
  }
  if (res.status === 0) return `nessuna risposta: ${corpo || 'connessione fallita'}`;
  if (res.status === 404) return `HTTP 404: l'indirizzo esiste ma non serve niente. Nome del sito giusto?`;
  if (res.status >= 500) return `HTTP ${res.status}: il sito risponde ma con un errore. Guarda i log del deploy su Netlify.`;
  return `HTTP ${res.status}. ${corpo.trim()}`;
}

let ok = 0, ko = 0;
const esito = (nome, passato, dettaglio) => {
  if (passato) { ok++; console.log(`  ok   ${nome}`); }
  else { ko++; console.log(`  KO   ${nome}${dettaglio ? '\n       ' + dettaglio : ''}`); }
};

(async () => {
  console.log(`\nControllo ${base}\n`);

  console.log('-- il sito --');
  const pagina = await chiamata('/', 'GET');

  // Se la pagina non arriva, tutto quello che verrebbe dopo sarebbe una
  // diagnosi inventata su una risposta che non c'e': "manca la scheda
  // Ricerca", "publish dir sbagliato". Meglio una riga sola che dice la
  // verita' - non ho raggiunto il sito - che quattro righe che accusano il
  // deploy di colpe che non ha.
  if (pagina.status !== 200) {
    esito('la pagina risponde', false, motivoIrraggiungibile(pagina));
    console.log('\nMi fermo qui: senza la pagina, i controlli che seguono non');
    console.log('direbbero niente sul sito, solo su questa connessione.');
    fine();
    return;
  }
  esito('la pagina risponde', true);
  esito('e\' la versione con l\'agente', /AGENTE DI RICERCA/i.test(pagina.body),
    'la pagina non contiene la scheda Ricerca: il deploy e\' di un commit piu\' vecchio');
  esito('il sorgente delle function non e\' servito come file statico',
    (await chiamata('/netlify/functions/ricerca.js', 'GET')).status === 404,
    'publish dir sbagliato in netlify.toml: deve restare "public"');

  console.log('\n-- sessione --');
  const sessione = await chiamata('/.netlify/functions/claude', 'GET');
  const token = (json(sessione) || {}).token;
  esito('la function claude rilascia un token', sessione.status === 200 && !!token,
    `HTTP ${sessione.status} ${sessione.body.slice(0, 160)}`);
  if (!token) { fine(); return; }
  const conToken = { 'X-Session-Token': token };

  esito('senza token la ricerca risponde 401',
    (await chiamata('/.netlify/functions/ricerca', 'POST', { query: 'prova' })).status === 401);
  esito('da un\'altra origine risponde 403',
    (await chiamata('/.netlify/functions/ricerca', 'POST', { query: 'prova' },
      { Origin: 'https://sito-estraneo.tld' })).status === 403);

  console.log('\n-- chiavi --');
  const ai = await chiamata('/.netlify/functions/claude', 'POST',
    { type: 'text', prompt: 'Rispondi solo con: ok' }, conToken);
  const testoAi = (json(ai) || {}).text;
  esito('GROQ_API_KEY / GEMINI_API_KEY funzionano', ai.status === 200 && !!testoAi,
    ai.status === 500 ? 'nessuna chiave AI impostata sul sito'
      : `HTTP ${ai.status} ${(json(ai) || {}).error || ai.body.slice(0, 160)}`);
  if (testoAi) console.log(`       ha risposto ${(json(ai) || {}).model} (${(json(ai) || {}).provider})`);

  const ricerca = await chiamata('/.netlify/functions/ricerca', 'POST',
    { query: 'felpa carhartt usata vinted' }, conToken);
  const datiRicerca = json(ricerca) || {};
  if (ricerca.status === 501) {
    esito('SERPAPI_KEY impostata', false,
      'manca SERPAPI_KEY: l\'agente e "Identifica prodotto" restano spenti, il resto del sito funziona');
  } else if (ricerca.status === 429) {
    esito('SERPAPI_KEY impostata', false, 'quota SerpApi esaurita per questo mese');
  } else {
    esito('SERPAPI_KEY funziona e la ricerca torna risultati',
      ricerca.status === 200 && Array.isArray(datiRicerca.risultati) && datiRicerca.risultati.length > 0,
      `HTTP ${ricerca.status} ${datiRicerca.error || ricerca.body.slice(0, 160)}`);
    if (datiRicerca.risultati) {
      const conPrezzo = datiRicerca.risultati.filter(r => r.prezzo).length;
      console.log(`       ${datiRicerca.risultati.length} risultati, ${conPrezzo} con prezzo leggibile`);
    }
  }

  fine();
})().catch(e => { console.error('\nControllo interrotto:', e.message); process.exit(1); });

function fine() {
  console.log(`\n${ok} controlli ok, ${ko} da sistemare`);
  process.exit(ko ? 1 : 0);
}
