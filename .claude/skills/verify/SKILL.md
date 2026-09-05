---
name: verify
description: Guida il sito vero in Chromium e guarda cosa succede, invece di far girare le suite. Usala quando serve la prova che una modifica funziona davvero in pagina - dopo aver toccato public/index.html o public/app.js - e per raccogliere le fotografie da mostrare. Per far girare le suite c'e' "collaudo"; questa apre il sito e ci mette dentro le dita.
---

# Guardare il sito mentre gira

`npm test` dice che le suite passano. Questa skill serve all'altra domanda: **si
vede? funziona sotto il dito?** Le due cose non coincidono - un'animazione puo'
avere tutti i controlli verdi e sfarfallare lo stesso, perche' il controllo
guardava il momento sbagliato.

## L'aggancio

Non serve un server di sviluppo: il sito e' statico e le suite hanno gia' quello
che serve.

```js
const L = require('/home/user/Damn_Vinted/tests/lib');           // serviSito + chromium()
const { chromium } = require('/home/user/Damn_Vinted/node_modules/playwright-core');
const server = await L.serviSito(8971);                          // porta libera, una per script
const b = await chromium.launch({ executablePath: L.chromium(), args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
```

Due cose da sapere prima di partire:

- **La guida si apre da sola alla prima visita** e copre tutto. Se non e' lei
  l'oggetto della prova, spegnila come fanno le suite:
  `await L.senzaGuida(page)` **prima** della `goto`.
- **Le function non girano in locale.** La pagina e' quella vera, la risposta la
  fa una rotta:
  `page.route('**/.netlify/functions/claude', ...)` — GET restituisce
  `{token, expiresIn}`, POST il JSON del risultato. Senza, i bottoni AI danno
  errore e non si arriva mai al risultato.

## Le dita

Il puntatore non basta: la ghiera si gira col dito, e Chromium a volte
sopprime il click sintetico dopo un giro. Per i tocchi veri, CDP:

```js
const cdp = await ctx.newCDPSession(page);
await cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x,y}] });
// ...touchMove lungo la corona, raggio ~0.36 della larghezza di #soleApp...
await cdp.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
```

`tests/tocco.js` ha il giro gia' scritto: copiarlo da li' costa meno che
rifarlo.

## Cosa vale la pena guidare

- **Prima visita**: la guida in due finestre, Avanti/Indietro/Esc, il "?" che la
  riapre.
- **La ghiera**: un giro intero col dito, e il tasto centrale.
- **La mascot**: entrata, passeggio (due misure a distanza di secondi), tocco.
- **Un giro completo di una funzione**: campi, bottone, risultato in pagina.
- **Le misure scomode**: 320x568 (le finestre ci stanno?), paesaggio 740x380
  (il sole si accavalla a qualcosa?), 1280 (l'app e' pensata per il telefono).
- **`reducedMotion: 'reduce'`** e **localStorage negato**
  (`Object.defineProperty(window,'localStorage',{get(){throw 0}})`): due
  contesti dove la pagina deve reggere lo stesso.

## Le prove

Fotografie, non ricordi. `page.screenshot({ clip })` sull'angolo che interessa,
e per le animazioni una raffica di scatti ravvicinati montati in striscia: e'
l'unico modo di far vedere uno sfarfallio a chi non era li'.

Le animazioni con `steps()` si contano meglio strumentando la pagina - avvolgere
`sw` o `entrata` e registrare i tempi - che a occhio.
