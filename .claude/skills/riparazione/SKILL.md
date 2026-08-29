---
name: riparazione
description: Trova la causa di un guasto in Damn Vinted e lo aggiusta, dalle function all'interfaccia. Usala quando un test fallisce, quando la CI e' rossa, o quando qualcosa non funziona sul sito - anche se non e' un problema grafico. Contiene la mappa sintomo -> dove guardare, le regole di cosa non si tocca mai, e il giro completo fino ai test verdi.
---

# Riparare Damn Vinted

Il giro e' sempre lo stesso: **riprodurre, capire, aggiustare la causa,
riverificare**. Se salti il primo passo stai indovinando.

## 1. Riprodurre

Un guasto che non hai visto succedere non lo puoi aggiustare.

- Test rosso: `node tests/<suite>.js` da solo. La riga `FAIL <controllo> -> <valore visto>` dice quasi sempre tutto.
- CI rossa: leggi il log del job fallito, non il riassunto.
- Segnalazione a voce ("non funziona il tasto"): scrivi **prima** un controllo che fallisce, poi aggiusta. Se non riesci a farlo fallire, non hai capito il guasto.

Un guasto che non sai riprodurre non e' risolto: e' sparito da solo, e tornera'.

**Un controllo che esplode invece di fallire nasconde la causa.** Se una suite si
ferma con un `TypeError` a meta', l'eccezione si porta via tutte le righe dopo -
spesso proprio quelle che spiegavano il guasto. Quando succede, la prima
riparazione e' il controllo: deve fallire e stampare il valore visto, non
lanciare. `(x || {}).campo` invece di `x.campo` costa niente e salva un'ora.

## 2. La mappa: sintomo -> dove guardare

**Le function** (`netlify/functions/`)

| sintomo | dove |
|---|---|
| 401 a caso, sessione che scade | `lib/shared.js`, token firmato con l'IP e 15 minuti di vita |
| 403 da un dominio legittimo | `isSameSite`/`ALLOWED_ORIGINS` in `shared.js` |
| 429 improvvisi | rate limit per IP, 20/min, finestra scorrevole |
| "nessun modello disponibile" | `claude.js`: catalogo, cache positiva 30 min e negativa 5 min |
| l'analisi foto peggiora | `claude.js`: e' passata da Gemini a Groq? Il modello che ha risposto e' scritto sotto il risultato |
| prezzi che non vengono letti | `ricerca.js`, `PREZZO_RE`: gli annunci scrivono l'euro in quattro modi |
| ricerche doppie, quota che vola | cache per query+tipo, 10 minuti |
| tutto lento o 504 | il budget e' 10s per function: **mai due chiamate AI in fila dentro la stessa** |

**L'interfaccia** (`public/index.html`, un file solo)

| sintomo | dove |
|---|---|
| un tocco non fa niente sul telefono ma col mouse si | il click sintetizzato non arriva sempre: l'attivazione sta sul `pointerup` |
| la ghiera si blocca dopo un giro | trascinamento nativo del disegno, fermato su `dragstart` |
| un raggio si apre da solo finendo un giro | la guardia `giroConScatti`, che si azzera a ogni tocco nuovo |
| lo storico perde dei campi | `soloNoti()`: un patch non cancella quello che non contiene |
| dati di un capo nella stima di un altro | `stessoCapo()` |
| risorse esterne che non caricano una volta pubblicate | la CSP in `public/_headers` |

**Il deploy**

| sintomo | dove |
|---|---|
| il sorgente delle function servito come pagina | `netlify.toml`: il publish dir resta `public/` |
| una chiave "impostata" che non funziona | le function leggono l'ambiente **al deploy**: dopo averla messa serve un deploy nuovo |

## 3. Cosa non si tocca

Questi non sono gusti: sono i modi in cui una riparazione fa piu' danno del guasto.

- **Non si aggiusta un test per farlo passare.** Se il controllo dice il vero e il codice no, si cambia il codice. Se il controllo e' davvero sbagliato, si cambia dicendolo a voce alta e spiegando perche' - mai di nascosto dentro un commit che parla d'altro.
- **Non si abbassano i controlli delle function**: origine, token, rate limit, limiti di dimensione. Se un test fallisce li', il guasto e' altrove.
- **Non si allarga la CSP** per far funzionare qualcosa: prima chiediti se quella risorsa esterna serve davvero.
- **Non si toccano chiavi e variabili d'ambiente** per aggirare un errore.
- **Non si riscrive quello che funziona** mentre si aggiusta altro: una causa per volta, diff piccolo.
- **Non si dichiara verde quello che non si e' eseguito.**

## 4. Quando fermarsi e chiedere

Aggiustare da soli va bene finche' la risposta e' tecnica. Serve una persona quando:

- la correzione cambia **come si comporta il prodotto** (un prezzo calcolato diversamente, un passaggio in piu' o in meno per l'utente);
- il guasto e' **fuori dal codice**: una chiave scaduta, la quota SerpApi finita, un provider che ha ritirato un modello;
- ci sono **due modi ragionevoli** e la scelta e' di gusto;
- per aggiustare servirebbe **disattivare un controllo**.

In quei casi: descrivi la causa, proponi la correzione, e fermati.

## 5. Chiudere

1. `npm test` intero, non solo la suite che avevi rotto.
2. Se hai aggiustato un guasto che nessun test vedeva, **aggiungi il controllo che l'avrebbe visto**. Il bug del tocco sul telefono e' passato da sei suite: quella settima e' nata cosi'.
3. Commit che dice **cosa non andava**, non "fix". La riga del test che falliva e' un'ottima prima riga.
4. Se e' roba da pubblicare: push, e guarda la CI. Rossa la' e verde qui vuol dire che dipendi da qualcosa della tua macchina.
