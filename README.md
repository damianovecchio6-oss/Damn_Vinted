# Damn Vinted

Assistente per vendere su Vinted: analizza le foto di un capo, cerca online
quanto vale davvero, scrive l'annuncio e stima il prezzo. Sito statico + tre
Netlify Function.

```
public/index.html             tutta l'interfaccia (markup, stile, script)
public/_headers               header di sicurezza (CSP, ecc.)
netlify/functions/claude.js   proxy verso i modelli AI (Groq / Gemini)
netlify/functions/lens.js     ricerca per immagine (Google Lens via SerpApi)
netlify/functions/ricerca.js  ricerca testuale online, lo strumento dell'agente
netlify/functions/lib/        codice condiviso dalle function
tests/                        suite di test, nessun framework
```

Il sito non ha build ne' dipendenze a runtime: `public/index.html` si apre e
funziona. Il publish dir e' `public/` e non la root del repo, cosi' il sorgente
delle function e i test non finiscono serviti come file statici.

## Test

```
npm install     # solo playwright-core, i browser non vengono scaricati
npm test
```

279 controlli, nessun framework: ogni file in `tests/` e' uno script che stampa
quanti controlli sono passati ed esce con codice diverso da zero se qualcosa non
torna. Le suite delle function girano offline, con `https` sostituito da uno
stub, quindi non serve nessuna chiave per eseguirli. Quelle dell'interfaccia
guidano Chromium: se non lo trova, imposta `CHROMIUM_PATH` o
`PLAYWRIGHT_BROWSERS_PATH`.

## Variabili d'ambiente

Si impostano su Netlify in **Site configuration > Environment variables**.
Solo la prima e' obbligatoria; le altre due accendono funzionalita' in piu' e
senza di loro il sito continua a funzionare come prima.

| Variabile | Serve a | Obbligatoria |
|---|---|---|
| `GROQ_API_KEY` | Scrittura annuncio, stima prezzo, e analisi foto se manca Gemini | Si' |
| `GEMINI_API_KEY` | Analisi foto: legge il testo delle etichette molto meglio | No |
| `SERPAPI_KEY` | Bottone "Identifica prodotto" e agente di ricerca online | No |

### GEMINI_API_KEY — analisi foto piu' accurata

Marca, composizione e taglia dovrebbero uscire dall'etichetta, non
dall'aspetto del capo. I modelli con visione disponibili su Groq sul testo
piccolo di un cartellino non ci arrivano, quindi finiscono per indovinare.

1. Vai su **aistudio.google.com**, accedi con un account Google.
2. **Get API key** > **Create API key**.
3. Incolla la chiave in `GEMINI_API_KEY` su Netlify.

Piano gratuito: nessuna carta richiesta, con un tetto di richieste al giorno
per modello. Se la quota finisce, la function ripiega su Groq da sola.
Nota: sul piano gratuito Google usa i dati inviati per migliorare i propri
prodotti. Sono foto di vestiti, ma e' giusto saperlo.

### SERPAPI_KEY — identificazione del prodotto e agente di ricerca

Accende due cose. La prima e' il bottone "Identifica prodotto" sotto l'analisi:
cerca la foto con Google Lens, riporta i prodotti riconosciuti con i loro
prezzi di listino, e quei prezzi finiscono nel prompt della stima come dato di
mercato vero. La seconda e' la scheda **Ricerca**, cioe' l'agente (vedi sotto).

1. Vai su **serpapi.com**, registrati.
2. Copia la chiave dalla dashboard (**Your Account > API Key**).
3. Incollala in `SERPAPI_KEY` su Netlify.

Piano gratuito: 250 ricerche al mese, condivise fra le due funzionalita': un
giro dell'agente ne consuma da due a tre. Senza la chiave le function
rispondono 501 e la pagina nasconde da sola il bottone e il pulsante di avvio
dell'agente.

### Le altre, tutte opzionali

| Variabile | Default | A cosa serve |
|---|---|---|
| `GROQ_MODEL_TEXT` | `openai/gpt-oss-120b` | Fissa il modello di testo |
| `GROQ_MODEL_VISION` | `meta-llama/llama-4-scout-17b-16e-instruct` | Fissa il modello con visione di Groq |
| `GEMINI_MODEL` | scelto dal catalogo | Fissa il modello Gemini |
| `RATE_LIMIT_PER_MIN` | `20` | Richieste al minuto per IP (`0` disattiva) |
| `AI_TIMEOUT_MS` | `9000` | Budget di una richiesta AI |
| `LENS_TIMEOUT_MS` | `9000` | Budget di una ricerca per immagine |
| `RICERCA_TIMEOUT_MS` | `9000` | Budget di una ricerca online dell'agente |
| `SESSION_SECRET` | derivato da `GROQ_API_KEY` | Firma dei token di sessione |
| `ALLOWED_ORIGINS` | vuoto | Domini extra ammessi, separati da virgola |

I nomi dei modelli cambiano spesso, e i provider li ritirano senza preavviso:
per questo le function non si fidano dei valori di default. Se il modello non
esiste piu' chiedono il catalogo e ripiegano da sole, e il modello che ha
davvero risposto compare sotto il risultato dell'analisi.

## L'agente di ricerca online

La scheda **Ricerca** non fa una domanda sola all'AI: fa un giro completo, e lo
racconta passo per passo mentre lo fa.

1. **Pianifica** — dai dati del capo il modello scrive fino a tre ricerche per
   Google, pensate per far uscire annunci veri con un prezzo. Se il modello non
   risponde in JSON, l'agente cerca lo stesso con le query ovvie invece di
   fermarsi.
2. **Cerca** — le query partono in parallelo verso `ricerca.js`, che le gira a
   SerpApi sul dominio italiano e riporta titolo, fonte, link, snippet e il
   prezzo, letto anche dentro lo snippet quando il risultato non ne dichiara uno.
3. **Raffina** — se i prezzi raccolti sono meno di quattro fa un secondo giro,
   e per scrivere la query nuova guarda cosa ha gia' trovato e le ricerche
   correlate che ha suggerito Google. Un solo giro in piu': ogni ricerca costa
   quota.
4. **Scrive il rapporto** — prezzo consigliato, range, mediana degli annunci,
   fiducia dichiarata, osservazioni che citano i risultati per numero. Sotto
   resta la stessa lista numerata che ha letto il modello: il "(3)" del
   rapporto e la terza riga sono lo stesso annuncio, con il suo link. Le sue
   conclusioni si controllano una per una.

Il ciclo gira nel browser, non dentro una function: Netlify le chiude a 10s e
un giro intero non ci starebbe. Ogni passo e' una chiamata corta per conto suo.

Il rapporto poi alimenta la stima prezzo: prezzi trovati e conclusione
dell'agente entrano nel prompt come dati di mercato veri al posto della memoria
del modello. Ma solo se la scheda Prezzo parla dello stesso capo: si stimano
piu' capi di seguito, e una stima sbagliata costruita su numeri "veri" e'
peggio di una stima senza numeri. Il bottone "Usa per la stima prezzo" porta
di la' anche nome e marca; foto nuove azzerano tutto.

Ogni rapporto finisce nello storico insieme all'annuncio e alla stima dello
stesso capo.

## Come si usa l'analisi foto

Fino a 4 foto. Il marcatore 🏷️ su un'anteprima dice "questa e' l'etichetta":
quella foto viene mandata **a parte e a piena risoluzione**, con una richiesta
che chiede solo di trascrivere quello che c'e' scritto. Quello che si legge
sull'etichetta sovrascrive quello che il modello ha dedotto guardando il capo.

Senza marcatore l'analisi funziona lo stesso, ma marca, composizione e taglia
restano una deduzione dall'aspetto - cioe' la cosa che sbagliava di piu'.
