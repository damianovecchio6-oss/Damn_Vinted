// Il service worker di PIANO. Registrato da /vita/, il suo raggio d'azione e'
// /vita/ e basta: ALBA, che sta sulla radice, ha il suo e non si toccano.
//
// Qui l'offline non e' un di piu': l'app non chiama nessuna rete per
// funzionare - i dati stanno in localStorage - quindi in cache ci va tutto
// quello che serve, e in metro si apre esattamente come a casa.

// Va alzato quando cambia il guscio: e' l'unica cosa che dice al browser
// "butta via quello che avevi".
const VERSIONE = 'piano-v1';

const GUSCIO = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './img/icona-192.png',
  './img/icona-512.png',
  './img/icona-maskable.png',
  './img/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  // addAll fallisce tutta insieme se un solo file manca, e un'installazione
  // fallita lascia senza offline senza dirlo a nessuno: qui ogni pezzo va per
  // conto suo, e il guscio si riempie con quello che c'e'.
  e.waitUntil(caches.open(VERSIONE).then(async cache => {
    await Promise.all(GUSCIO.map(u => cache.add(u).catch(() => {})));
    return self.skipWaiting();
  }));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const nomi = await caches.keys();
    // Solo le proprie: le cache di ALBA hanno un altro nome e non vanno
    // toccate, anche se da qui si vedono.
    await Promise.all(nomi.filter(n => n.startsWith('piano-') && n !== VERSIONE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Fuori da /vita/ non ci si mette in mezzo: se una pagina di ALBA passasse
  // di qui, finirebbe salvata come index.html di PIANO.
  if (!url.pathname.startsWith('/vita/')) return;

  // La pagina: prima la rete, cosi' chi ha campo vede sempre l'ultima
  // versione; la copia in cache e' la rete di sicurezza, non la regola.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const risposta = await fetch(req);
        const cache = await caches.open(VERSIONE);
        cache.put('./index.html', risposta.clone());
        return risposta;
      } catch (err) {
        const cache = await caches.open(VERSIONE);
        return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Tutto il resto - script, icone, manifest - dalla cache subito, e intanto
  // si controlla se e' cambiato.
  e.respondWith((async () => {
    const cache = await caches.open(VERSIONE);
    const salvata = await cache.match(req);
    const dallaRete = fetch(req).then(risposta => {
      if (risposta && risposta.ok) cache.put(req, risposta.clone());
      return risposta;
    }).catch(() => null);
    return salvata || (await dallaRete) || Response.error();
  })());
});
