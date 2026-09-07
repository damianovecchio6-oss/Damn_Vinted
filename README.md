# Damn Vinted

Sulla pagina si chiama **ALBA**: il nome sta dentro al disco del sole, che non
se ne va mai dallo schermo. Il repo resta Damn Vinted.

Assistente per vendere su Vinted: analizza le foto di un capo, cerca online
quanto vale davvero, scrive l'annuncio e stima il prezzo. Lo **scanner** fa
tutto il giro da solo, dalle foto al prezzo. Sito statico + tre Netlify
Function.

```
public/index.html             il markup e lo stile dell'interfaccia
public/app.js                 tutto lo script della pagina, fuori da index.html
public/_headers               header di sicurezza (CSP, ecc.)
public/img/                   i disegni: il sole, il sole+luna, le icone dell'app
public/manifest.webmanifest   nome, icone e schermo intero: l'app installabile
public/sw.js                  service worker: il guscio resta anche senza rete
api/                          gli stessi endpoint per Vercel: solo l'involucro
netlify/functions/claude.js   proxy verso i modelli AI (Groq / Gemini)
netlify/functions/lens.js     ricerca per immagine (Google Lens via SerpApi)
netlify/functions/ricerca.js  ricerca testuale online, lo strumento dell'agente
netlify/functions/mercato.js  gli esiti condivisi e il tasto del codice
netlify/functions/lib/        codice condiviso dalle function
supabase/001_mercato.sql      le tabelle del mercato condiviso, da eseguire una volta
tests/                        suite di test, nessun framework
.claude/                      skill e agenti: collaudo e riparazione
.github/workflows/            i test a ogni push
scripts/verifica-deploy.js    controlla un sito gia' deployato: function e chiavi
scripts/icone.js              ridisegna le icone dell'app dal sole del marchio
```

Le suite girano col mouse, tranne una: `tests/tocco.js` manda tocchi veri a un
Chromium in modalita' telefono. Serve, perche' il telefono non e' un mouse
piccolo: il click che il browser sintetizza dopo un tocco a volte non arriva, e
col solo mouse quel buco non si vede.

Il sito non ha build ne' dipendenze a runtime: `public/index.html` si apre e
funziona, anche da disco - `app.js` e' linkato con un path relativo apposta,
perche' con `/app.js` da `file://` il browser cercherebbe nella radice del
filesystem. Il publish dir e' `public/` e non la root del repo, cosi' il sorgente
delle function e i test non finiscono serviti come file statici.

## Test

```
npm install     # solo playwright-core, i browser non vengono scaricati
npm test
```

896 controlli, nessun framework: ogni file in `tests/` e' uno script che stampa
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

> **Aggiungere una chiave non basta.** Le function leggono l'ambiente al
> momento del **deploy**: finche' non ne parte uno nuovo continuano a girare
> con quello di prima, e la chiave appena messa sembra non funzionare. Dopo
> averla salvata: **Deploys > Trigger deploy > Deploy site**. Vale per
> aggiungere una chiave, cambiarla e toglierla.

| Variabile | Serve a | Obbligatoria |
|---|---|---|
| `GROQ_API_KEY` | Scrittura annuncio, stima prezzo, e analisi foto se manca Gemini | Si' |
| `GEMINI_API_KEY` | Analisi foto: legge il testo delle etichette molto meglio | No |
| `SERPAPI_KEY` | Bottone "Identifica prodotto", agente di ricerca e scanner | No |
| `ALBA_PIN` | Chiude il sito dietro un codice: senza, chi ha l'indirizzo entra | No |
| `SUPABASE_URL` | Il deposito: prezzi condivisi e tasto del codice | No |
| `SUPABASE_SERVICE_KEY` | La chiave di servizio dello stesso progetto Supabase | No |

Su Vercel stanno in **Settings > Environment Variables**, e vale la stessa
regola del riquadro: contano dal deploy dopo.

### GEMINI_API_KEY — analisi foto piu' accurata

Marca, composizione e taglia dovrebbero uscire dall'etichetta, non
dall'aspetto del capo. I modelli con visione disponibili su Groq sul testo
piccolo di un cartellino non ci arrivano, quindi finiscono per indovinare.

1. Vai su **aistudio.google.com**, accedi con un account Google.
2. **Get API key** > **Create API key**.
3. Incolla la chiave in `GEMINI_API_KEY` su Netlify.
4. **Fai partire un deploy nuovo** (vedi il riquadro qui sopra), o la chiave
   resta li' senza che nessuno la legga.

Che sia entrata si vede senza aprire niente: sotto il risultato dell'analisi
foto c'e' scritto quale modello ha risposto. Prima diceva `groq`, dopo deve
dire `gemini`.

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

I modelli con visione rimasti su Groq sono modelli che **ragionano ad alta
voce**, e il ragionamento si mangia i token prima di arrivare alla risposta:
con una foto ci stava, con due il JSON non arrivava piu'. Si spegne con
`reasoning_effort`, ma il valore giusto dipende dalla famiglia - `none` per i
qwen3, mentre gpt-oss lo rifiuta con un 400 - e la function lo manda solo a
chi lo accetta, con un ripiego se un giorno smette di accettarlo.

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
   fiducia (calcolata dal codice, non dichiarata dal modello), osservazioni
   che citano i risultati per numero. Sotto
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

**3. Capisce i prezzi.** Un annuncio Vinted a 30€ e una scheda Zalando a 89€
non sono lo stesso numero: il primo dice a quanto **si vende**, il secondo
quanto **costa nuovo**. Lo scanner:

- separa gli annunci dell'usato dai listini dei negozi, guardando il dominio
  prima del testo (su vinted.it si vende usato qualunque cosa dica il titolo);
- butta fuori i risultati che non nominano ne' la marca ne' il tipo di capo:
  restano in elenco, marcati, ma fuori dalla mediana;
- scarta gli estremi con la regola dei quartili, cosi' un lotto stock da 600€
  in mezzo a sei felpe da 40 non sposta niente - e dice quali ha scartato;
- **pesa quello che resta** (sotto);
- calcola il quartile centrale, cioe' **dove sta meta' del mercato**, e da li'
  tira fuori due numeri invece di uno: il prezzo per vendere in pochi giorni e
  quello per cui vale la pena aspettare.

### Non tutte le prove valgono uguale

Una mediana di annunci vivi non e' una mediana di vendite: sono **richieste**.
Un capo a 45€ fermo da tre mesi e' anzi la prova che a 45€ non si e' venduto, e
siccome gli invenduti restano online mentre i venduti spariscono, una banda
fatta solo di annunci vivi pende sistematicamente **verso l'alto**. E' l'errore
che non si vede, perche' il numero che ne esce sembra ragionevole lo stesso.

Non si puo' togliere del tutto - il venduto su Vinted non e' pubblico e da
Google non si raccoglie - ma si puo' smettere di contare ogni riga come se
valesse le altre. Ogni prova entra nella mediana con un peso, e il peso lo
fanno tre cose:

- **quanto e' vecchia.** Google la data la da' quando ce l'ha, in italiano
  ("3 giorni fa", "8 set 2025"): oltre un mese e mezzo il peso cala, oltre
  l'anno vale un terzo.
- **in che condizione e' il capo di cui parla.** Fra un "nuovo col cartellino"
  e un "soddisfacente" su Vinted ci passa spesso il doppio del prezzo, e la
  condizione e' quasi sempre scritta nel titolo o nello snippet. Si confronta
  con la condizione del capo scansionato: stessa condizione peso pieno, due
  gradini di distanza meno di meta'.
- **se e' un prezzo chiesto o un prezzo fatto.** Un venduto vale piu' di una
  richiesta, e una delle ricerche di riserva va a cercarlo apposta dove esiste
  (su eBay i venduti sono indicizzati).

I quartili sono quindi **pesati**, con una formula che a pesi tutti uguali da'
esattamente i numeri di prima: se della data e della condizione non si sa
niente - e capita - i conti restano quelli di una mediana semplice. Il peso
sposta qualcosa solo quando c'e' davvero qualcosa da sapere. Sotto il prezzo la
pagina scrive com'e' fatta la banda: quanti sono venduti, quanti hanno la
stessa condizione, quanti sono piu' vecchi di tre mesi e pesano meno.

### La fiducia non e' un'etichetta di fianco al numero

La fiducia la calcola il codice dai dati e non la dichiara il modello: a un
modello a cui si chiede quanto e' sicuro risponde quasi sempre "media". Ma
calcolarla bene non basta se poi il prezzo resta comunque preciso: con tre
annunci sparsi "27€" **sembra una misura**, e non lo e'.

Quindi la fiducia entra dentro il numero, in due modi. Il range si allarga di
quanto e' incerta la banda (meta' del quartile centrale diviso la radice delle
prove che contano davvero), e sotto la soglia **il numero singolo non si dice
proprio**: al suo posto resta la banda, con scritto perche'. A volte non e' la
risposta che si voleva. E' la risposta che si ha.

"Le prove che contano davvero" e' un conto a parte: dieci annunci di cui otto
vecchi e di un'altra condizione non sono dieci prove, e la fiducia lo sa.

E se il numero che il modello propone cade fuori dai prezzi davvero trovati,
viene riportato dentro la banda **e la pagina lo scrive**: un numero corretto
di nascosto e' peggio di uno sbagliato in chiaro.

### Il profilo del capo: ogni campo con la sua fiducia

L'identita' che esce dalla scansione non e' una lista di stringhe: e' un
**profilo**, e ogni campo si porta dietro da dove arriva *e quanto vale*.
Leggere "Carhartt" sul cartellino e dedurlo dalla forma sono due cose diverse,
e finora il sito diceva la prima meta' (la fonte) e non la seconda (quanto
fidarsi). Ora le dice tutte e due, con un numero da 0 a 1:

| fonte | quanto vale |
|---|---|
| letto sull'etichetta | 0.97 |
| detto da te | 0.90 |
| riconosciuto da Lens | 0.85 |
| visto in foto | 0.62 |

La foto sta in fondo perche' e' la fonte che sbaglia di piu': un colore lo
prende quasi sempre, un modello quasi mai.

Quando due fonti parlano dello stesso campo non si sceglie e basta. Se sono
**d'accordo** la fiducia sale - il dubbio che resta e' il prodotto dei due
dubbi, con un tetto a 0.99: nessun campo diventa mai una certezza - e se si
**contraddicono** vince comunque quella piu' affidabile, ma la fiducia scende e
il disaccordo resta scritto sotto il campo. "L'etichetta dice Nike, la foto
diceva Adidas" e' esattamente il caso in cui il prezzo va guardato due volte, e
nasconderlo per far vedere una scheda pulita sarebbe il tipo di bugia che poi
costa una vendita.

Il profilo esce dallo scanner (`sxProfilo`) nella forma piatta - i valori, poi
`fiducia` e `fonti` a fianco, campo per campo - ed e' anche come l'identita'
arriva al modello nel prompt: ogni riga con la sua fonte e il suo numero, cosi'
il verdetto non costruisce un ragionamento sopra un campo che potrebbe non
esserci.

### La confidenza del campione: quanti, quanto simili, quanto freschi

Il **livello** di fiducia dice se un numero singolo si puo' dire, e lo decide su
quante prove contano e su quanto sono sparse. Non dice pero' *di che pasta e'
fatto il campione*, ed e' una domanda diversa: dieci annunci con prezzi
vicinissimi ma di un altro modello danno un livello alto e un prezzo che
sembra solido. E' il modo piu' comodo di sbagliarsi.

Quindi accanto al livello c'e' un secondo numero, da 0 a 1, che guarda solo il
campione e mai i prezzi:

- **quantita'** (peso 0.30): quanti comparabili, su venti. Oltre non si
  guadagna: il ventunesimo annuncio non aggiunge niente al ventesimo.
- **somiglianza** (peso 0.45, la fetta piu' grossa): quanto ogni annuncio parla
  *di questo capo* - marca, modello e tipo pesano 0.25, 0.30 e 0.15 (gli stessi
  numeri di `config.js` nel riferimento, per i tre campi che un titolo libero
  puo' davvero dire; taglia, colore e materiale li' esistono, qui no - un
  titolo Google non li dichiara in un campo suo), e i campi che non conosciamo
  non contano contro nessuno - e quanto e' vicina la sua condizione alla tua.
- **freschezza** (peso 0.25): quanto sono recenti, con la stessa scala dell'eta'
  che pesa le prove. Una data che manca vale 0.6: nel peso di un annuncio vale
  1 apposta, per non spostare la mediana per un dato che manca a Google, ma
  qui non sapere e' proprio un motivo per fidarsi di meno.

Sotto il prezzo la pagina scrive il numero **e da quale lato e' basso** -
"quantita' 0.3 (6 annunci su 20), freschezza 0.3, somiglianza 0.56" - partendo
dal lato piu' debole, che e' anche la risposta alla domanda "cosa cerco
ancora?".

### Anche il peso conosce la somiglianza

Il peso di una prova (quello che sposta la mediana) e la confidenza del
campione condividono due fattori - l'eta' e la condizione - ma fino a poco fa
non condividevano il terzo: un annuncio che nominava appena il tipo di capo,
senza marca ne' modello, contava nella mediana quanto uno che li nominava
tutti, perche' "pertinente" era un si/no. Ora il grado di somiglianza (lo
stesso 0-1 della confidenza) entra anche nel peso: `grado × eta' × condizione ×
venduto`. Un match debole sposta la mediana poco invece che come uno pieno.

Sotto lo zero non cambia niente - un annuncio che non nomina ne' la marca ne'
il tipo resta fuori dalla mediana, marcato ma non contato, come prima - ma un
annuncio debolmente pertinente adesso pesa meno di uno forte anche se sono
usati, freschi e nella stessa condizione. Nessuna soglia minima e' stata
aggiunta apposta: tagliare del tutto un annuncio sotto un numero scelto a
tavolino sarebbe un'altra costante senza dati a sostegno, mentre pesarlo di
meno lo fa gia' contare quanto merita.

Una cosa pero' non deve fingere di sapere quello che non sa. Quando ne' la
condizione del capo ne' quella dell'annuncio si leggono, la somiglianza usata
per la confidenza non sostituisce piu' quel pezzo con un 0.8 a caso: il peso
che gli spettava torna tutto alla pertinenza, come gia' faceva
`sxGradoPertinenza` quando marca o modello mancano. Un dato che manca non deve
ne' aiutare ne' penalizzare - deve solo mancare.

### Quando il modello non da' un veloce o un paziente

Il prezzo "veloce" e il "paziente" li propone il modello, e il codice li
riporta dentro la banda degli annunci veri prima di mostrarli. Se pero' il
modello non risponde con un numero leggibile per uno dei due, la scheda non
deve restare con un buco: il ripiego e' il quartile che il prompt stesso
propone come default - `q1` per il veloce, `q3` per il paziente, cioe' "dove
sta meta' del mercato" - non un moltiplicatore della mediana inventato senza
prove. Succede solo quando la fiducia permette gia' di mostrare un numero
singolo: sotto la soglia resta la banda, come sempre.

### Un modello di prezzo solo, due schede

Questi conti non sono dello scanner: sono del prodotto. La scheda **Ricerca**
leggeva i prezzi a modo suo - una mediana semplice di tutto quello che aveva un
numero, negozi e fuori tema compresi - e siccome tutte e due scrivono
`prezzoSuggerito` sulla **stessa voce di storico**, la calibrazione finiva per
fare la mediana di scarti misurati con due metri diversi. Ora la scheda Ricerca
passa dalle stesse funzioni: usato separato dal nuovo, fuori tema marcati,
estremi scartati, prove pesate, fiducia calcolata dal codice, e niente numero
singolo sotto la soglia.

Con una differenza che conta: li' l'identita' del capo non viene da una
scansione, sono due campi scritti a mano. Se **nessun** risultato nomina la
marca o il tipo, il filtro di pertinenza taglierebbe via tutto - e allora la
mediana si fa su tutto quello che si e' trovato, **con scritto che e' larga**.

Sotto il rapporto resta la lista numerata di tutto quello che ha letto, ogni
riga col suo link e col suo cartellino - annuncio usato, prezzo del nuovo,
parla di un altro capo, prezzo fuori scala. Il "(3)" del rapporto e la terza
riga sono la stessa cosa.

Senza `SERPAPI_KEY` lo scanner non si spegne: riconosce comunque il capo dalle
foto, non dice nessun prezzo - lo inventerebbe - e lo spiega.

Il risultato alimenta l'annuncio e la stima prezzo, con lo stesso vincolo
dell'agente: solo se la scheda di la' parla dello stesso capo.

### ALBA_PIN — chi puo' usare le tue chiavi

Il sito e' pubblico per costruzione: e' una pagina statica, e chi ha
l'indirizzo la apre. Quello che c'e' da proteggere non sono i dati - lo
storico vive nel telefono di chi lo scrive, sul server non c'e' niente - ma le
**chiavi AI di chi paga**: chi apre il sito puo' consumare la tua quota Groq e
le tue 250 ricerche SerpApi del mese.

Con `ALBA_PIN` impostato, la function non rilascia il token di sessione a chi
non porta quel codice. La pagina lo chiede la prima volta su quel dispositivo,
se lo ricorda nel `localStorage` come fa con lo storico, e non lo chiede piu'.
Senza la variabile non cambia niente: nessuna finestra, nessun codice, il sito
com'era.

Tre cose per cui e' fatto cosi'. Il codice si controlla **una volta sola**,
quando si rilascia il token: da li' in poi comandano il token - firmato,
legato all'IP, quindici minuti - e il rate limit, che c'erano gia'. Chiederlo
a ogni richiesta avrebbe voluto dire tenerlo in giro per la pagina a ogni
analisi, per la stessa garanzia. Il confronto e' a tempo costante su due
impronte, non un `===` fra stringhe. E il codice entra nel segreto che firma i
token: **cambiarlo scade all'istante** quelli gia' in giro, invece di lasciare
un quarto d'ora di accesso a chi lo aveva.

Quello che questo codice **non** e': non e' autenticazione, e non protegge da
chi il codice ce l'ha. E' la serratura di casa, non una cassaforte - tiene
fuori chi passa, non chi ha le chiavi.

## Il mercato condiviso

Lo storico di una persona sola dice poco: tre capi venduti sono un aneddoto.
Gli esiti di tutti quelli che usano ALBA sono invece l'unica cosa vera che
nessun modello sa - **come si vende davvero quel marchio su Vinted Italia,
questo mese** - e messi insieme diventano un riferimento che nessuna ricerca
online puo' dare, perche' gli annunci online sono richieste, non vendite.

### Cosa esce dal telefono, e cosa no

Quando qualcuno segna una vendita, parte una riga: **marca, categoria,
condizione, prezzo suggerito, prezzo incassato, giorni**. Basta.

Non parte, e non deve partire mai: le foto, il testo dell'annuncio, le note
scritte a mano, il nome del capo battuto sulla tastiera, e qualunque cosa che
dica *chi* ha venduto. Il campo `dispositivo` e' un numero casuale nato nel
browser: serve a contare quanti esiti arrivano dalla stessa parte, non a
riconoscere qualcuno. `tests/mercato.js` verifica l'elenco esatto dei campi
che partono: se qualcuno ne aggiunge uno, quella suite diventa rossa.

Si spegne dallo **Storico > Impostazioni**, ed e' acceso di default: chi non
decide contribuisce, perche' e' quello che fa funzionare i prezzi condivisi
anche per lui.

### Cosa torna indietro

Nel prompt della stima, sotto la riga di chi sta vendendo: *gli altri
venditori: 180 capi di questa marca, il 22% sotto il suggerito, in 11 giorni*.
Sempre col numero di capi su cui e' fatta, perche' un numero senza il suo
campione e' un'opinione. E sempre **sotto** i suoi: i propri esiti restano la
voce piu' forte.

Nello scanner e nella Ricerca, dove il prezzo viene corretto dal codice invece
che dal modello, il mercato entra **solo se chi guarda non ha ancora esiti
suoi**. Sommare le due correzioni vorrebbe dire scontare due volte lo stesso
capo.

### Perche' non si avvelena facilmente

Chiunque puo' mandare numeri finti: e' il rischio vero di un dato condiviso.
Quattro strati, nessuno dei quali basta da solo:

- **mediane, non medie**: per spostare una mediana bisogna essere la meta' del
  campione, non il piu' rumoroso;
- **valori fuori scala rifiutati**: un capo venduto a un ventesimo o a cinque
  volte il suggerito non entra, e la stessa regola sta anche nel database,
  cosi' vale pure per chi scrivesse da un'altra strada;
- **una soglia minima**: sotto cinque esiti il mercato non risponde niente;
- **un tetto per dispositivo**: venti esiti al giorno, che taglia lo script
  banale che ne manda mille.

Piu' quello che c'era gia': token di sessione, controllo dell'origine, e il
limite di richieste al minuto per IP.

### Il deposito

Dentro c'e' un Postgres di Supabase, raggiunto dalla sua API REST senza
nessuna libreria (`netlify/functions/lib/deposito.js`). Le due tabelle hanno
RLS acceso e **nessuna policy**: le chiavi pubbliche non le vedono proprio, ci
arriva solo la function con la service key.

Da fare una volta sola: crea il progetto su **supabase.com**, apri il **SQL
Editor** e incolla `supabase/001_mercato.sql`, poi copia da *Project Settings
> API* l'URL e la **service_role key** in `SUPABASE_URL` e
`SUPABASE_SERVICE_KEY`. Senza queste due variabili il mercato non esiste e il
sito funziona come prima: nessun contributo, nessuna riga in piu' nel prompt,
e l'interruttore del codice non si mostra.

### Il tasto del codice

E' l'altra cosa che ha bisogno di un posto comune. `ALBA_PIN` dice *quale* e'
il codice; la riga `pin_attivo` nel deposito dice *se* si chiede, e quella la
gira il tasto in **Storico > Impostazioni**. Per girarlo serve il codice, in un
senso e nell'altro - con il sito aperto, il codice e' quello che permette di
richiuderlo.

Il valore si legge con una cache di un minuto: e' anche il ritardo massimo fra
il tasto premuto e il codice che entra in vigore. Se il deposito non risponde
si tiene l'ultimo valore conosciuto, e se non se ne conosce nessuno la
serratura resta chiusa: in dubbio, non si apre.

## Lo storico, e come portarselo via

Annunci scritti, prezzi stimati e rapporti dell'agente finiscono tutti nella
scheda **Storico**, che vive nel `localStorage` di questo browser sotto
`vintedAiHistory`. Non e' un archivio: basta un "cancella dati del sito" o un
telefono cambiato e non ne resta niente da nessuna parte.

### Com'e' andata davvero

Il prezzo suggerito e' una previsione, e finche' nessuno dice se ha venduto
resta una previsione che non si e' mai misurata con niente. Ogni voce dello
storico che porta un prezzo suggerito fa quindi una domanda sola: **venduto? a
quanto? in quanto tempo?** Si risponde in due campi, o si dice "non ancora" e
si torna a dirlo dopo.

Dal terzo capo venduto in poi lo storico scrive una riga che nessun modello
puo' sapere, perche' e' successa a chi sta usando l'app: *i tuoi capi vanno via
in media il 15% sotto il prezzo suggerito, in 11 giorni*.

E non e' piu' una riga sola per tutto il guardaroba. Un Nike e una camicia di
fast fashion non si scostano dal suggerito nello stesso modo, quindi la
calibrazione si stringe su quello che somiglia al capo in mano: prima i capi
**della stessa marca**, poi quelli col nome che si somiglia, e il totale resta
solo come ripiego quando i simili sono meno di tre. Quando e' stretta la pagina
lo dice - *i tuoi ultimi 3 capi venduti di marca Nike* - perche' su quale
mucchio sia stato fatto il conto cambia quanto ci si puo' contare.

E quella riga **sposta il numero**, non lo commenta soltanto: il prezzo che
scanner e Ricerca mostrano e' gia' corretto di quello scarto, con scritto
accanto di quanto e da cosa - *era 43€, l'ho portato a 39€* - perche' la regola
di questa pagina resta che un numero corretto di nascosto e' peggio di uno
sbagliato in chiaro. Entra anche nel prompt della stima prezzo, come **l'unico
dato di vendite concluse** che l'app abbia mai - e li' non entra solo la
media, entrano i **capi veri**: fino a quattro righe di storico, i piu' vicini
per marca e nome, scritte come *Nike felpa tech, buono: suggerito 40€ ->
venduto 28€ in 9 giorni*. Una media dice al modello un aggettivo, quelle righe
gli danno dei casi su cui ancorare il numero, ed e' su casi del genere che
sposta la stima davvero. Il blocco resta sotto i 700 caratteri: il prompt ne ha
8000 in tutto, e i dati di mercato valgono almeno quanto lo storico.

Nello scanner e nella Ricerca gli esiti **non** entrano nel prompt, e non e'
una dimenticanza: li' lo scarto viene applicato dopo, aritmeticamente, e
darglielo anche da leggere lo conterebbe due volte - il modello abbassa, e poi
il codice abbassa di nuovo. Quello che cambia li' e' su quali capi lo scarto e'
misurato.

Due cose per cui non scappa via. La correzione ha un tetto del 25%, cosi' tre
esiti storti non spostano tutto. E l'anello si chiude: la vendita dopo viene
misurata sul prezzo **gia' corretto**, quindi lo scarto tende a zero invece di
riportare lo stesso sconto all'infinito. I dati arrivano lenti e solo da chi
risponde: e' il prezzo da pagare per l'unico riferimento vero che ci sara'.

Anche il capo su cui la fiducia era troppo bassa per dire una cifra entra nel
giro: nello storico resta la sua banda, la domanda arriva lo stesso, e in
percentuale non si dice niente perche' non c'e' un suggerito da confrontare.
Erano proprio i capi con piu' da insegnare, e prima non venivano mai chiesti.

Per questo c'e' **Esporta lo storico**: scarica un JSON con il numero di
formato, la data di esportazione e le voci intere, miniature comprese - e'
dalla foto che si riconosce di quale capo si trattava.

```json
{ "formato": 1, "esportatoIl": "2026-09-04T05:29:01.895Z", "voci": [ ... ] }
```

Il nome del file porta data **e ora** (`storico-alba-2026-09-04_05-29-01.json`):
con la sola data due esportazioni dello stesso giorno finivano sullo stesso
nome, e nei download restava solo l'ultima. L'ora e' quella locale, la stessa
che la pagina mostra sotto ogni voce. Con lo storico vuoto non scarica un file
vuoto: lo dice e basta. L'import non c'e'.

## Non perdere un giro lungo

Lo scanner e l'agente sono pipeline da decine di secondi. Prima niente le
proteggeva: una ricarica a meta', o il pollice che scivolava su un altro raggio
del sole, portava via tutto quello che era stato scoperto senza una parola,
mentre le richieste gia' partite continuavano a consumare quota.

Ora, **e solo mentre qualcosa sta davvero lavorando**, chiudere la pagina chiede
conferma, e cambiare funzione dice che cosa sta lavorando invece di un generico
"sei sicuro?". Se il cambio viene rifiutato la ghiera torna dov'era, o il disco
annuncerebbe una funzione mentre sotto ne resta aperta un'altra.

Che la guardia sia legata al lavoro vero e non appesa sempre non e' un
dettaglio: una che scatta a vuoto insegna a rispondere senza leggere, proprio
la volta che contava. Tornare sulla scheda mentre il giro scrive non e'
perderlo di vista, ed e' l'unico caso in cui non si chiede niente.

## Perche' lo script sta in un file suo

`public/index.html` non contiene una riga di JavaScript: nessun blocco
`<script>`, nessun `onclick`. Tutto sta in `public/app.js`, e i bottoni portano
un `data-az` che un solo ascoltatore delegato traduce in una chiamata.

Non e' ordine per l'ordine: e' l'unica strada per cui `public/_headers` puo'
dire **`script-src 'self'`** senza `'unsafe-inline'`. Quel permesso non vale
solo per il codice che ci abbiamo messo noi - vale per qualunque script inline
finisca nella pagina, compreso quello iniettato sfruttando un bug altrove. Ed
e' tutto o niente: bastava un `onclick` rimasto indietro per doverlo
riconcedere, e con lui la protezione se ne andava per intero.

L'ascoltatore e' delegato e non uno per bottone perche' meta' di questi bottoni
non esistono al caricamento: le anteprime delle foto e le righe dei risultati
nascono dopo, e un giro di `addEventListener` andrebbe rifatto a ogni render.

`style-src` invece `'unsafe-inline'` ce l'ha ancora, e non e' una svista: nel
markup ci sono attributi `style=`, che quel permesso lo richiedono comunque.
Toglierlo vorrebbe dire spostare anche quelli, ed e' un lavoro diverso.

A tenerlo fermo c'e' un controllo in `tests/ui.js` che legge i file invece
della pagina, di proposito: la CSP vera non passa dal server dei test, quindi
una violazione la suite non la vedrebbe. Il controllo guarda la causa - codice
inline nel sorgente - non il sintomo.

## L'app

ALBA si installa in home e da li' si apre a schermo intero, con la sua icona e
senza la barra dell'indirizzo. Non e' un wrapper ne' un altro progetto: e' lo
stesso sito, con tre pezzi in piu'.

**Il manifest** (`public/manifest.webmanifest`) e' la carta d'identita': nome,
icone, `display: standalone` (senza, il telefono riapre il browser travestito),
e il fondo nero della pagina come `background_color`, cosi' tra l'icona e il
primo pixel non lampeggia il bianco. Tenendo premuta l'icona compaiono due
scorciatoie, Scanner e Foto: aprono direttamente quella funzione passando da
`?vai=`.

**Il service worker** (`public/sw.js`) tiene da parte il guscio - pagina,
script, disegni - e lo serve anche senza rete: ALBA si apre in metro. Quello
che non tiene mai da parte sono le function: risposte AI, prezzi e token sono
roba di adesso, e servirli dalla cache vorrebbe dire mostrare la stima di ieri
per la foto di oggi. Vive solo su https e su localhost, quindi la pagina aperta
da disco resta esattamente com'era.

Quando cambia il guscio va alzato `VERSIONE` in cima a `sw.js`: e' l'unica cosa
che dice al browser di buttare via la copia vecchia. Le pagine gia' aperte si
ricaricano una volta sola, da sole.

**L'icona in cima a destra** compare solo dove il browser offre davvero
l'installazione (Android, Chrome desktop). Su iPhone quel bottone non esiste
per nessun sito: si installa da Safari, *Condividi > Aggiungi a Home*.

Le icone si rifanno da sole, dal sole del marchio:

```
node scripts/icone.js
```

Le rigenera in `public/img/` (192, 512, una maskable per il ritaglio di Android
e la 180 di iOS). I PNG stanno nel repo gia' fatti: lo script serve solo quando
cambia il disegno.

Cosa manca per un'app da store: un negozio non accetta un URL, vuole un
pacchetto firmato. Da qui la strada corta e' Trusted Web Activity per il Play
Store (`bubblewrap`, che parte proprio da questo manifest) e un wrapper per
iOS; nessuno dei due tocca il codice del sito.

## Due case: Netlify e Vercel

Lo stesso repo si pubblica su tutti e due, senza un ramo nel codice. La pagina
chiama `/api/claude`, `/api/lens`, `/api/ricerca`: su Vercel e' il posto dove
le function stanno davvero, su Netlify un redirect in `netlify.toml` manda
quella strada a `/.netlify/functions/`. L'indirizzo nel codice resta uno.

Le function sono scritte una volta sola, nella forma di Netlify - una funzione
che riceve un `event` e torna `{ statusCode, headers, body }`. E' quella la
forma che i test chiamano direttamente, senza rete e senza browser. I tre file
in `api/` non sono una copia: richiamano quelle e le avvolgono in un
adattatore (`netlify/functions/lib/vercel.js`) che traduce la `(req, res)` di
Node nell'`event` e la risposta all'indietro. Due copie della stessa function
si sarebbero scollate al primo ritocco, e a scollarsi sarebbe stato il
controllo dell'origine o del token.

Gli header di sicurezza invece **sono** scritti due volte, perche' i due host
li leggono da file diversi: `public/_headers` e la sezione `headers` di
`vercel.json`. `tests/vercel.js` confronta le due liste riga per riga e
fallisce se qualcuno ne cambia una sola: una CSP diversa fra i due domini e'
esattamente il genere di cosa che nessuno si accorge di aver fatto.

L'allowlist delle origini legge anche `VERCEL_URL`, `VERCEL_BRANCH_URL` e
`VERCEL_PROJECT_PRODUCTION_URL`, che Vercel scrive senza schema: senza il
`https://` davanti la function avrebbe rifiutato la propria pagina.

Da sapere prima di spostarsi: il corpo di una richiesta su Vercel ha un tetto
di circa 4.5MB contro i 6 di Netlify. L'app manda al massimo 3.5MB di foto
codificate, quindi ci sta - ma il margine e' quello, e alzare i limiti in
`public/app.js` lo consumerebbe.

### Il tempo che una function ha per rispondere

Cambia con la casa, e per questo non e' un numero scritto a mano nelle
function ma `S.TEMPO_MASSIMO`. Netlify taglia a 10s e non si discute: da li'
vengono i **9s** storici, tenuti stretti per rispondere un JSON pulito invece
della sua pagina di timeout. Su Vercel il tetto lo scriviamo noi -
`maxDuration: 30` in `vercel.json` - e il budget diventa **22s**.

Non e' un lusso: con 9s, quattro foto da caricare, un Gemini sovraccarico da
scartare e il ripiego su Groq non ci stavano dentro, e chi analizzava un capo
si vedeva "L'AI ci ha messo troppo" su una richiesta che sarebbe arrivata. I
22s stanno sotto il `maxDuration` e sotto i 25s che la pagina aspetta prima di
mollare: a decidere resta il nostro budget, non un taglio di qualcun altro.
`tests/vercel.js` verifica che i tre numeri restino in quest'ordine.

Piu' tempo pero' non basta da solo: sposterebbe solo il momento del guasto.
Una fetta del budget - il 35%, al massimo 8s - e' **riservata a Groq**, e
Gemini non la puo' toccare. Senza, un Gemini sovraccarico si mangiava tutti i
secondi provando un modello dopo l'altro, e chi analizzava un capo si prendeva
l'errore di Gemini invece della risposta di Groq che era li' pronta: il
ripiego esisteva ma restava una promessa mantenuta solo quando avanzava tempo.
`tests/gemini-riserva.js` fa proprio quella scena - Gemini lento e pieno - e
pretende che risponda Groq.

La riserva pero' copriva solo il Gemini che risponde MALE in fretta. Quello che
non risponde affatto arrivava per un'altra strada: la deadline della sua fetta
scade con un tentativo ancora in volo, e diventa un'eccezione (`AI_TIMEOUT`)
che scavalcava il ripiego e finiva dritta nel `catch` del gestore - "L'AI ci ha
messo troppo", con gli otto secondi di Groq mai spesi. Nei log del sito si
riconosce cosi': un `504` con `Error: Deadline superata` e, sopra, un `Gemini
503 ... provo il prossimo` senza nessuna riga di Groq sotto. Ora quella
scadenza torna a essere quello che e' - un motivo per ripiegare come gli altri
- e solo se la riserva esiste davvero: senza Groq configurato la deadline che
scade e' quella vera, e non c'e' niente su cui ripiegare. La scena sta in
`tests/gemini-lento.js`.

E chi era pieno se lo ricorda. Il `503` di Gemini e' la capacita' del piano
gratuito, non un guasto: dura qualche minuto, e colpisce di piu' i modelli
appena usciti - sul sito vero il `3.8-flash` diceva "sono pieno" mentre il
`3.7-flash` rispondeva benissimo. Ripartire ogni volta dal piu' nuovo costava
un tentativo lungo per niente, e con le foto da ricaricare quel tentativo e' il
grosso del budget. Ora un modello che risponde `503` resta fuori per quattro
minuti: abbastanza da non ripetere l'errore a ogni foto, abbastanza pochi da
non restare indietro di una generazione per un blip.

E c'e' un tetto in piu' che il ripiego deve conoscere: il piano gratuito di
Groq limita i **token in uscita al minuto** (1000), mentre per le foto ne
chiediamo 3072. Il rifiuto arriva prima ancora che il modello guardi le
immagini, e nel messaggio Groq scrive quanti ne accetta: si riprova una volta
chiedendone meno. Una risposta piu' corta e' meglio di nessuna risposta - ed
era esattamente il caso in cui il ripiego serviva davvero, con la quota
giornaliera di Gemini finita. Un 429 di altro tipo (richieste al giorno) non
fa riprovare: chiedere meno non lo curerebbe.

E c'e' un secondo tetto, quello che si tocca per primo con le foto: i token in
**entrata** al minuto. Sul piano gratuito sono 7000, e una singola analisi con
le foto ne chiede quasi 7000 da sola - cioe' **una foto al minuto**, quando
Gemini non c'e'. Non e' aggirabile dal codice: quello che si puo' fare e'
dirlo. Groq scrive nel rifiuto quanto manca ("try again in 46.68s"), e quel
numero finisce nel messaggio che legge chi sta usando l'app: *riprova fra 47
secondi* invece di "riprova tra qualche secondo", che con 47 secondi davanti
fa premere il bottone sei volte per niente.

Con un'eccezione che conta: se il ricordo li ha saltati **tutti**, si prova lo
stesso. Serve a non sprecare un tentativo quando c'e' un'alternativa, non a
tenere Gemini chiuso fuori per quattro minuti - la capacita' del piano
gratuito torna quando torna, e l'unico modo di saperlo e' chiedere.

### Importare il progetto su Vercel

1. **vercel.com/new** > *Import Git Repository* > `damianovecchio6-oss/Damn_Vinted`.
   Non c'e' niente da configurare: `vercel.json` dice gia' che non si builda
   niente e che si pubblica `public/`.
2. **Settings > Environment Variables**: almeno `GROQ_API_KEY`, piu'
   `GEMINI_API_KEY` e `SERPAPI_KEY` se le vuoi (stessa tabella qui sopra).
   Le leggono solo le function.
3. La verifica e' la stessa di Netlify, l'URL cambia:

   ```
   node scripts/verifica-deploy.js https://iltuoprogetto.vercel.app
   ```

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
