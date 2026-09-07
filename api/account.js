// La function su Vercel. Il codice vero sta in netlify/functions/account.js e
// non e' duplicato qui: questo file esiste solo perche' Vercel guarda in
// api/, e prende la forma (req, res) invece di quella a event.
const { handler } = require('../netlify/functions/account');
const adatta = require('../netlify/functions/lib/vercel');

module.exports = adatta(handler);
