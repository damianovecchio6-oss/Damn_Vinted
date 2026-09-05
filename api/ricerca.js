// La function su Vercel. Il codice vero sta in netlify/functions/ricerca.js e non
// e' duplicato qui: questo file esiste solo perche' Vercel guarda in api/, e
// prende la forma (req, res) invece di quella a event. Il nome della cartella
// di la' dice da dove viene, non dove gira.
const { handler } = require('../netlify/functions/ricerca');
const adatta = require('../netlify/functions/lib/vercel');

module.exports = adatta(handler);
