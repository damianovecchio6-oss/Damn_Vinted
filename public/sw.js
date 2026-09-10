// Il service worker: e' questo che fa la differenza tra un sito aperto a
// schermo intero e un'applicazione. Tiene da parte il guscio - la pagina, lo
// script, i disegni - cosi' che ALBA si apra anche in metro, e sopravviva a
// una rete che va e viene mentre stai fotografando un capo.
//
// Quello che NON tiene da parte sono le function: le risposte dell'AI, i
// prezzi trovati online e il token di sessione sono roba di adesso, e servirla
// dalla cache vorrebbe dire mostrare la stima di ieri per la foto di oggi.
// Passano per la rete e basta.

// Il numero va alzato quando cambia il guscio: e' l'unica cosa che dice al
// browser "butta via quello che avevi". La cache vecchia viene cancellata
// all'attivazione, non prima: finche' la versione nuova non e' pronta, quella
// vecchia e' ancora l'unica che sa servire la pagina offline.
const VERSIONE = 'alba-v2';

// Il guscio: quello che deve esserci perche' l'app si apra da spenta. Le foto
// della mascot ci stanno perche' senza si aprirebbe una pagina a meta'; le
// icone perche' Android le rilegge quando gli pare.
const GUSCIO = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './img/sole.svg',
  './img/sole-luna.svg',
  './img/mascotte-a.webp',
  './img/mascotte-b.webp',
  './img/mascotte-occhiolino.webp',
  './img/mascotte-intro.webp',
  './img/icona-192.png',
  './img/icona-512.png',
  './img/icona-maskable.png',
  './img/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  // addAll fallisce tutta insieme se un solo file manca, e un'installazione
  // fallita lascia l'utente senza offline senza dirlo a nessuno: qui ogni
  // pezzo va per conto suo, e il guscio si riempie con quello che c'e'.
  e.waitUntil(caches.open(VERSIONE).then(async cache => {
    await Promise.all(GUSCIO.map(u => cache.add(u).catch(() => {})));
    // Senza questo la versione nuova resta in attesa finche' non chiudi tutte
    // le schede: su un'app che sta sempre aperta in home vuol dire mai.
    return self.skipWaiting();
  }));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const nomi = await caches.keys();
    await Promise.all(nomi.filter(n => n !== VERSIONE).map(n => caches.delete(n)));
    // Prende in carico le pagine gia' aperte: senza, la prima visita dopo
    // l'installazione resta scoperta fino al ricaricamento.
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Fuori dal nostro dominio non ci mettiamo in mezzo: le immagini dei
  // risultati di ricerca arrivano da Google, e non sono nostre da conservare.
  if (url.origin !== self.location.origin) return;
  // Le function: /api/ e' la strada di oggi, /.netlify/ quella di quando il
  // sito stava solo su Netlify. Restano fuori dalla cache tutte e due, o una
  // pagina vecchia in home continuerebbe a chiamare la seconda e si vedrebbe
  // servire la risposta dell'altro ieri.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;

  // La pagina: prima la rete, cosi' chi ha campo vede sempre l'ultima
  // versione; la copia in cache e' la rete di sicurezza, non la regola.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const risposta = await fetch(req);
        // Un 500 del host, o la pagina di un captive portal servita con 200:
        // senza questo controllo diventava lei la copia offline, e ci restava
        // finche' qualcuno non svuotava i dati del sito a mano.
        if (risposta && risposta.ok) {
          const cache = await caches.open(VERSIONE);
          cache.put('./index.html', risposta.clone());
        }
        return risposta;
      } catch (err) {
        const cache = await caches.open(VERSIONE);
        return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Tutto il resto - script, disegni, manifest - dalla cache subito, e intanto
  // si controlla se e' cambiato. La pagina parte alla velocita' del disco, e
  // al giro dopo ha la roba nuova.
  e.respondWith((async () => {
    const cache = await caches.open(VERSIONE);
    const salvata = await cache.match(req);
    const dallaRete = fetch(req).then(risposta => {
      if (risposta && risposta.ok) cache.put(req, risposta.clone());
      return risposta;
    }).catch(() => null);
    // Quando c'e' gia' una copia in cache, dallaRete resta in volo dopo che
    // respondWith ha gia' risposto: senza extendere l'evento il browser puo'
    // chiudere il worker prima che il cache.put finisca, e l'aggiornamento
    // si perde in silenzio - il sito resta sulla versione vecchia finche' non
    // arriva un ricaricamento forzato.
    e.waitUntil(dallaRete);
    return salvata || (await dallaRete) || Response.error();
  })());
});
