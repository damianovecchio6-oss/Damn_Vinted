// Un processo a parte per la meta' della suite del mercato che ha bisogno di
// ALBA_PIN: il codice si legge una volta sola all'avvio, e in un solo processo
// non si puo' provare com'e' il mondo con e senza. Stampa una riga per prova,
// nell'ordine che tests/mercato.js si aspetta.
const https = require('https');
const { EventEmitter } = require('events');

let risposte = [], scritte = [];
https.request = function (opts, cb) {
  const req = new EventEmitter();
  let corpo = '';
  req.write = c => { corpo += c; };
  req.destroy = () => {};
  req.end = function () {
    setImmediate(() => {
      if (opts.method === 'POST' && /impostazioni/.test(opts.path)) scritte.push(JSON.parse(corpo));
      const out = risposte.shift() || { status: 200, body: '[]' };
      const res = new EventEmitter();
      res.statusCode = out.status; res.setEncoding = () => {};
      cb(res); res.emit('data', out.body); res.emit('end');
    });
    return req;
  };
  return req;
};

const path = require('path');
const L = require('./lib');
const S = require(path.join(L.FUNCTIONS, 'lib', 'shared.js'));
const D = require(path.join(L.FUNCTIONS, 'lib', 'deposito.js'));
const mercato = require(L.funzione('mercato.js'));
const claude = require(L.funzione('claude.js'));

const SITE = process.env.URL, HOST = new URL(SITE).host, IP = '7.0.0.1';
const hdr = extra => Object.assign({ origin: SITE, host: HOST, 'x-nf-client-connection-ip': IP,
  'x-session-token': S.issueToken(IP) }, extra || {});
const post = (body, extra) => mercato.handler({ httpMethod: 'POST', headers: hdr(extra), body: JSON.stringify(body) });
const dati = r => JSON.parse(r.body);

(async () => {
  // 1. lo stato: il codice c'e' e l'interruttore e' acceso
  D.scordaImpostazioni();
  risposte = [{ status: 200, body: JSON.stringify([{ valore: '1' }]) }];
  let r = await post({ azione: 'impostazioni' });
  console.log(dati(r).pinDisponibile && dati(r).pinAttivo ? 'mostra' : 'no');

  // 2. girarlo senza portare il codice
  D.scordaImpostazioni();
  risposte = [{ status: 200, body: JSON.stringify([{ valore: '1' }]) }];
  r = await post({ azione: 'impostazioni', cambia: true, valore: false });
  console.log(String(r.statusCode));

  // 3. col codice giusto si spegne, e il deposito riceve lo '0'
  D.scordaImpostazioni();
  risposte = [{ status: 201, body: '' }];
  r = await post({ azione: 'impostazioni', cambia: true, valore: false }, { 'x-alba-pin': '4271' });
  const scritto = scritte.length && scritte[scritte.length - 1][0];
  console.log(r.statusCode === 200 && dati(r).pinAttivo === false && scritto && scritto.valore === '0' ? 'spento' : 'no ' + r.body);

  // 4. da spento il token esce senza codice (la cache tiene lo '0' appena scritto)
  r = await claude.handler({ httpMethod: 'GET', headers: hdr(), body: '' });
  console.log(r.statusCode === 200 && dati(r).token ? 'aperta' : 'no ' + r.statusCode);

  // 5. riacceso, il codice torna a servire
  D.scordaImpostazioni();
  risposte = [{ status: 200, body: JSON.stringify([{ valore: '1' }]) }];
  r = await claude.handler({ httpMethod: 'GET', headers: hdr(), body: '' });
  console.log(r.statusCode === 401 && dati(r).codice === 'pin' ? 'chiusa' : 'no ' + r.statusCode);
})();
