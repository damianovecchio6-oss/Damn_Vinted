// L'adattatore fra le due case. Le function sono scritte nella forma di
// Netlify - una funzione che riceve un `event` e torna { statusCode, headers,
// body } - e quella forma resta la sola: e' quella che i test chiamano
// direttamente, senza rete e senza browser. Su Vercel una function e' invece
// una `(req, res)` di Node, e questo file traduce l'una nell'altra.
//
// Tradurre invece di riscrivere e' voluto: due copie della stessa function,
// una per host, si sarebbero scollate al primo ritocco - e a scollarsi
// sarebbe stato il controllo dell'origine o del token, cioe' la parte che non
// deve mai divergere.

// Il corpo, come stringa. Vercel legge lo stream e lo parsa da solo quando il
// Content-Type e' JSON: in quel caso lo stream e' gia' finito e rileggerlo
// darebbe vuoto, quindi si ricompone da req.body. Quando invece il corpo non
// e' stato toccato, si legge dallo stream come si e' sempre fatto.
function corpoDi(req) {
  // Una GET non ha mai un corpo qui dentro (nessuna function ne legge uno per
  // quel metodo), quindi non serve ne' fidarsi di req.body ne' toccare lo
  // stream. Se la piattaforma avesse gia' consumato lo stream per decidere
  // che non c'era niente da parsare, mettersi in ascolto ora - dopo che 'end'
  // e' gia' passato - non lo farebbe mai piu' arrivare, e la richiesta
  // resterebbe appesa per sempre invece che tornare vuota subito.
  if (req.method === 'GET' || req.method === 'HEAD') return Promise.resolve('');
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return Promise.resolve(req.body);
    if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body.toString('utf8'));
    return Promise.resolve(JSON.stringify(req.body));
  }
  return new Promise((resolve, reject) => {
    let dati = '';
    req.setEncoding('utf8');
    req.on('data', pezzo => { dati += pezzo; });
    req.on('end', () => resolve(dati));
    req.on('error', reject);
  });
}

function query(req) {
  const out = {};
  try {
    const url = new URL(req.url || '/', 'http://interno');
    for (const [k, v] of url.searchParams) out[k] = v;
  } catch (e) {}
  return out;
}

function adatta(handler) {
  return async (req, res) => {
    let risposta;
    try {
      risposta = await handler({
        httpMethod: req.method,
        headers: req.headers,
        queryStringParameters: query(req),
        // Vercel consegna il corpo gia' decodificato: il base64 e' una cosa
        // del formato di Netlify, e qui non c'e' mai.
        isBase64Encoded: false,
        body: await corpoDi(req)
      });
    } catch (e) {
      // Se il preambolo condiviso lancia, la richiesta non deve restare
      // appesa fino al timeout della piattaforma: un 500 detto subito e' piu'
      // onesto di una connessione che muore da sola.
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'Errore interno' }));
    }
    const r = risposta || {};
    res.statusCode = r.statusCode || 200;
    for (const nome of Object.keys(r.headers || {})) res.setHeader(nome, r.headers[nome]);
    res.end(r.body === undefined || r.body === null ? '' : r.body);
  };
}

module.exports = adatta;
