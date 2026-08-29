# Damn Vinted

Assistente per vendere su Vinted: analizza le foto di un capo, scrive
l'annuncio e stima il prezzo. Sito statico + due Netlify Function.

```
index.html                    tutta l'interfaccia (markup, stile, script)
netlify/functions/claude.js   proxy verso i modelli AI (Groq / Gemini)
netlify/functions/lens.js     ricerca per immagine (Google Lens via SerpApi)
netlify/functions/lib/        codice condiviso dalle due function
```

Non c'e' build, non ci sono dipendenze npm: si apre `index.html` e funziona.

## Variabili d'ambiente

Si impostano su Netlify in **Site configuration > Environment variables**.
Solo la prima e' obbligatoria; le altre due accendono funzionalita' in piu' e
senza di loro il sito continua a funzionare come prima.

| Variabile | Serve a | Obbligatoria |
|---|---|---|
| `GROQ_API_KEY` | Scrittura annuncio, stima prezzo, e analisi foto se manca Gemini | Si' |
| `GEMINI_API_KEY` | Analisi foto: legge il testo delle etichette molto meglio | No |
| `SERPAPI_KEY` | Bottone "Identifica prodotto" (ricerca per immagine) | No |

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

### SERPAPI_KEY — identificazione del prodotto

Fa comparire il bottone "Identifica prodotto" sotto l'analisi: cerca la foto
con Google Lens, riporta i prodotti riconosciuti con i loro prezzi di listino,
e quei prezzi finiscono nel prompt della stima come dato di mercato vero.

1. Vai su **serpapi.com**, registrati.
2. Copia la chiave dalla dashboard (**Your Account > API Key**).
3. Incollala in `SERPAPI_KEY` su Netlify.

Piano gratuito: 250 ricerche al mese. Senza la chiave la function risponde 501
e la pagina nasconde il bottone da sola.

### Le altre, tutte opzionali

| Variabile | Default | A cosa serve |
|---|---|---|
| `GROQ_MODEL_TEXT` | `openai/gpt-oss-120b` | Fissa il modello di testo |
| `GROQ_MODEL_VISION` | `meta-llama/llama-4-scout-17b-16e-instruct` | Fissa il modello con visione di Groq |
| `GEMINI_MODEL` | scelto dal catalogo | Fissa il modello Gemini |
| `RATE_LIMIT_PER_MIN` | `20` | Richieste al minuto per IP (`0` disattiva) |
| `AI_TIMEOUT_MS` | `9000` | Budget di una richiesta AI |
| `LENS_TIMEOUT_MS` | `9000` | Budget di una ricerca per immagine |
| `SESSION_SECRET` | derivato da `GROQ_API_KEY` | Firma dei token di sessione |
| `ALLOWED_ORIGINS` | vuoto | Domini extra ammessi, separati da virgola |

I nomi dei modelli cambiano spesso, e i provider li ritirano senza preavviso:
per questo le function non si fidano dei valori di default. Se il modello non
esiste piu' chiedono il catalogo e ripiegano da sole, e il modello che ha
davvero risposto compare sotto il risultato dell'analisi.

## Come si usa l'analisi foto

Fino a 4 foto. Il marcatore 🏷️ su un'anteprima dice "questa e' l'etichetta":
quella foto viene mandata **a parte e a piena risoluzione**, con una richiesta
che chiede solo di trascrivere quello che c'e' scritto. Quello che si legge
sull'etichetta sovrascrive quello che il modello ha dedotto guardando il capo.

Senza marcatore l'analisi funziona lo stesso, ma marca, composizione e taglia
restano una deduzione dall'aspetto - cioe' la cosa che sbagliava di piu'.
