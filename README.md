# Damn Vinted

Sulla pagina si chiama **ALBA**: il nome sta dentro al disco del sole, che non
se ne va mai dallo schermo. Il repo resta Damn Vinted.

Assistente per vendere su Vinted: analizza le foto di un capo, cerca online
quanto vale davvero, scrive l'annuncio e stima il prezzo. Lo **scanner** fa
tutto il giro da solo, dalle foto al prezzo. Sito statico + tre Netlify
Function.

```
public/index.html             tutta l'interfaccia (markup, stile, script)
public/_headers               header di sicurezza (CSP, ecc.)
public/img/                   i disegni: il sole e la versione sole+luna
netlify/functions/claude.js   proxy verso i modelli AI (Groq / Gemini)
netlify/functions/lens.js     ricerca per immagine (Google Lens via SerpApi)
netlify/functions/ricerca.js  ricerca testuale online, lo strumento dell'agente
netlify/functions/lib/        codice condiviso dalle function
tests/                        suite di test, nessun framework
.claude/                      skill e agenti: collaudo e riparazione
.github/workflows/            i test a ogni push
scripts/verifica-deploy.js    controlla un sito gia' deployato: function e chiavi
```

Le suite girano col mouse, tranne una: `tests/tocco.js` manda tocchi veri a un
Chromium in modalita' telefono. Serve, perche' il telefono non e' un mouse
piccolo: il click che il browser sintetizza dopo un tocco a volte non arriva, e
col solo mouse quel buco non si vede.

Il sito non ha build ne' dipendenze a runtime: `public/index.html` si apre e
funziona. Il publish dir e' `public/` e non la root del repo, cosi' il sorgente
delle function e i test non finiscono serviti come file statici.

## Test

```
npm install     # solo playwright-core, i browser non vengono scaricati
npm test
```

441 controlli, nessun framework: ogni file in `tests/` e' uno script che stampa
quanti controlli sono passati ed esce con codice diverso da zero se qualcosa non
torna. Le suite delle function girano offline, con `https` sostituito da uno
stub, quindi non serve nessuna chiave per eseguirli. Quelle dell'interfaccia
guidano Chromium: se non lo trova, imposta `CHROMIUM_PATH` o
`PLAYWRIGHT_BROWSERS_PATH`.

## Collaudo

Tre modi di sapere se il sito funziona, dal piu' automatico al piu' manuale.

**Da solo, a ogni push.** `.github/workflows/collaudo.yml` esegue `npm test` su
ogni push e su ogni pull request: installa Node 20 e Chromium e lancia le
suite. E' l'unico pezzo che non dipende da qualcuno che si ricordi di lanciarlo,
ed e' il motivo per cui una pull request qui ha un segno verde o rosso senza che
nessuno lo chieda.

**A voce, dentro Claude Code.** Due skill e due agenti, che fanno mezzo lavoro
ciascuno.

`/collaudo` dice **se va**: quali suite ci sono, cosa protegge ognuna, come si
legge un fallimento, quali fallimenti non sono bug del sito, che forma deve
avere il rapporto. L'agente `collaudatore` fa lo stesso giro da solo e riferisce
senza poter toccare niente.

`/riparazione` lo **rimette a posto**: la mappa sintomo -> dove guardare (le
function, l'interfaccia, il deploy), il giro riproduci-capisci-aggiusta-
riverifica, e soprattutto l'elenco di cosa non si tocca mai. L'agente
`riparatore` puo' modificare il codice, e per questo ha piu' regole degli altri:
non aggiusta un test per farlo tacere, non abbassa i controlli delle function,
non allarga la CSP, non pubblica niente, e si ferma a chiedere quando la
correzione cambierebbe il comportamento del prodotto o quando il guasto e' fuori
dal codice - una chiave scaduta, la quota finita, un modello ritirato.

**A mano, sul sito vero.** `npm run verifica -- <url>` (vedi
[Deploy su Netlify](#deploy-su-netlify)): e' l'unico che puo' dire se le chiavi
funzionano davvero, perche' le usa.

## Variabili d'ambiente

Si impostano su Netlify in **Site configuration > Environment variables**.
Solo la prima e' obbligatoria; le altre due accendono funzionalita' in piu' e
senza di loro il sito continua a funzionare come prima.

| Variabile | Serve a | Obbligatoria |
|---|---|---|
| `GROQ_API_KEY` | Scrittura annuncio, stima prezzo, e analisi foto se manca Gemini | Si' |
| `GEMINI_API_KEY` | Analisi foto: legge il testo delle etichette molto meglio | No |
| `SERPAPI_KEY` | Bottone "Identifica prodotto", agente di ricerca e scanner | No |

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

Piano gratuito: 250 ricerche al mese, condivise fra tutte: un giro dell'agente
ne consuma da due a tre, un giro dello scanner fino a sei. Senza la chiave le
function rispondono 501: la pagina nasconde da sola il bottone "Identifica
prodotto" e quello dell'agente, mentre lo scanner continua a funzionare a
meta' - riconosce il capo dalle foto e dice a chiare lettere che senza la
chiave non puo' controllare i prezzi.

### Le altre, tutte opzionali

| Variabile | Default | A cosa serve |
|---|---|---|
| `GROQ_MODEL_TEXT` | `openai/gpt-oss-120b` | Fissa il modello di testo |
| `GROQ_MODEL_VISION` | `qwen/qwen3.6-27b` | Fissa il modello con visione di Groq |
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

Attenzione a **come** arriva il ritiro: Groq lo annuncia con un **400**, non
con un 404 (`model_decommissioned`, `model_not_supported`). Chi tocca quel
riconoscimento si ricordi che guardare il solo 404 spegne tutto il ripiego, e
il sintomo che si vede e' un innocuo "Il modello ha rifiutato la richiesta".

I default qui sopra restano comunque da tenere vivi: il ripiego funziona, ma
partire da un modello morto costa un giro, e con le foto da caricare due volte
dentro i 9s della function quel giro puo' costare la risposta.

## Il sole

La pagina si apre su un sole, e i suoi raggi sono le funzioni: un tocco su un
raggio apre l'analisi foto, l'annuncio, la stima, la ricerca, lo storico o lo
scanner. Il
disegno arriva da uno storyboard a matita, ridisegnato al pulito tenendo i
raggi irregolari - lunghezza e larghezza diverse una dall'altra - perche' e'
quello che lo distingue da un'icona presa da un pacchetto.

I raggi non sono un'illustrazione con sopra dei bottoni: sono bottoni veri, con
la forma del raggio come area sensibile piu' una presa tonda intorno all'icona,
perche' un triangolo sottile col pollice non si prende. Funzionano con Tab e
Invio come con il dito.

E si girano come la ghiera dell'iPod classic: il dito ruota intorno al sole e la
selezione salta di raggio in raggio, uno scatto ogni 45 gradi, con la vibrazione
corta a fare da "click". Il disco al centro fa da schermo - dice cosa stai per
aprire - e da tasto: si preme li' per entrare. Anche la rotella del mouse e le
frecce della tastiera fanno scattare la ghiera, e Invio preme al centro.

Scelto un raggio il sole non sparisce: **si rimpicciolisce e va a posarsi sotto
al contenuto**, e li' resta mentre usi la funzione. Ci sta tutto dentro, non
mezzo fuori dal bordo, e non e' un vezzo: li' sotto **resta una ghiera viva**.
Girandolo la funzione **cambia mentre giri**
- il contenuto sopra si sostituisce a ogni scatto, il raggio pieno si sposta, e
il disco scrive dove sei: `SCANNER` sopra, `ALBA` sotto. Per passare da una
funzione all'altra non si torna piu' indietro ogni volta.

Toccarlo al centro invece lo fa risalire a schermo intero, per riprendere la
scelta dal sole grande. Ed e' tutta la navigazione che c'e': niente barra in
basso, e nemmeno un'intestazione in cima - diceva il nome, e il nome sta gia'
nel disco.

Il movimento e' una transizione sola sul `transform`, con una curva che parte
all'indietro: quel valore negativo nella `cubic-bezier` e' lo strappo verso
l'alto prima di calarsi, e funziona identico al contrario quando risale. Con
`prefers-reduced-motion` il sole cambia posto senza scivolare.

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

## Lo scanner

Le altre schede sono strumenti: una guarda le foto, una cerca online, una
stima. Lo **scanner** e' un agente che li usa da solo e in fila, perche' sono
la stessa domanda spezzata in tre - *quanto ci ricavo?* - e farla in tre schede
vuol dire ricopiare a mano gli stessi dati due volte. Si parte dalle foto e si
arriva al prezzo senza scrivere niente, tranne quello che sai tu e la foto non
dice.

Tre fasi, che sono i tre verbi.

**1. Scansiona.** Le foto, l'etichetta a piena risoluzione, e Google Lens. Ne
esce un'identita' del capo in cui ogni campo si porta dietro **da dove arriva**:
letto sull'etichetta, visto in foto, riconosciuto da Lens, detto da te.
"Carhartt letto sul cartellino" e "Carhartt dedotto dalla forma" portano allo
stesso prezzo con due affidabilita' diverse, e chi vende deve poterle
distinguere prima di fidarsi del numero.

**2. Cerca, a giri.** Ogni giro parte da **cosa manca ancora**, non da una lista
fissa: pochi annunci dell'usato, risultati che parlano di un altro capo, prezzi
troppo sparsi, mediana che si muove ancora. La lacuna finisce scritta a lettere
nel diario e dentro il prompt della ricerca successiva, cosi' il giro nuovo
cambia strategia invece di ripetere la stessa query con altre parole. Si ferma
quando il quadro sta in piedi - non dopo un numero fisso di ricerche - ma il
tetto resta: quattro giri, sei ricerche in tutto, perche' ognuna costa quota.

**3. Capisce i prezzi**, ed e' qui la differenza vera con l'agente della scheda
Ricerca, che di tutti i prezzi trovati fa una mediana sola. Un annuncio Vinted
a 30€ e una scheda Zalando a 89€ non sono lo stesso numero: il primo dice a
quanto **si vende**, il secondo quanto **costa nuovo**. Lo scanner:

- separa gli annunci dell'usato dai listini dei negozi, guardando il dominio
  prima del testo (su vinted.it si vende usato qualunque cosa dica il titolo);
- butta fuori i risultati che non nominano ne' la marca ne' il tipo di capo:
  restano in elenco, marcati, ma fuori dalla mediana;
- scarta gli estremi con la regola dei quartili, cosi' un lotto stock da 600€
  in mezzo a sei felpe da 40 non sposta niente - e dice quali ha scartato;
- calcola il quartile centrale, cioe' **dove sta meta' del mercato**, e da li'
  tira fuori due numeri invece di uno: il prezzo per vendere in pochi giorni e
  quello per cui vale la pena aspettare.

La fiducia la calcola il codice dai dati - quanti annunci, quanto sono vicini
fra loro - e non la dichiara il modello: a un modello a cui si chiede quanto e'
sicuro risponde quasi sempre "media". E se il numero che propone cade fuori dai
prezzi davvero trovati, viene riportato dentro la banda **e la pagina lo
scrive**: un numero corretto di nascosto e' peggio di uno sbagliato in chiaro.

Sotto il rapporto resta la lista numerata di tutto quello che ha letto, ogni
riga col suo link e col suo cartellino - annuncio usato, prezzo del nuovo,
parla di un altro capo, prezzo fuori scala. Il "(3)" del rapporto e la terza
riga sono la stessa cosa.

Senza `SERPAPI_KEY` lo scanner non si spegne: riconosce comunque il capo dalle
foto, non dice nessun prezzo - lo inventerebbe - e lo spiega.

Il risultato alimenta l'annuncio e la stima prezzo, con lo stesso vincolo
dell'agente: solo se la scheda di la' parla dello stesso capo.

## Deploy su Netlify

Il repo e' gia' pronto: `netlify.toml` dice tutto quello che serve (nessun
comando di build, publish `public/`, function in `netlify/functions`, Node 20),
quindi in Netlify non c'e' niente da configurare a mano tranne le chiavi.

1. **app.netlify.com** > *Add new project* > *Import an existing project* >
   GitHub > `damianovecchio6-oss/Damn_Vinted`.
   Alla schermata delle impostazioni non toccare niente: le legge da
   `netlify.toml`. Il branch di produzione e' `main`.
2. **Site configuration > Environment variables**: aggiungi almeno
   `GROQ_API_KEY`. `GEMINI_API_KEY` e `SERPAPI_KEY` sono opzionali e accendono
   analisi foto migliore e ricerca online (vedi la tabella qui sopra).
   Lo scope puo' restare "All scopes": le chiavi le leggono solo le function,
   il sito e' statico e non le vede mai.
3. **Deploy**. Al primo deploy Netlify pubblica `main`.
4. **Verifica** che sia tutto arrivato davvero:

   ```
   node scripts/verifica-deploy.js https://iltuosito.netlify.app
   ```

   Controlla pagina, function, origini rifiutate e quali chiavi funzionano
   davvero. Consuma una ricerca SerpApi e una richiesta AI: e' il solo modo di
   sapere che le chiavi vanno, invece che sembrare a posto.

### Provare un branch prima di unirlo a main

**Site configuration > Build & deploy > Branch deploys > Let me add individual
branches**, e aggiungi il branch. Netlify pubblica ogni push su un URL suo, con
le stesse chiavi e le stesse function: le barre del nome diventano trattini.

```
claude/ai-agent-cloth-research-qn7juz
-> https://claude-ai-agent-cloth-research-qn7juz--iltuosito.netlify.app
```

Comodo per l'agente di ricerca: si prova sul dominio del branch, e `main` resta
com'e' finche' non decidi tu.

## Come si usa l'analisi foto

Fino a 4 foto. Quanto pesante sia "troppo" lo decide il provider, cambia col
modello e non coincide col numero che sta scritto nella sua documentazione:
qui e' stato sbagliato due volte di fila. Quindi non si indovina piu'. Si
parte dalla qualita' migliore che sta in un budget di partenza, e **si scende
di un gradino ogni volta che e' il server a dire che e' troppo** - la function
lo segnala con un campo apposta, non con una frase da leggere. Il numero non
deve piu' essere giusto: deve solo essere un punto da cui partire.

La foto dell'etichetta ha un tetto suo, piu' alto: viaggia in una richiesta
tutta sua, e la sua risoluzione e' esattamente quella da cui dipende se marca,
composizione e taglia si leggono o si indovinano.

Il marcatore 🏷️ su un'anteprima dice "questa e' l'etichetta":
quella foto viene mandata **a parte e a piena risoluzione**, con una richiesta
che chiede solo di trascrivere quello che c'e' scritto. Quello che si legge
sull'etichetta sovrascrive quello che il modello ha dedotto guardando il capo.

Senza marcatore l'analisi funziona lo stesso, ma marca, composizione e taglia
restano una deduzione dall'aspetto - cioe' la cosa che sbagliava di piu'.
