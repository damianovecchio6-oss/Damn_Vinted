---
name: collaudo
description: Collauda Damn Vinted da cima a fondo e dice se va o no. Usala quando serve sapere se il sito funziona - prima di unire un branch, dopo un deploy, dopo aver toccato public/index.html o le function, o quando qualcuno dice "non funziona". Esegue le suite (mouse e dito), sa leggere i fallimenti, e se le viene dato un URL controlla anche il sito pubblicato e le sue chiavi.
---

# Collaudo di Damn Vinted

Lo scopo e' arrivare a una risposta sola: **va** oppure **non va, ed ecco cosa**.
Non "sembra a posto".

## 1. Le suite

```
npm install     # solo se manca node_modules: playwright-core, nessun browser
npm test
```

`npm test` esegue le suite e stampa il totale. Le prime cinque girano offline
con `https` sostituito da uno stub, le altre guidano Chromium.

| suite | cosa protegge |
|---|---|
| `fn.js` | metodi, origine, token, rate limit delle function |
| `models.js` `gemini.js` | scelta del modello e ripieghi quando un provider cade |
| `lens.js` `ricerca.js` | le due ricerche: richieste a SerpApi, prezzi, cache, errori |
| `ui.js` `photo.js` `nuove.js` | interfaccia, analisi foto, etichetta |
| `agente.js` | il ciclo dell'agente: piano, ricerche, raffinamento, rapporto |
| `scanner.js` | lo scanner: identita' con le fonti, usato separato dal nuovo, giri di ricerca, banda dei prezzi |
| `prezzi.js` | i conti sui prezzi chiamati direttamente: quantile pesato, peso delle prove, casi limite, calibrazione dagli esiti |
| `interazioni.js` | ghiera, sole parcheggiato, attesa, focus, vibrazione, motion |
| `tocco.js` | **gli stessi gesti col dito vero**, su un Chromium in modalita' telefono |

In `scanner.js` i controlli che contano davvero sono quelli sulla separazione
fra usato e nuovo, sullo scarto degli estremi e sui risultati fuori tema: sono
la ragione per cui lo scanner esiste, e un errore li' esce come un prezzo
sbagliato costruito su numeri veri - la forma di guasto piu' difficile da
vedere a occhio.

`prezzi.js` guarda gli stessi conti di `scanner.js` ma da sotto, chiamando le
funzioni una per una: serve per i casi che un giro normale non produce quasi
mai - un annuncio solo, sei annunci allo stesso prezzo, un peso enorme, una
voce di storico storta. Li' un errore non esce come un'eccezione, esce come un
prezzo, e un prezzo sbagliato non si distingue da uno giusto guardandolo.

`tocco.js` esiste perche' un bug e' passato da tutte le altre: col puntatore
andava, sul telefono il click che il browser sintetizza dopo un tocco non
arrivava. Se tocchi qualcosa che riguarda gesti, tocchi o puntatore, quella
suite e' quella che conta.

## 2. Come si legge un fallimento

Il runner stampa solo le suite rosse. Per vedere i singoli controlli, rilancia
la suite da sola:

```
node tests/interazioni.js
```

Ogni riga e' `ok` o `FAIL <nome del controllo> -> <valore visto>`. Il valore
visto e' quasi sempre la risposta: non serve aggiungere log.

Due fallimenti che **non** sono bug del sito:

- `Chromium non trovato` - manca il browser: imposta `CHROMIUM_PATH`, oppure
  `PLAYWRIGHT_BROWSERS_PATH` alla cartella dei browser di Playwright.
- Un fallimento che sparisce rilanciando la stessa suite da sola, su una
  macchina carica: guarda se il controllo dipende dal tempo prima di dargli la
  colpa. (Nel dubbio, quello del rate limit congela l'orologio apposta.)

Tutto il resto e' un bug: **non si sistema il test per farlo passare**. Se il
controllo dice il vero e il codice no, si aggiusta il codice - e per farlo c'e'
`.claude/skills/riparazione/`, con la mappa sintomo -> dove guardare e le regole
di cosa non si tocca. Il collaudo dice se va; la riparazione lo rimette a posto.

## 3. Il sito pubblicato

Se ti viene dato un URL (o se il deploy e' appena andato):

```
npm run verifica -- https://iltuosito.netlify.app
```

Controlla pagina, function, origini rifiutate e - la parte che nessun test
offline puo' fare - **se le chiavi funzionano davvero**. Consuma una ricerca
SerpApi e una richiesta AI.

Da qui dentro il sito potrebbe non essere raggiungibile: se la rete blocca
`netlify.app`, dillo invece di dare per buono il deploy. Quello che si puo'
sempre verificare e' che il deploy sia `ready` e su che commit sta.

## 4. Il rapporto

Scrivi, in quest'ordine:

1. **Verdetto**: va / non va.
2. Il totale dei controlli e quante suite sono rosse.
3. Per ogni fallimento: la suite, il nome del controllo e il valore visto.
4. Cosa resta scoperto: quello che i test non guardano e che va provato a mano
   (per esempio un gesto su un telefono vero, o una chiave che non c'e').

Se non hai potuto verificare qualcosa, scrivilo. Un collaudo che tace su un
pezzo non verificato e' peggio di uno che fallisce.
