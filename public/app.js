// Tutto lo script della pagina. Stava dentro <script> in index.html, e finche'
// stava li' la CSP era costretta a concedere script-src 'unsafe-inline': un
// permesso che vale per qualunque script inline, non solo per il nostro.
// Da fuori il permesso non serve piu'.
//
// Resta un file classico e non un modulo: le funzioni dichiarate qui sono
// globali, ed e' cosi' che il dispatcher in fondo le raggiunge per nome.

let selFiles=[], selTone="amichevole e informale", lastAnalysis=null, currentItemId=null, lastThumbnail=null;
let lastItemSig=null, lastAnnuncioText='', prevUrls=[], lastModel=null, lastProvider=null;
// Quale foto ritrae l'etichetta, e cosa ci si e' letto sopra.
let labelIndex=-1, lastEtichetta=null, lastLens=null, lastGemini=null;

const SCHEDE=['sole','foto','annuncio','prezzo','ricerca','storico','scanner'];
let schedaCorrente='sole';

// Meno movimento se il sistema lo chiede: vale anche per lo scorrimento, che
// il CSS non puo' fermare.
const menoMovimento=()=>window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Girando la ghiera parcheggiata la scheda cambia a ogni scatto, e scorrere
// in cima a ognuna vuol dire far ballare la pagina sotto al dito per tutto il
// giro - sei funzioni, sei salti. Mentre giri la pagina sta ferma; in cima ci
// si va una volta sola, quando ti fermi.
let scorriDopoIlGiro=null;
function inCimaQuandoTiFermi(){
  clearTimeout(scorriDopoIlGiro);
  scorriDopoIlGiro=setTimeout(inCima, 260);
}
function inCima(){
  window.scrollTo({top:0,behavior:menoMovimento()?'auto':'smooth'});
}

// Torna true se la scheda e' cambiata davvero: chi ha gia' spostato la ghiera
// per arrivare qui deve sapere se rimetterla a posto.
function sw(n, opzioni){
  const pannello=document.getElementById('tab-'+n);
  if(!pannello) return false;
  // Tutta la navigazione passa da qui - i raggi, la ghiera, i bottoni "usa per
  // la stima" - quindi qui si chiede, una volta sola. Metterlo su ogni strada
  // vuol dire dimenticarsene una, e sara' proprio quella che usa la gente.
  if(n!==schedaCorrente && !viaLibera(n)) return false;
  // La scheda entra dal lato da cui l'hai chiamata: seguire il movimento costa
  // meno che ritrovare da capo dove sei finito.
  const daDestra=SCHEDE.indexOf(n) > SCHEDE.indexOf(schedaCorrente);
  schedaCorrente=n;

  document.querySelectorAll('.tp').forEach(p=>p.classList.remove('on','daDestra'));
  pannello.classList.add('on');
  pannello.classList.toggle('daDestra', daDestra);
  document.body.classList.toggle('home', n==='sole');
  // Il sole non sparisce mai: o e' al centro, o e' parcheggiato sul bordo.
  const sole=document.getElementById('soleApp');
  if(sole) sole.classList.toggle('parcheggiato', n!=='sole');

  // Il disco dice sempre dove sei: se ci si arriva da un bottone invece che
  // dalla ghiera, la ghiera deve seguire, o il sole parcheggiato mostrerebbe
  // il nome di una funzione che non e' quella aperta.
  sincronizzaGhiera(n);

  if(n==='storico') renderHistory();
  if(n==='ricerca') prefillRicerca();
  if(n==='scanner') syncUploadUI();

  if(opzioni && opzioni.senzaScorrimento) return true;
  // Una scorsa vera annulla quella rimandata: se sei arrivato qui da un
  // bottone mentre un giro si stava assestando, non deve scorrere due volte.
  clearTimeout(scorriDopoIlGiro);
  inCima();
  return true;
}



// Una vibrazione corta sui momenti che valgono l'attesa: analisi finita,
// rapporto pronto, prezzo stimato. Non a ogni tocco, o diventa rumore.
function tocco(ms){
  try{ if(navigator.vibrate && !menoMovimento()) navigator.vibrate(ms||12); }catch(e){}
}

/* ===== LA GHIERA =====
   Il principio dell'iPod classic: la ruota sta ferma, il dito ci gira intorno
   e la selezione salta di voce in voce con uno scatto per volta. Qui le voci
   sono i sei raggi, il disco al centro fa da schermo (dice cosa stai per
   aprire) e da tasto: si preme li' per entrare.

   Restano tutte le strade di prima: il tocco secco su un raggio lo apre, Tab e
   Invio pure. La ghiera si aggiunge, non sostituisce. */
const RAGGI = Array.from(document.querySelectorAll('.raggio'));
// Quanti gradi di dito valgono uno scatto. Con sei voci un sesto di giro
// (60°) sarebbe il rapporto "vero", ma il pollice su uno schermo piccolo fa
// giri corti: 45° e' la distanza a cui gli scatti si sentono senza doversi
// sbracciare. E resta 45 anche adesso che i raggi sono sei: il numero di
// scatti per fare il giro completo lo decide RAGGI.length, non questo.
const GRADI_PER_SCATTO = 45;
let selezione = 0;
// Vero se il giro appena finito ha fatto scattare la ghiera. Il rilascio del
// dito genera comunque un click, e se il dito era fermo su un raggio quel
// click lo aprirebbe: qui si distingue "ho girato" da "ho toccato". A tempo
// (un quarto di secondo) mangiava anche i tocchi veri subito dopo un giro.
let giroConScatti = false;
// Il tocco lo gestiamo sul rilascio del dito e non sul click, perche' il click
// sul telefono non arriva sempre: dopo un giro il browser lo sopprime, e il
// tasto centrale non apriva niente. Il click resta per mouse e tastiera, con
// questa spia che evita di fare la stessa cosa due volte.
let attivatoDaTocco = false, partenza = null;

function nomeDi(raggio){
  const eti = raggio.querySelector('.rEti');
  return eti ? eti.textContent : '';
}

// Serve sia dentro il blocco della ghiera sia fuori (a scatta e a
// mostraSelezione, che stanno prima): tenerla qui evita di dipendere
// dall'ordine in cui il file viene letto.
function soleParcheggiato(){
  const s = document.getElementById('soleApp');
  return !!(s && s.classList.contains('parcheggiato'));
}

// Chiamata da sw(): allinea la ghiera alla scheda che si sta aprendo, da
// qualunque parte arrivi la richiesta (un raggio, un bottone "usa per...",
// il ritorno dallo storico).
function sincronizzaGhiera(scheda){
  const i = RAGGI.findIndex(r=>r.dataset.scheda===scheda);
  if(i<0 || i===selezione) return;
  selezione = i;
  mostraSelezione();
}

function mostraSelezione(){
  RAGGI.forEach((r,i)=>r.classList.toggle('selezionato', i===selezione));
  const nome = nomeDi(RAGGI[selezione]);
  const display = document.getElementById('dScelta');
  if(display) display.textContent = nome;
  const disco = document.querySelector('.disco');
  if(disco) disco.setAttribute('aria-label', soleParcheggiato()
    ? nome+' — tocca per tornare a scegliere'
    : 'Apri '+nome);
}

// Uno scatto per volta, e a ogni scatto la vibrazione corta: e' il "click"
// della ghiera, l'unica cosa che rende il giro una cosa che si sente e non
// solo si guarda.
function scatta(verso){
  const prima = selezione;
  selezione = (selezione + verso + RAGGI.length) % RAGGI.length;
  mostraSelezione();
  tocco(6);
  // A casa il giro sceglie e basta: si entra premendo al centro. Da
  // parcheggiato invece il giro CAMBIA funzione mentre lo fai - il contenuto
  // sopra si sostituisce a ogni scatto - perche' li' il sole non e' piu' un
  // menu da confermare, e' la manopola con cui passi da una funzione
  // all'altra senza tornare indietro ogni volta.
  if(soleParcheggiato()){
    // Da parcheggiato lo scatto E' il cambio scheda: se il cambio viene
    // rifiutato - un giro in corso e l'utente che risponde di no - la ghiera
    // deve tornare sullo scatto di prima, o il disco annuncerebbe una funzione
    // mentre sotto ne resta aperta un'altra.
    if(!sw(RAGGI[selezione].dataset.scheda, { senzaScorrimento:true })){
      selezione = prima;
      mostraSelezione();
      return false;
    }
    inCimaQuandoTiFermi();
  }
  return true;
}

function apriRaggio(raggio){
  const scheda = raggio.dataset.scheda;
  if(!scheda) return;
  const prima = selezione;
  selezione = RAGGI.indexOf(raggio);
  mostraSelezione();
  raggio.classList.add('scelto');
  tocco(10);
  setTimeout(()=>raggio.classList.remove('scelto'), 520);
  // Come per lo scatto: il raggio si accende prima di sapere se la scheda si
  // apre davvero, quindi se il cambio viene rifiutato va rispento.
  if(!sw(scheda)){ selezione = prima; mostraSelezione(); }
}

RAGGI.forEach(raggio=>{
  raggio.addEventListener('keydown', e=>{
    if(e.key==='Enter'||e.key===' '){ e.preventDefault(); apriRaggio(raggio); }
  });
});

const soleApp = document.getElementById('soleApp');
if(soleApp){
  const disegno = soleApp.querySelector('.soleNav');
  const parcheggiato = ()=>soleApp.classList.contains('parcheggiato');
  const daRaggio = e => !!(e.target && e.target.closest && e.target.closest('.raggio'));

  /* --- il giro del dito --- */
  let giro = null;

  const angolo = (e, centro)=>Math.atan2(e.clientY - centro.y, e.clientX - centro.x) * 180 / Math.PI;

  // Un disegno e' trascinabile di default, e il trascinamento nativo si mangia
  // movimenti e rilascio: la ghiera si bloccava dopo il primo giro. Va fermato
  // qui e non sul pointerdown, dove porterebbe via anche il tap sul telefono.
  soleApp.addEventListener('dragstart', e=>e.preventDefault());

  soleApp.addEventListener('pointerdown', e=>{
    // Ogni tocco nuovo riparte pulito: se il ripristino stesse dopo i
    // controlli qui sotto, un tocco al centro (che li salta) resterebbe
    // marchiato come "fine di un giro" e non aprirebbe niente.
    giroConScatti = false;
    partenza = { x:e.clientX, y:e.clientY };
    // Niente scorciatoia per il sole parcheggiato: da li' il giro deve
    // funzionare come a casa, e' proprio quello il punto. Quello che cambia
    // e' cosa fa uno scatto (vedi scatta), non come lo si fa.
    const r = disegno.getBoundingClientRect();
    const centro = { x:r.x + r.width/2, y:r.y + r.height/2 };
    // Il dito deve partire sulla corona, non sul disco: al centro c'e' il tasto.
    const distanza = Math.hypot(e.clientX - centro.x, e.clientY - centro.y);
    if(distanza < r.width * 0.17) return;
    giro = { centro, ultimo:angolo(e, centro), residuo:0 };
    // I movimenti si ascoltano sulla finestra, non sul sole: girando, il dito
    // esce e rientra dal disegno in continuazione, e dentro un <svg> il vuoto
    // non riceve eventi. (setPointerCapture sembrava la strada giusta, ma
    // reggeva un giro solo: dal secondo in poi i movimenti non arrivavano
    // piu' e la ghiera restava ferma.)
    window.addEventListener('pointermove', muoviGhiera);
    window.addEventListener('pointerup', finisciGiro);
    window.addEventListener('pointercancel', finisciGiro);
  });

  function muoviGhiera(e){
    if(!giro) return;
    const ora = angolo(e, giro.centro);
    // Il salto fra +180 e -180 non e' mezzo giro del dito: va riportato dentro.
    let delta = ora - giro.ultimo;
    if(delta > 180) delta -= 360;
    if(delta < -180) delta += 360;
    giro.ultimo = ora;
    giro.residuo += delta;

    while(Math.abs(giro.residuo) >= GRADI_PER_SCATTO){
      const verso = giro.residuo > 0 ? 1 : -1;
      giro.residuo -= verso * GRADI_PER_SCATTO;
      const fatto = scatta(verso);
      giroConScatti = true;
      // Un colpo di pollice fra due movimenti puo' valere tre o quattro scatti
      // in fila: se il primo si becca un "no" alla conferma, gli altri
      // alzerebbero altre tre finestre uguali per un gesto solo, che e'
      // esattamente il modo di insegnare a rispondere senza leggere. Detto no
      // una volta, il resto del gesto si butta.
      if(!fatto){ giro.residuo = 0; break; }
    }
  }

  function finisciGiro(){
    giro = null;
    window.removeEventListener('pointermove', muoviGhiera);
    window.removeEventListener('pointerup', finisciGiro);
    window.removeEventListener('pointercancel', finisciGiro);
  }

  /* --- la rotella del mouse fa lo stesso lavoro del dito --- */
  soleApp.addEventListener('wheel', e=>{
    e.preventDefault();
    scatta(e.deltaY > 0 || e.deltaX > 0 ? 1 : -1);
  }, { passive:false });

  /* --- l'attivazione: un raggio, il tasto centrale, o il ritorno --- */
  function attiva(e){
    if(parcheggiato()){ tocco(8); sw('sole'); return; }
    const raggio = e.target && e.target.closest && e.target.closest('.raggio');
    // Fuori dai raggi si e' premuto il centro: apre quello che il disco mostra.
    apriRaggio(raggio || RAGGI[selezione]);
  }

  soleApp.addEventListener('pointerup', e=>{
    const da = partenza;
    partenza = null;
    if(giroConScatti) return;                 // era un giro, non un tocco
    if(da && Math.hypot(e.clientX - da.x, e.clientY - da.y) > 12) return;
    attivatoDaTocco = true;
    setTimeout(()=>{ attivatoDaTocco = false; }, 500);
    attiva(e);
  });

  soleApp.addEventListener('click', e=>{
    if(attivatoDaTocco) return;  // ci ha gia' pensato il rilascio del dito
    if(giroConScatti) return;    // era la fine di un giro
    attiva(e);
  });

  disegno.setAttribute('tabindex','0');
  disegno.setAttribute('role','application');
  disegno.setAttribute('aria-label','Ghiera: frecce per scorrere le funzioni, Invio per aprire');
  disegno.addEventListener('keydown', e=>{
    if(daRaggio(e)) return;
    // Le frecce girano la ghiera dovunque sia il sole: a casa scelgono, da
    // parcheggiato cambiano funzione. Invio a casa apre, da parcheggiato
    // riporta al sole intero - e' il solo tasto che cambia significato.
    if(e.key==='ArrowRight'||e.key==='ArrowDown'){ e.preventDefault(); scatta(1); }
    else if(e.key==='ArrowLeft'||e.key==='ArrowUp'){ e.preventDefault(); scatta(-1); }
    else if(e.key==='Enter'||e.key===' '){
      e.preventDefault();
      if(parcheggiato()){ tocco(8); sw('sole'); }
      else apriRaggio(RAGGI[selezione]);
    }
  });
}

mostraSelezione();

document.querySelectorAll('#toneChips .chip').forEach(c=>{
  const pick=()=>{
    document.querySelectorAll('#toneChips .chip').forEach(x=>{
      x.classList.remove('on'); x.setAttribute('aria-pressed','false');
    });
    c.classList.add('on'); c.setAttribute('aria-pressed','true'); selTone=c.dataset.t;
  };
  c.addEventListener('click',pick);
  // I chip sono <span>: senza questo Invio e Spazio non li attivano.
  c.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===' '){ e.preventDefault(); pick(); }
  });
});

// Le foto sono le stesse per l'analisi e per lo scanner: chi le sceglie di la'
// se le ritrova di qua, con lo stesso marcatore sull'etichetta. Due copie dello
// stesso stato vorrebbero dire scegliere due volte le stesse quattro foto.
const BOX_FOTO=[
  { box:'ubox', label:'ulabel', ps:'ps', btn:'btnA' },
  { box:'sxBox', label:'sxLabel', ps:'sxPs', btn:'btnSx' }
];

['fileInput','sxFile'].forEach(id=>{
  const input=document.getElementById(id);
  if(!input) return;
  input.addEventListener('change',function(e){
    const picked=Array.from(e.target.files||[]);
    // Azzerare il value permette di riselezionare lo stesso file una seconda volta.
    e.target.value='';
    if(!picked.length) return; // picker annullato: non buttiamo via quello che c'era
    selFiles=picked.slice(0,4);
    currentItemId=null; lastItemSig=null; lastAnalysis=null; lastThumbnail=null;
    labelIndex=-1; lastEtichetta=null; lastLens=null;
    // Foto nuove = capo nuovo: la ricerca di quello di prima non deve restare
    // in giro, ne' nella scheda ne' dentro al prompt della stima.
    resetRicerca(); resetScanner();
    renderPrev(); syncUploadUI();
  });
});

function syncUploadUI(){
  const testo=selFiles.length
    ? (labelIndex>=0
        ? `${selFiles.length} foto — etichetta: la ${labelIndex+1}ª`
        : `${selFiles.length} foto — 🏷️ segna quale mostra l'etichetta`)
    : 'Tocca per scegliere la foto';
  BOX_FOTO.forEach(b=>{
    const box=document.getElementById(b.box);
    if(box) box.classList.toggle('has',selFiles.length>0);
    const label=document.getElementById(b.label);
    if(label) label.textContent=testo;
    const btn=document.getElementById(b.btn);
    if(btn) btn.disabled=selFiles.length===0;
  });
}

function renderPrev(){
  prevUrls.forEach(u=>URL.revokeObjectURL(u));
  prevUrls=[];
  // Un solo URL per foto, mostrato in tutte e due le schede: revocarlo alla
  // scelta successiva li spegne entrambi insieme.
  const html=selFiles.map((f,i)=>{
    const url=URL.createObjectURL(f);
    prevUrls.push(url);
    const tag=i===labelIndex;
    return `<div class="pw${tag?' tag':''}">`
      + `<img src="${url}" class="pi" alt="Anteprima foto ${i+1}"/>`
      + `<button class="pd" data-az="delFile" data-arg="${i}" aria-label="Rimuovi foto ${i+1}">×</button>`
      + `<button class="pt${tag?' on':''}" data-az="segnaEtichetta" data-arg="${i}" aria-pressed="${tag}" `
      + `title="Questa foto mostra l'etichetta" aria-label="Segna la foto ${i+1} come etichetta">🏷️</button>`
      + `</div>`;
  }).join('');
  BOX_FOTO.forEach(b=>{
    const ps=document.getElementById(b.ps);
    if(ps) ps.innerHTML=html;
  });
}

// La foto marcata viene mandata in una richiesta a parte, a piena risoluzione:
// e' l'unico modo perche' il modello legga davvero marca e composizione invece
// di dedurle. Ritoccare la stessa foto due volte costa meno che mandarle tutte
// grandi e sfondare il limite di body.
function segnaEtichetta(i){
  labelIndex = labelIndex===i ? -1 : i;
  renderPrev(); syncUploadUI();
  toast(labelIndex>=0?'🏷️ Foto etichetta impostata':'Nessuna foto etichetta');
}

function delFile(i){
  selFiles.splice(i,1);
  if(labelIndex===i) labelIndex=-1;
  else if(labelIndex>i) labelIndex--;
  renderPrev(); syncUploadUI();
}

const AI_TIMEOUT_MS=25000;
const AI_URL='/.netlify/functions/claude';

// AbortSignal.timeout non c'e' sui browser piu' vecchi: li' restiamo senza
// timeout invece di far esplodere la fetch.
function timeoutSignal(ms){
  try{ return AbortSignal.timeout(ms); }catch(e){ return undefined; }
}

// La function rilascia un token legato all'IP e valido 15 minuti. Lo teniamo
// in memoria e lo rinnoviamo da soli: l'utente non deve accorgersene mai.
let sessionToken=null, sessionTokenExp=0, tokenInFlight=null;

function fetchSessionToken(){
  // Due richieste in parallelo (analisi + prezzo) devono chiedere un token solo.
  if(tokenInFlight) return tokenInFlight;
  tokenInFlight=fetch(AI_URL,{method:'GET',signal:timeoutSignal(10000)})
    .catch(()=>{ throw new Error('Connessione fallita. Controlla la rete e riprova.'); })
    .then(r=>r.ok?r.json():null)
    .then(d=>{
      if(!d||!d.token) throw new Error('Sessione non disponibile. Ricarica la pagina.');
      sessionToken=d.token;
      // Rinnoviamo un minuto prima della scadenza vera: meglio un token in
      // piu' che una richiesta respinta a meta' analisi.
      sessionTokenExp=Date.now()+Math.max(0,(d.expiresIn||900000)-60000);
      return sessionToken;
    })
    .finally(()=>{ tokenInFlight=null; });
  return tokenInFlight;
}

function getSessionToken(force){
  if(!force && sessionToken && Date.now()<sessionTokenExp) return Promise.resolve(sessionToken);
  if(force) sessionToken=null;
  return fetchSessionToken();
}

const UNAUTHORIZED=Symbol('unauthorized');

// Un solo giro di token per tutti gli endpoint della funzione.
async function chiamaEndpoint(url, payload){
  let d=await inviaA(url, payload, await getSessionToken(false));
  // 401 = token scaduto, oppure siamo finiti su un'istanza che non lo conosce.
  // Se ne prende uno nuovo e si riprova una volta sola, in silenzio.
  if(d===UNAUTHORIZED) d=await inviaA(url, payload, await getSessionToken(true));
  if(d===UNAUTHORIZED) throw new Error('Sessione non valida. Ricarica la pagina e riprova.');
  return d;
}

async function callAI(payload){
  const d=await chiamaEndpoint(AI_URL, payload);
  if(typeof d.text!=='string') throw new Error('Risposta del server non leggibile. Riprova.');
  lastModel=d.model||null;
  lastProvider=d.provider||null;
  // Perche' le foto NON sono passate da Gemini, quando Gemini era la scelta
  // giusta: senza, "groq" da solo non distingue una chiave che manca da una
  // quota finita, e sono due problemi con due rimedi diversi.
  lastGemini=d.gemini||null;
  return d.text;
}

async function inviaA(url, payload, token){
  let r;
  try{
    r=await fetch(url,{
      method:'POST',
      headers:{'Content-Type':'application/json','X-Session-Token':token},
      body:JSON.stringify(payload),
      signal:timeoutSignal(AI_TIMEOUT_MS)
    });
  }catch(netErr){
    // Senza questo, una rete che si pianta lasciava girare lo spinner all'infinito.
    if(netErr&&(netErr.name==='TimeoutError'||netErr.name==='AbortError'))
      throw new Error('L\'AI ci ha messo troppo. Riprova.');
    throw new Error('Connessione fallita. Controlla la rete e riprova.');
  }
  if(r.status===401) return UNAUTHORIZED;
  // Netlify puo' rispondere con HTML (timeout, 502): non diamo per scontato il JSON.
  const raw=await r.text();
  let d=null;
  try{ d=raw?JSON.parse(raw):null; }catch(parseErr){ d=null; }
  // 501 va riconosciuto PRIMA del controllo generico sull'errore nel corpo:
  // anche il 501 porta un messaggio, e senza questo ordine il chiamante non
  // riusciva a distinguere "non configurato" da un guasto qualunque.
  if(r.status===501){
    const e=new Error((d&&d.error)||'Funzione non configurata sul server.');
    e.nonConfigurato=true;
    throw e;
  }
  if(d&&d.error){
    const e=new Error(d.error);
    // Il server non dice solo "e' troppo": dice DI COSA. 'byte' si cura
    // rimpicciolendo, 'token' si cura mandando meno foto - rimpicciolire li'
    // non basta, e insistere sarebbe solo tempo perso.
    if(d.pesante) e.troppoPesante=d.pesante;
    if(d.dettaglio) e.dettaglio=d.dettaglio;
    throw e;
  }
  if(!r.ok){
    if(r.status===504||r.status===502) throw new Error('L\'AI ci ha messo troppo. Riprova tra un momento.');
    if(r.status===429) throw new Error('Troppe richieste. Aspetta un attimo e riprova.');
    if(r.status===413){
      const e=new Error('Foto troppo pesanti. Prova con meno immagini.');
      e.troppoPesante='byte';
      throw e;
    }
    throw new Error(`Errore del server (HTTP ${r.status}). Riprova.`);
  }
  if(!d) throw new Error('Risposta del server non leggibile. Riprova.');
  return d;
}

// Il modello risponde con del JSON, ma quasi mai SOLO con quello. I modelli
// che ragionano ad alta voce - la famiglia Qwen3, che su Groq e' l'unica con
// visione rimasta - premettono un blocco <think>; altri incorniciano coi
// backtick, o aggiungono una frase di cortesia prima e dopo. Il codice diceva
// gia' di affidarsi al "parsing tollerante lato client", ma tollerante non
// era: toglieva i backtick e basta, e su tutto il resto si arrendeva.
function estraiJson(raw){
  const testo=String(raw==null?'':raw);
  const pulito=testo
    .replace(/<think>[\s\S]*?<\/think>/gi,'')
    // Un <think> che non si chiude vuol dire risposta tagliata a meta' del
    // ragionamento: da li' in poi non c'e' niente da salvare.
    .replace(/<think>[\s\S]*$/i,'')
    .replace(/```(?:json)?/gi,'')
    .trim();

  // Prima si prova il testo intero: se il modello ha risposto pulito, e'
  // finita qui. Poi si va a prendere l'oggetto piu' esterno, che e' quello
  // che salva le risposte con del discorso intorno.
  const prove=[pulito];
  const apre=pulito.indexOf('{'), chiude=pulito.lastIndexOf('}');
  if(apre>=0 && chiude>apre) prove.push(pulito.slice(apre, chiude+1));

  for(const prova of prove){
    if(!prova) continue;
    try{
      const dati=JSON.parse(prova);
      if(dati && typeof dati==='object') return dati;
    }catch(e){}
  }
  return null;
}

// Le funzioni AI ripetevano lo stesso identico giro: interpreta il JSON, e se
// non ci riesci arrangiati col testo grezzo.
async function callAIJson(payload){
  const raw=await callAI(payload);
  const data=estraiJson(raw);
  return data ? { ok:true, data, raw } : { ok:false, data:null, raw };
}

// Un'azione AI alla volta per scheda. Senza, "Genera annuncio", "Rigenera" e
// "Stima prezzo" partivano N volte se premuti N volte: N chiamate, N voci di
// storico, e vinceva l'ultima risposta arrivata, non l'ultima chiesta.
const running={};
function busy(key, btnIds){
  if(running[key]) return false;
  running[key]=true;
  btnIds.forEach(id=>{ const b=document.getElementById(id); if(b) b.disabled=true; });
  attesaBottone(btnIds[0], true);
  aggiornaGuardia();
  return true;
}
function idle(key, btnIds){
  running[key]=false;
  btnIds.forEach(id=>{ const b=document.getElementById(id); if(b) b.disabled=false; });
  attesaBottone(btnIds[0], false);
  aggiornaGuardia();
}

// Chi sta lavorando lo sa gia' running: questi sono soltanto i nomi per dirlo
// a voce. Una domanda che chiede "sei sicuro?" non fa decidere nessuno, perche'
// non dice cosa c'e' in ballo; una che dice "sta lavorando la scansione" si'.
const NOME_GIRO={
  foto:"l'analisi delle foto",
  lens:'la ricerca visiva',
  annuncio:"la scrittura dell'annuncio",
  prezzo:'la stima del prezzo',
  ricerca:"la ricerca dell'agente",
  scanner:'la scansione'
};
// E dove scrive ciascuno. Serve a non chiedere niente a chi sta TORNANDO a
// guardare il giro che lavora: quello e' il contrario di perderlo di vista.
// La ricerca visiva vive nella scheda delle foto, gli altri hanno la scheda
// che porta il loro nome.
const SCHEDA_GIRO={ foto:'foto', lens:'foto', annuncio:'annuncio', prezzo:'prezzo', ricerca:'ricerca', scanner:'scanner' };
function giriInCorso(scheda){
  return Object.keys(running).filter(k=>running[k] && SCHEDA_GIRO[k]!==scheda).map(k=>NOME_GIRO[k]||k);
}

// Lo scanner e l'agente sono pipeline da decine di secondi, e non c'e' niente
// che le tenga: una ricarica a meta' - il telefono che rinfresca la scheda
// rimasta in secondo piano, il pollice che prende il tasto sbagliato - buttava
// via tutto quello che era stato scoperto senza dire una parola, mentre le
// richieste gia' partite continuavano a consumare quota.
// Il dialogo del browser non si puo' scrivere, ma si puo' decidere QUANDO
// esiste: appeso sempre, chiederebbe conferma anche a pagina ferma, e chi lo
// vede tre volte a vuoto impara a premere "esci" senza leggere - proprio alla
// quarta, quella che contava. Quindi lo si appende solo finche' running ha
// almeno una chiave accesa, e lo si stacca appena l'ultima si spegne.
let guardiaAppesa=false;
function guardiaUscita(e){ e.preventDefault(); e.returnValue=''; return ''; }
function aggiornaGuardia(){
  const serve=giriInCorso().length>0;
  if(serve===guardiaAppesa) return;
  guardiaAppesa=serve;
  if(serve) window.addEventListener('beforeunload', guardiaUscita);
  else window.removeEventListener('beforeunload', guardiaUscita);
}

// Cambiare scheda non ferma la richiesta gia' partita: la porta via dagli
// occhi. Il diario dello scanner continua a scriversi in un pannello che non
// stai piu' guardando, e la ricarica che quasi sempre segue lo cancella. Basta
// uno scatto di ghiera di troppo col pollice per finire li'. Quindi si chiede
// prima, e si dice cosa c'e' sul fuoco.
function viaLibera(n){
  const giri=giriInCorso(n);
  if(!giri.length) return true;
  return confirm('Sta lavorando '+giri.join(' e ')+'. Se cambi scheda il giro va avanti da solo ma smetti di vederlo, e se la pagina si ricarica perdi tutto quello che ha trovato. Cambiare comunque?');
}

// Disabilitati lo diventano tutti: quello che sta lavorando si riconosce dallo
// spinner. La scritta resta la sua, cosi' non balla la larghezza del bottone.
function attesaBottone(id, attiva){
  const b=id && document.getElementById(id);
  if(!b) return;
  b.classList.toggle('attesa', attiva);
  const gia=b.querySelector('.bspin');
  if(attiva && !gia) b.insertAdjacentHTML('afterbegin','<span class="spin bspin" aria-hidden="true"></span>');
  if(!attiva && gia) gia.remove();
}
const BTN_FOTO=['btnA'], BTN_ANN=['btnG','btnR'], BTN_PRE=['btnP'], BTN_LENS=['btnL'];
const LENS_URL='/.netlify/functions/lens';

// createImageBitmap decodifica fuori dal main thread: la UI non si blocca
// mentre si aprono 4 foto da fotocamera. Dove manca, si torna a <img>.
function decodeImage(file){
  if(typeof createImageBitmap==='function'){
    // imageOrientation esplicito: senza, una foto scattata col telefono in
    // verticale puo' finire ruotata sul canvas, e il modello la analizza cosi'.
    return createImageBitmap(file,{imageOrientation:'from-image'})
      .catch(function(){ return createImageBitmap(file); })
      .catch(function(){ return decodeViaImg(file); });
  }
  return decodeViaImg(file);
}

function decodeViaImg(file){
  return new Promise(function(res,rej){
    var img=new Image();
    var url=URL.createObjectURL(file);
    img.onload=function(){ URL.revokeObjectURL(url); res(img); };
    img.onerror=function(){ URL.revokeObjectURL(url); rej(new Error('Caricamento immagine fallito')); };
    img.src=url;
  });
}

var encodeCanvas=null;
function encodeImage(source, maxSize, quality){
  maxSize=maxSize||800; quality=quality||0.75;
  var w=source.width, h=source.height;
  if(w>maxSize||h>maxSize){
    if(w>h){ h=Math.round(h*maxSize/w); w=maxSize; }
    else{ w=Math.round(w*maxSize/h); h=maxSize; }
  }
  // Un solo canvas riusato invece di uno nuovo per ogni codifica.
  if(!encodeCanvas) encodeCanvas=document.createElement('canvas');
  encodeCanvas.width=w; encodeCanvas.height=h;
  encodeCanvas.getContext('2d').drawImage(source,0,0,w,h);
  return encodeCanvas.toDataURL('image/jpeg', quality).split(',')[1];
}

function releaseImage(source){ if(source&&source.close) source.close(); }

// Il tetto NON e' quello di Netlify (6MB di body): e' quello di Groq, che
// rifiuta con un 400 ogni richiesta con base64 sopra i 4MB - quattro mega per
// RICHIESTA, non per immagine. Il vecchio budget di 4.2MB stava sopra quel
// limite, quindi quattro foto pesanti passavano il nostro controllo e si
// prendevano un 400 dal provider: "Il modello ha rifiutato la richiesta",
// che non diceva niente di vero. 3.6MB lascia spazio al prompt e al JSON
// intorno e resta comodamente sotto.
const MAX_PAYLOAD_B64=3*1024*1024;
// La precisione dipende quasi tutta da quanto resta leggibile l'etichetta: a
// 1024px il testo di un cartellino diventa poltiglia. Quindi si parte alti e
// si scende solo quanto basta a starci, invece di prendere un 413 in faccia.
const ENCODE_STEPS=[[1600,0.92],[1280,0.86],[1024,0.78],[800,0.7]];

// L'etichetta parte in una richiesta tutta sua, quindi ha il budget intero a
// disposizione - ma un budget ce l'ha: a piena risoluzione una foto da 12
// megapixel supera i 4MB da sola, e finiva nello stesso 400 senza che si
// vedesse, perche' leggiEtichetta si mangia i suoi errori.
const ETICHETTA_STEPS=[[2000,0.94],[1600,0.9],[1280,0.85]];
// Il suo tetto e' piu' alto di quello delle altre, e non e' una svista: le
// altre si dividono una richiesta in tre o quattro, lei ce l'ha tutta per se'.
// Legarla al budget condiviso le toglieva risoluzione per colpa del peso
// delle altre - e la risoluzione dell'etichetta e' esattamente la cosa da cui
// dipende se marca, composizione e taglia si leggono o si indovinano.
const MAX_ETICHETTA_B64=3.5*1024*1024;

function codificaEtichetta(bitmap){
  for(let i=0;i<ETICHETTA_STEPS.length;i++){
    const b64=encodeImage(bitmap, ETICHETTA_STEPS[i][0], ETICHETTA_STEPS[i][1]);
    if(b64.length<=MAX_ETICHETTA_B64 || i===ETICHETTA_STEPS.length-1){
      return { base64:b64, mime:'image/jpeg' };
    }
  }
}

function encodeAll(bitmaps){
  const start=bitmaps.length>2?1:0;
  for(let i=start;i<ENCODE_STEPS.length;i++){
    const side=ENCODE_STEPS[i][0], q=ENCODE_STEPS[i][1];
    const out=bitmaps.map(b=>({ base64:encodeImage(b,side,q), mime:'image/jpeg' }));
    const totale=out.reduce((n,img)=>n+img.base64.length,0);
    if(totale<=MAX_PAYLOAD_B64||i===ENCODE_STEPS.length-1) return out;
  }
}

// Codifica le foto e le legge: analisi del capo e trascrizione dell'etichetta
// partono insieme. Sta qui fuori e non dentro analyzePhoto perche' la usano in
// due - la scheda Analizza e lo scanner - e il prompt sotto e' lungo e tarato
// riga per riga: due copie divergerebbero alla prima correzione.
async function leggiFoto(){
    const files=selFiles.slice(0,4);
    // Decodifica in parallelo: le foto non si aspettano piu' a vicenda.
    const bitmaps=await Promise.all(files.map(decodeImage));
    try{
      // L'etichetta va a parte e grande: e' una richiesta separata, quindi non
      // deve stare nel budget di peso delle altre, e non va rifatta se
      // l'analisi deve riprovare piu' leggera. A 1280px il testo di un
      // cartellino di composizione e' gia' illeggibile.
      const fotoEtichetta = (labelIndex>=0 && bitmaps[labelIndex])
        ? codificaEtichetta(bitmaps[labelIndex]) : null;
      // Parte subito e in parallelo: ognuna ha il suo budget di 10s sulla
      // function, e in fila non ci starebbero.
      const attesaEtichetta = fotoEtichetta ? leggiEtichetta(fotoEtichetta) : Promise.resolve(null);

      // La miniatura riusa la decodifica gia' fatta, senza rileggere il file.
      try{
        lastThumbnail='data:image/jpeg;base64,'+encodeImage(bitmaps[0], 160, 0.5);
      }catch(thumbErr){
        lastThumbnail=null;
      }

      const risposta = await analizzaScendendo(bitmaps);
      const etichetta = await attesaEtichetta;
      return { risposta, etichetta, cercataEtichetta: !!fotoEtichetta };
    }finally{
      bitmaps.forEach(releaseImage);
    }
}

// Quanto sia "troppo pesante" lo sa solo il provider, e il suo numero cambia
// col modello e senza preavviso: qui l'abbiamo sbagliato due volte di fila,
// prima a 4.2MB e poi a 3.6MB. Quindi non lo si indovina piu': si parte dalla
// qualita' migliore che sta nel budget - perche' la precisione dipende quasi
// tutta da quanto resta leggibile l'etichetta - e si scende di un gradino
// ogni volta che e' il SERVER a dire che e' troppo. Il numero smette di
// dover essere giusto: basta che sia un punto di partenza.
async function analizzaScendendo(bitmaps){
  // La scala dei tentativi, dal migliore al piu' magro. Prima si scende di
  // qualita' tenendo tutte le foto; se il rifiuto e' per token invece che
  // per byte, la qualita' non c'entra e si scende di NUMERO, perche' ogni
  // foto costa contesto per conto suo. L'ultimo tentativo - una foto sola,
  // piccola - passa praticamente ovunque, e vale comunque piu' di niente:
  // l'etichetta viaggia in una richiesta sua e non si perde.
  const tentativi=[];
  for(let passo=bitmaps.length>2?1:0; passo<ENCODE_STEPS.length; passo++){
    tentativi.push({ passo, quante:bitmaps.length });
  }
  for(let quante=bitmaps.length-1; quante>=1; quante--){
    tentativi.push({ passo:ENCODE_STEPS.length-1, quante });
  }

  let ultimoErrore=null;
  for(let i=0;i<tentativi.length;i++){
    const { passo, quante }=tentativi[i];
    const lato=ENCODE_STEPS[passo][0], q=ENCODE_STEPS[passo][1];
    const images=bitmaps.slice(0, quante).map(b=>({ base64:encodeImage(b, lato, q), mime:'image/jpeg' }));
    const peso=images.reduce((n,img)=>n+img.base64.length, 0);
    // Gia' sopra il budget in partenza: si scende senza sprecare l'invio.
    // Sull'ultimo tentativo si prova comunque: sotto non c'e' piu' niente.
    if(peso>MAX_PAYLOAD_B64 && i<tentativi.length-1) continue;
    try{
      return await chiediAnalisi(images);
    }catch(e){
      // Solo i due "e' troppo" si curano insistendo. Un timeout, una quota
      // finita o una chiave scaduta non migliorano con foto piu' piccole o
      // piu' poche, e riprovarli ruberebbe solo tempo.
      if(!e || !e.troppoPesante || i===tentativi.length-1) throw e;
      ultimoErrore=e;
      // Un rifiuto per token non si cura con la qualita': si salta dritti
      // ai tentativi con meno foto invece di scendere a vuoto.
      if(e.troppoPesante==='token' && quante===bitmaps.length){
        while(i+1<tentativi.length && tentativi[i+1].quante===bitmaps.length) i++;
      }
    }
  }
  throw ultimoErrore || new Error('Non sono riuscito a preparare le foto.');
}

function chiediAnalisi(images){
  const plurale = images.length>1
    ? `Le ${images.length} foto ritraggono LO STESSO capo da angolazioni diverse: usale tutte insieme per una sola analisi.\n\n`
    : '';
  return callAIJson({
    type:'image',
    images,
    prompt:`${plurale}Analizza questo capo di abbigliamento con l'occhio di un esperto di seconda mano e vintage. Guarda con attenzione l'etichetta (se visibile): il tipo di font del logo, il formato dell'etichetta di lavaggio/composizione, lo stile di cucitura, il tipo di tessuto, eventuali codici o scritte — questi sono indizi per capire se il capo è vintage e di che epoca.

REGOLE DI PRECISIONE — leggile prima di rispondere:
- Descrivi SOLO quello che vedi davvero nella foto. Non dedurre, non completare, non immaginare.
- Se un dato non è leggibile o non è visibile, scrivi "Non identificato" o lascia il campo vuoto. Un campo vuoto è corretto; un campo inventato è un errore grave.
- Il brand si scrive SOLO se lo leggi su un'etichetta o su un logo. Non indovinarlo dallo stile del capo.
- Il materiale si scrive SOLO se lo leggi sull'etichetta di composizione. Non dedurlo dall'aspetto del tessuto.
- La taglia si scrive SOLO se la leggi. Non stimarla dalle proporzioni.
- Per il colore usa quello che vedi, tenendo conto che la luce della foto può alterarlo: se sei incerto usa un nome ampio (es. "blu") invece di uno specifico sbagliato (es. "blu petrolio").
- Per la condizione basati su segni concreti e visibili: pieghe, pilling, sbiadimento, macchie, usura di orli e polsini. Se non vedi difetti scrivi "Ottimo" solo se il capo appare davvero integro.
- Per il vintage: se non ci sono indizi CONCRETI e visibili scrivi "Non vintage" e metti confidenza "bassa". Non trasformare uno stile che ricorda un'epoca in una datazione.

Rispondi SOLO con questo JSON valido, senza backtick né markdown, nessun testo prima o dopo:
{"tipo":"es: giacca in pelle","brand":"leggi l'etichetta, se non visibile scrivi Non identificato","colore":"","materiale":"es: 100% cotone, se visibile sull'etichetta","condizione":"una tra: Nuovo con etichetta, Nuovo senza etichetta, Ottimo, Buono, Soddisfacente","taglie":"taglie probabili","stagione":"","stile":"es: streetwear, casual, elegante, sportivo, vintage","fasciaPrezzo":"es: 20-50€","fasciaPrezzoMin":20,"fasciaPrezzoMax":50,"note":"difetti visibili, usura, dettagli particolari","vintageStima":"es: Anni 90, Y2K, Anni 80, oppure Non vintage se non ci sono indizi","vintageIndizi":"elenco breve degli indizi visivi concreti che ti fanno pensare sia vintage (o assenza di indizi), es: etichetta con font squadrato tipico anni 90, cucitura a doppio filo, tessuto pesante non più in uso","vintageConfidenza":"una tra: bassa, media, alta - quanto sei sicuro della stima vintage"}`
  });
}

async function analyzePhoto(){
  if(!selFiles.length) return;
  if(!busy('foto',BTN_FOTO)) return;
  show('lFoto'); hide('rFoto'); hide('eFoto');
  try{
    const letto = await leggiFoto();
    const risposta = letto.risposta, etichetta = letto.etichetta;
    lastEtichetta = etichetta;
    if(!risposta.ok){
      // Il modello non ha risposto in JSON: meglio il testo grezzo che niente.
      lastAnalysis = null;
      document.getElementById('rFotoTxt').textContent = risposta.raw;
      showModelUsed();
      show('rFoto');
      return;
    }
    const obj = risposta.data;
    if(etichetta) applicaEtichetta(obj, etichetta);
    lastAnalysis = obj;
    const isVintage = obj.vintageStima && !obj.vintageStima.toLowerCase().includes('non vintage');
    const vintageLine = isVintage
      ? `\n🕰️ POSSIBILE VINTAGE: ${obj.vintageStima} (confidenza: ${obj.vintageConfidenza||'non specificata'})\n🔍 INDIZI: ${obj.vintageIndizi||''}`
      : '';
    const et = etichetta && etichettaUtile(etichetta)
      ? `\n\n🏷️ LETTO SULL'ETICHETTA (leggibilità ${etichetta.leggibilita||'non indicata'}):\n${(etichetta.testoLetto||'').trim()}`
      : (letto.cercataEtichetta ? '\n\n🏷️ ETICHETTA: non sono riuscito a leggerla. Riprova con una foto più ravvicinata e a fuoco.' : '');
    document.getElementById('rFotoTxt').textContent =
      `🏷️ TIPO DI CAPO: ${obj.tipo||''}\n👔 BRAND / MARCA: ${obj.brand||''}\n🎨 COLORE/I: ${obj.colore||''}\n🧵 MATERIALE: ${obj.materiale||''}\n⭐ CONDIZIONE STIMATA: ${obj.condizione||''}\n📐 TAGLIE PROBABILI: ${obj.taglie||''}\n🗓️ STAGIONE: ${obj.stagione||''}\n✨ STILE: ${obj.stile||''}\n💰 FASCIA DI PREZZO ORIGINALE STIMATA: ${obj.fasciaPrezzo||''}\n💡 NOTE: ${obj.note||''}${vintageLine}${et}`;
    showModelUsed();
    show('rFoto');
    tocco();
  }catch(e){
    document.getElementById('eFoto').textContent='⚠️ '+e.message;
    show('eFoto');
  }finally{
    hide('lFoto');
    idle('foto',BTN_FOTO);
  }
}

// Richiesta corta e mirata, con la foto grande: al modello si chiede solo di
// trascrivere, non di interpretare. Marca, composizione e taglia devono uscire
// da qui, non dall'aspetto del capo - che e' esattamente dove il modello
// tirava a indovinare.
async function leggiEtichetta(img){
  try{
    const r = await callAIJson({
      type:'image',
      json:true,
      images:[img],
      prompt:`Questa foto mostra l'etichetta di un capo di abbigliamento.
Trascrivi ESATTAMENTE quello che riesci a leggere. Non interpretare, non completare, non dedurre.

- Se un dato non è leggibile, lascia il campo vuoto. Un campo vuoto è corretto; un campo inventato è un errore grave.
- La marca si scrive solo se è scritta a lettere. Non ricavarla dalla forma di un logo.
- Riporta le percentuali di composizione esattamente come sono stampate.

Rispondi SOLO con questo JSON valido, senza backtick né markdown, nessun testo prima o dopo:
{"marca":"","composizione":"es: 80% cotone 20% poliestere","taglia":"","provenienza":"es: Made in Italy","codici":"codici o numeri stampati sull'etichetta","testoLetto":"tutto il testo che riesci a leggere, riga per riga","leggibilita":"una tra: alta, media, bassa"}`
    });
    return r.ok ? r.data : null;
  }catch(e){
    // Se la lettura dell'etichetta non riesce, l'analisi principale deve
    // comunque arrivare a destinazione.
    return null;
  }
}

// "Non identificato", "illeggibile" e simili sono risposte oneste del modello,
// ma non sono dati: non devono sovrascrivere niente.
function campoLetto(valore){
  return typeof valore==='string' && valore.trim()
    && !/non identificat|non leggibil|illeggibil|non visibil|^n\/?a$|^-+$/i.test(valore.trim());
}

function etichettaUtile(et){
  return !!(et && (campoLetto(et.testoLetto) || campoLetto(et.marca) || campoLetto(et.composizione)));
}

// Quello che c'è scritto sull'etichetta batte quello che il modello ha dedotto
// guardando il capo.
function applicaEtichetta(obj, et){
  if(campoLetto(et.marca)) obj.brand = et.marca.trim();
  if(campoLetto(et.composizione)) obj.materiale = et.composizione.trim();
  if(campoLetto(et.taglia)) obj.taglie = et.taglia.trim();
}

// Sapere quale modello ha guardato la foto spiega molto della qualita'
// dell'analisi, e permette di fissarlo in GROQ_MODEL_VISION.
function showModelUsed(){
  const el=document.getElementById('rFotoModel');
  if(!el) return;
  el.textContent = lastModel
    ? `Analisi eseguita con ${lastModel}${lastProvider?' ('+lastProvider+')':''}`
      + (lastGemini?` — Gemini non usato: ${lastGemini}`:'')
    : '';
}

/* ===== RICERCA PER IMMAGINE (Google Lens via SerpApi) ===== */

// L'upload di SerpApi si ferma a 500KB di file: si scende di qualita' finche'
// ci sta. Qui la risoluzione conta meno che nell'analisi - a Lens serve la
// forma del capo, non il testo di un'etichetta.
function sottoPeso(bitmap, maxBytes){
  const passi=[[1024,0.8],[800,0.7],[640,0.6],[512,0.5]];
  let b64='';
  for(let i=0;i<passi.length;i++){
    b64=encodeImage(bitmap,passi[i][0],passi[i][1]);
    // base64 pesa circa 4/3 dei byte veri, e il limite del server e' sui byte.
    if(b64.length*3/4<=maxBytes) return b64;
  }
  return b64;
}

async function identificaProdotto(){
  if(!selFiles.length){ toast('SERVE UNA FOTO'); return; }
  if(!busy('lens',BTN_LENS)) return;
  show('lLens'); hide('eLens'); hide('rLens');
  try{
    // Non la foto dell'etichetta: a Lens serve il capo intero.
    const idx=selFiles.findIndex((f,i)=>i!==labelIndex);
    const bmp=await decodeImage(selFiles[idx>=0?idx:0]);
    let base64;
    try{ base64=sottoPeso(bmp, 460*1024); }
    finally{ releaseImage(bmp); }

    lastLens=await chiamaEndpoint(LENS_URL,{ image: base64 });
    renderLens(lastLens);
    show('rLens');
  }catch(e){
    if(e && e.nonConfigurato){
      // Senza SERPAPI_KEY il bottone non ha senso: sparisce invece di
      // riproporre lo stesso errore a ogni tocco.
      const b=document.getElementById('btnL');
      if(b) b.style.display='none';
      toast('Ricerca per immagine non configurata');
    }else{
      document.getElementById('eLens').textContent='⚠️ '+e.message;
      show('eLens');
    }
  }finally{
    hide('lLens');
    idle('lens',BTN_LENS);
  }
}

function renderLens(d){
  const el=document.getElementById('rLens');
  const risultati=(d&&Array.isArray(d.risultati))?d.risultati:[];
  if(!risultati.length){
    el.innerHTML='<div class="hSub">Nessun prodotto riconosciuto da questa foto. Prova con uno scatto del capo intero, su sfondo pulito.</div>';
    return;
  }
  const p=d.prezzi;
  const testa=(d.ipotesi?`<div class="rl">🔎 ${esc(d.ipotesi)}</div>`:'<div class="rl">🔎 Prodotti simili</div>')
    + (p?`<div class="tip">Prezzi di listino trovati: <strong>${p.mediana}€</strong> di mediana `
        + `(da ${p.min}€ a ${p.max}€, su ${p.n} ${p.n===1?'risultato':'risultati'}). `
        + `Su Vinted un usato vale una frazione di questo.</div>`:'');
  const righe=risultati.map((r,i)=>`
    <div class="lr" style="--i:${i}">
      ${r.thumbnail?`<img src="${esc(r.thumbnail)}" alt="" loading="lazy" onerror="this.remove()"/>`:''}
      <div style="flex:1;min-width:0">
        <div class="lrt">${r.link?`<a href="${esc(r.link)}" target="_blank" rel="noopener noreferrer" style="color:inherit">${esc(r.titolo)}</a>`:esc(r.titolo)}</div>
        <div class="lrs">${esc(r.fonte)}</div>
      </div>
      ${r.prezzo?`<div class="lrp">${r.prezzo.valore}${esc(r.prezzo.valuta)}</div>`:''}
    </div>`).join('');
  const piede=`<div class="crow" style="margin-top:12px">
      <button class="cbtn" data-az="usaLensPerPrezzo">💶 Usa per la stima prezzo</button>
      <button class="cbtn" data-az="toRicercaLens">🤖 Approfondisci online</button>
    </div>`;
  el.innerHTML=testa+righe+piede;
}

// I prezzi trovati sono l'unico dato di mercato vero che abbiamo: passarli
// alla stima vale piu' di qualunque aggiustamento al prompt.
function usaLensPerPrezzo(){
  if(!lastLens) return;
  const nome=lastLens.ipotesi||(lastLens.risultati[0]&&lastLens.risultati[0].titolo)||'';
  if(nome && !v('pNome')) document.getElementById('pNome').value=nome.slice(0,80);
  // Il messaggio racconta un posto dove l'utente adesso e': se ha rifiutato di
  // andarci - c'e' un giro in corso - la scritta direbbe una cosa fatta in una
  // scheda che non sta guardando. Vale per tutti i "usa per..." qui sotto.
  if(!sw('prezzo')) return;
  toast('💶 Dati di mercato agganciati alla stima');
}

const CONDIZIONI=['Nuovo con etichetta','Nuovo senza etichetta','Ottimo','Buono','Soddisfacente'];

// Il modello scrive la condizione a parole sue, va ricondotta a una voce della
// tendina. Prima si cerca l'etichetta intera: "Nuovo con etichetta" e "Nuovo
// senza etichetta" iniziano entrambe con "Nuovo", e fermarsi alla prima parola
// - come faceva il codice di prima - sceglieva sempre la prima delle due.
function applyCondizione(selectId, condizione){
  if(!condizione) return;
  const el=document.getElementById(selectId);
  if(!el) return;
  const testo=String(condizione).toLowerCase().trim();
  const esatta=CONDIZIONI.find(opt=>testo.includes(opt.toLowerCase()));
  if(esatta){ el.value=esatta; return; }
  const parziale=CONDIZIONI.find(opt=>testo.includes(opt.toLowerCase().split(' ')[0]));
  if(parziale) el.value=parziale;
}

function toAnnuncio(){
  if(!lastAnalysis){ toast('ANALIZZA PRIMA UN CAPO!'); return; }
  const obj = lastAnalysis;
  currentItemId = null; lastItemSig = null;

  if(obj.tipo) document.getElementById('aNome').value = obj.tipo;
  if(obj.brand && !obj.brand.toLowerCase().includes('non identificat')) document.getElementById('aMarca').value = obj.brand;
  if(obj.colore) document.getElementById('aColore').value = obj.colore;
  if(obj.materiale) document.getElementById('aMat').value = obj.materiale;
  applyCondizione('aCond', obj.condizione);
  document.getElementById('aNote').value = '';

  if(obj.tipo) document.getElementById('pNome').value = obj.tipo;
  if(obj.brand && !obj.brand.toLowerCase().includes('non identificat')) document.getElementById('pMarca').value = obj.brand;
  applyCondizione('pCond', obj.condizione);
  if(obj.tipo) document.getElementById('pCat').value = obj.tipo;
  if(typeof obj.fasciaPrezzoMin === 'number' && typeof obj.fasciaPrezzoMax === 'number'){
    const mid = Math.round((obj.fasciaPrezzoMin + obj.fasciaPrezzoMax)/2);
    if(!document.getElementById('pPrezzo').value) document.getElementById('pPrezzo').value = mid;
  }

  // Se la scheda non si apre - un giro in corso, e l'utente che ha detto di
  // restare - non parte neanche l'annuncio: altrimenti si ritroverebbe una
  // seconda richiesta a lavorare in un pannello che ha appena rifiutato di
  // aprire, e la guardia dell'uscita accesa da una cosa che non ha chiesto.
  if(!sw('annuncio')) return;
  toast('// GENERO ANNUNCIO...');
  setTimeout(function(){ genAnnuncio(); }, 600);
}

async function genAnnuncio(){
  if(!busy('annuncio',BTN_ANN)) return;
  show('lAnn'); hide('rAnn'); hide('eAnn');
  try{
    let vintageHint = '';
    if(lastAnalysis && lastAnalysis.vintageStima && !lastAnalysis.vintageStima.toLowerCase().includes('non vintage')){
      const conf = (lastAnalysis.vintageConfidenza||'').toLowerCase();
      if(conf === 'media' || conf === 'alta'){
        vintageHint = `\n- Possibile epoca vintage: ${lastAnalysis.vintageStima} (indizi: ${lastAnalysis.vintageIndizi||'non specificati'}) — menzionalo con cautela, es. "in stile anni 90" o "con dettagli che richiamano gli anni 90", MAI come certificazione assoluta`;
      }
    }
    const angoli = [
      'parti descrivendo subito il colore o il materiale',
      'parti dall\'occasione in cui useresti questo capo',
      'parti da un dettaglio delle note o della condizione',
      'parti in modo diretto, dicendo cosa vendi e perché è comodo/bello da indossare',
      'parti da come sta o da un abbinamento pratico'
    ];
    const angoloScelto = angoli[Math.floor(Math.random()*angoli.length)];

    const risposta=await callAIJson({
      type:'text',
      creative:true,
      json:true,
      prompt:`Scrivi un annuncio Vinted in italiano, tono ${selTone}, per questo capo:
- Capo: ${v('aNome')||'Non specificato'}
- Marca: ${v('aMarca')||'Non specificata'}
- Taglia: ${v('aTaglia')||'Non specificata'}
- Condizione: ${v('aCond')}
- Colore: ${v('aColore')||'Non specificato'}
- Materiale: ${v('aMat')||'Non specificato'}
- Dettagli: ${v('aNote')||'Nessuno'}${vintageHint}

Per la descrizione, ${angoloScelto} — non iniziare sempre allo stesso modo.

REGOLE IMPORTANTI per non suonare generico o da pubblicità:
- Vietate frasi fatte tipo "capo must-have", "perfetto per ogni occasione", "pezzo unico nel suo genere", "dona un tocco di classe", "ideale per ogni stagione", o qualunque frase che potrebbe andare bene per QUALSIASI capo
- Ogni frase deve contenere almeno un dettaglio CONCRETO preso dai dati sopra (il colore esatto, il materiale, un dettaglio delle note, l'occasione d'uso specifica per quel tipo di capo)
- Scrivi come lo scriverebbe una persona reale che vende un proprio vestito, non un copywriter pubblicitario
- Massimo 1 emoji in tutta la descrizione, zero se il tono è "professionale ed elegante"
- Se non hai abbastanza dettagli specifici, sii onesto e breve piuttosto che riempire con frasi vuote

Rispondi SOLO con questo JSON valido, senza backtick né markdown, nessun testo prima o dopo:
{"titolo":"max 60 caratteri, specifico non generico","descrizione":"3-5 frasi concrete","hashtag":"10 hashtag separati da spazio, es #tag1 #tag2"}`
    });
    if(!risposta.ok){
      // Niente JSON: mostriamo comunque quello che ha scritto.
      lastAnnuncioText = risposta.raw;
      document.getElementById('rAnnTitolo').textContent = '';
      document.getElementById('rAnnDesc').textContent = risposta.raw;
      document.getElementById('rAnnHash').textContent = '';
      show('rAnn');
      return;
    }
    const d = risposta.data;
    lastAnnuncioText = `${d.titolo||''}\n\n${d.descrizione||''}\n\n${d.hashtag||''}`.trim();
    document.getElementById('rAnnTitolo').textContent = d.titolo || '';
    document.getElementById('rAnnDesc').textContent = d.descrizione || '';
    document.getElementById('rAnnHash').textContent = d.hashtag || '';
    show('rAnn');
    tocco();

    upsertHistoryItem(itemIdFor(v('aNome'), v('aMarca')), {
      nome: v('aNome'), marca: v('aMarca'), taglia: v('aTaglia'), condizione: v('aCond'),
      titolo: d.titolo||'', descrizione: d.descrizione||'', hashtag: d.hashtag||'',
      foto: lastThumbnail || undefined
    });
  }catch(e){
    document.getElementById('eAnn').textContent='⚠️ '+e.message;
    show('eAnn');
  }finally{
    hide('lAnn');
    idle('annuncio',BTN_ANN);
  }
}

async function stimaPrezzo(){
  if(!busy('prezzo',BTN_PRE)) return;
  show('lPre'); hide('rPre'); hide('ePre');
  document.getElementById('pBar').style.width='0%';
  try{
    // Se la ricerca per immagine ha trovato dei listini, sono dati veri: molto
    // meglio di quello che il modello ricorda dei prezzi di Vinted.
    let mercato='';
    if(lastLens && lastLens.prezzi){
      const p=lastLens.prezzi;
      mercato = `\n\nPREZZI DI LISTINO REALI trovati con la ricerca per immagine su questo stesso capo:`
        + `\n- mediana ${p.mediana}€, minimo ${p.min}€, massimo ${p.max}€ (su ${p.n} risultati)`
        + (lastLens.ipotesi?`\n- prodotto riconosciuto: ${lastLens.ipotesi}`:'')
        + `\nUsa questi numeri come ancora: sono prezzi del NUOVO o di rivenditori, quindi l'usato su Vinted vale una frazione. Parti da qui invece che dalla tua memoria dei prezzi.`;
    }

    // Lo scanner e' il dato migliore che possiamo passare: sono annunci veri,
    // gia' separati fra usato e negozio e ripuliti dagli estremi. Vale lo
    // stesso vincolo dell'agente: solo se la scheda parla dello stesso capo.
    if(lastScan && lastScan.mercato && lastScan.mercato.usato
       && stessoCapo({ nome:sxNomeCapo(), marca:sxVal(lastScan.identita.marca) }, { nome:v('pNome'), marca:v('pMarca') })){
      const u=lastScan.mercato.usato, nz=lastScan.mercato.nuovo;
      mercato += `\n\nSCANSIONE appena fatta su annunci reali del mercato italiano, separati per tipo di mercato:`
        + `\n- annunci dell'USATO: ${u.n} con un prezzo, mediana ${u.mediana}€, meta' fra ${u.q1}€ e ${u.q3}€ (da ${u.min}€ a ${u.max}€)`
        + (nz?`\n- prezzi di NEGOZIO (nuovo): mediana ${nz.mediana}€ su ${nz.n} risultati`:'')
        + (lastScan.mercato.tenuta?`\n- l'usato vale circa il ${lastScan.mercato.tenuta}% del nuovo`:'')
        + (lastScan.prezzo!==null&&lastScan.prezzo!==undefined?`\n- prezzo concluso dallo scanner: ${lastScan.prezzo}€, fiducia ${lastScan.fiducia?lastScan.fiducia.livello:'non dichiarata'}`:'')
        + `\nLa mediana dell'usato e' il mercato su cui si vende qui: pesala piu' di qualunque altra cosa, e usa il prezzo di negozio solo come tetto.`;
    }

    // Gli esiti veri di chi vende battono qualunque annuncio: sono vendite
    // concluse, e sono sue. Il resto sono prezzi chiesti da sconosciuti.
    const cal=calibrazioneStorico();
    if(cal){
      mercato += `\n\nESITI VERI di chi vende, dal suo storico (${cal.n} capi venduti davvero):`
        + `\n- i suoi capi vendono ${cal.scarto<0?`il ${-cal.scarto}% sotto`:cal.scarto>0?`il ${cal.scarto}% sopra`:'esattamente a'} il prezzo che gli era stato suggerito`
        + (cal.giorni!==null?`, e ci mettono ${cal.giorni} giorni`:'')
        + `\nE' l'unico dato di vendite CONCLUSE che hai: tienine conto nel prezzo, e scrivilo nella motivazione.`;
    }

    // Il rapporto dell'agente pesa piu' dei listini di Lens: sono annunci
    // dell'usato, cioe' esattamente il mercato su cui si vende qui.
    if(lastRicerca && lastRicerca.prezzi && stessoCapo(lastRicerca.capo, { nome:v('pNome'), marca:v('pMarca') })){
      const q=lastRicerca.prezzi, rap=lastRicerca.rapporto||{};
      mercato += `\n\nRICERCA ONLINE appena fatta su ${lastRicerca.prove.length} risultati reali del mercato italiano:`
        + `\n- prezzi letti negli annunci: mediana ${q.mediana}€, da ${q.min}€ a ${q.max}€ (su ${q.n} annunci)`
        + (rap.prezzoConsigliato?`\n- conclusione dell'agente: ${rap.prezzoConsigliato}€, fiducia ${rap.fiducia||'non dichiarata'}`:'')
        + `\nQuesti sono annunci veri e recenti: pesali piu' della tua memoria dei prezzi.`;
    }

    const risposta=await callAIJson({
      type:'text',
      json:true,
      prompt:`Sei un esperto di second-hand e resell sul mercato italiano, con conoscenza approfondita di Vinted Italia.
Analizza questi dati e stima il prezzo di rivendita REALISTICO su Vinted Italia:

CAPO: ${v('pNome')||'Non specificato'}
MARCA: ${v('pMarca')||'Non specificata'}
CONDIZIONE: ${v('pCond')}
PREZZO ORIGINALE: ${v('pPrezzo')?v('pPrezzo')+'€':'Non noto'}
ANNO ACQUISTO: ${v('pAnno')||'Non noto'}
CATEGORIA: ${v('pCat')||'Abbigliamento'}${mercato}

Considera attentamente:
1. POPOLARITÀ DEL BRAND su Vinted Italia (brand luxury, streetwear, fast fashion hanno valori molto diversi)
2. DEPREZZAMENTO reale (fast fashion perde 60-80% del valore, luxury 20-40%)
3. CONDIZIONE (nuovo con etichetta vale molto di più di "buono")
4. STAGIONALITÀ (un cappotto in estate vale meno)
5. DOMANDA ATTUALE su Vinted per quel tipo di capo
6. CONCORRENZA (quanti articoli simili ci sono su Vinted)
7. Se il brand non è noto, stima in base alla categoria e condizione
8. Dai un prezzo COMPETITIVO che venda velocemente, non il massimo teorico

Rispondi SOLO con questo JSON valido senza backtick ne markdown:
{"prezzoSuggerito":25,"rangeMin":18,"rangeMax":35,"percentuale":60,"motivazione":"Spiegazione dettagliata del prezzo basata su dati reali Vinted","fattori":["Fattore specifico 1","Fattore specifico 2","Fattore specifico 3","Fattore specifico 4"],"consiglio":"Consiglio pratico specifico per vendere questo capo velocemente su Vinted"}`
    });
    if(!risposta.ok) throw new Error('Risposta AI in formato inatteso, riprova.');
    const d = risposta.data;

    // Il JSON arriva, ma non e' detto che i numeri siano numeri: un campo
    // mancante diventava "undefined€" e una percentuale fuori scala allargava
    // la barra oltre il contenitore.
    const prezzo = num(d.prezzoSuggerito, null, 0, 100000);
    const rMin = num(d.rangeMin, null, 0, 100000);
    const rMax = num(d.rangeMax, null, 0, 100000);
    if(prezzo===null) throw new Error('Stima non interpretabile, riprova.');

    document.getElementById('pNum').textContent=prezzo+'€';
    document.getElementById('pRng').textContent=(rMin!==null&&rMax!==null)?`range: ${rMin}€ – ${rMax}€`:'';
    document.getElementById('pMot').textContent=d.motivazione||'';
    const perc=num(d.percentuale,55,0,100);
    setTimeout(()=>document.getElementById('pBar').style.width=perc+'%',80);
    // L'output del modello e' testo non fidato: va sempre escapato prima di finire in innerHTML.
    const fattori=Array.isArray(d.fattori)?d.fattori:[];
    document.getElementById('pFact').innerHTML=fattori.map((f,i)=>`<li class="fli" style="--i:${i}"><span class="fdot"></span>${esc(f)}</li>`).join('');
    document.getElementById('pTip').innerHTML=d.consiglio?`💡 <strong>Consiglio:</strong> ${esc(d.consiglio)}`:'';
    show('rPre');
    tocco();

    upsertHistoryItem(itemIdFor(v('pNome'), v('pMarca')), {
      nome: v('pNome'), marca: v('pMarca'), condizione: v('pCond'),
      prezzoSuggerito: prezzo, rangeMin: rMin, rangeMax: rMax, consiglio: d.consiglio||'',
      foto: lastThumbnail || undefined
    });
  }catch(e){
    document.getElementById('ePre').textContent='⚠️ '+e.message;
    show('ePre');
  }finally{
    hide('lPre');
    idle('prezzo',BTN_PRE);
  }
}

// I numeri che arrivano dal modello passano tutti di qui: fuori scala, stringhe
// e campi mancanti non devono finire nel DOM cosi' come sono.
function num(value, fallback, min, max){
  const n = typeof value==='number' ? value : parseFloat(value);
  if(!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function copyText(txt){
  if(!txt){ toast('NIENTE DA COPIARE'); return Promise.resolve(false); }
  if(navigator.clipboard&&navigator.clipboard.writeText){
    return navigator.clipboard.writeText(txt)
      .then(()=>{ toast('✅ Copiato!'); return true; })
      .catch(()=>legacyCopy(txt));
  }
  return Promise.resolve(legacyCopy(txt));
}
function legacyCopy(txt){
  const ta=document.createElement('textarea');
  ta.value=txt; ta.style.cssText='position:fixed;opacity:0';
  document.body.appendChild(ta); ta.select();
  let ok=false;
  try{ ok=document.execCommand('copy'); }catch(e){ ok=false; }
  document.body.removeChild(ta);
  toast(ok?'✅ Copiato!':'⚠️ Copia non riuscita');
  return ok;
}
function cpField(id, btn){
  copyText(document.getElementById(id)?.textContent||'').then(ok=>{ if(ok) confermaBottone(btn); });
}

// Il toast sta in fondo allo schermo, il pollice e' sul bottone: la conferma
// va data dove sta guardando chi ha premuto.
function confermaBottone(btn){
  if(!btn || btn.classList.contains('fatto')) return;
  const originale=btn.textContent;
  btn.classList.add('fatto');
  btn.textContent='✓ Fatto';
  tocco(10);
  setTimeout(()=>{ btn.classList.remove('fatto'); btn.textContent=originale; }, 1300);
}
function openVinted(){
  const titolo=document.getElementById('rAnnTitolo')?.textContent||'';
  const apri=()=>window.open('https://www.vinted.it/items/new','_blank');
  if(!titolo){ apri(); return; }
  // La window.open deve restare vicina al click, altrimenti Safari la blocca.
  copyText(titolo);
  apri();
}
const v=id=>document.getElementById(id)?.value?.trim()||'';
const show=id=>document.getElementById(id).style.display='';
const hide=id=>document.getElementById(id).style.display='none';
function toast(msg,dur=2500){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),dur);}
function shareAnnuncio(){
  const txt=lastAnnuncioText;
  if(!txt){ toast('GENERA PRIMA UN ANNUNCIO!'); return; }
  if(navigator.share){
    navigator.share({title:'Annuncio Vinted',text:txt}).catch(()=>{});
    return;
  }
  copyText(txt);
}

/* ===== AGENTE DI RICERCA ONLINE =====
   Il ciclo dell'agente gira qui nel browser, non dentro una function: Netlify
   chiude una function a 10s e un giro intero (piano, ricerche, raffinamento,
   rapporto) non ci starebbe mai. Ogni passo e' una chiamata corta per conto
   suo, e intanto la pagina racconta cosa sta facendo invece di far girare uno
   spinner muto per venti secondi. */
const RICERCA_URL='/.netlify/functions/ricerca';
const BTN_RIC=['btnS'];
// Due giri al massimo: il primo esegue il piano, il secondo raffina solo se i
// prezzi raccolti sono troppo pochi per dire qualcosa. Ogni ricerca costa
// quota SerpApi, quindi l'agente si ferma appena ne sa abbastanza.
const AG_MAX_GIRI=2, AG_MAX_QUERY=3, AG_PREZZI_OK=4;
// Quante prove finiscono nel prompt finale: il limite vero e' MAX_PROMPT
// (8000 caratteri) lato function.
const AG_PROVE_PROMPT=10;
let lastRicerca=null, agPassi=[], agTesto='';

function datiCapo(){
  return { nome:v('sNome'), marca:v('sMarca'), taglia:v('sTaglia'),
           condizione:v('sCond'), note:v('sNote') };
}

function descriviCapo(c){
  return `- Capo: ${c.nome||'non specificato'}\n- Marca: ${c.marca||'non specificata'}\n`
       + `- Taglia: ${c.taglia||'non specificata'}\n- Condizione: ${c.condizione||'non specificata'}\n`
       + `- Dettagli: ${c.note||'nessuno'}`;
}

/* --- il diario dei passi: e' quello che rende l'agente controllabile --- */
function passo(testo){
  agPassi.push({ testo, stato:'corso', nota:'' });
  renderPassi();
  return agPassi.length-1;
}

function chiudiPasso(i, stato, nota){
  if(!agPassi[i]) return;
  agPassi[i].stato=stato;
  agPassi[i].nota=nota||'';
  renderPassi();
}

const AG_SEGNI={ fatto:'✓', ko:'×' };

function renderPassi(){
  document.getElementById('agList').innerHTML=agPassi.map(p=>`
    <li class="agp ${p.stato}">
      <span class="agi" aria-hidden="true">${p.stato==='corso'?'<span class="spin agspin"></span>':AG_SEGNI[p.stato]}</span>
      <span style="flex:1;min-width:0">${esc(p.testo)}${p.nota?`<div class="agn">${esc(p.nota)}</div>`:''}</span>
    </li>`).join('');
}

// Svuota tutto quello che riguarda l'agente: campi, diario, rapporto.
function resetRicerca(){
  lastRicerca=null; agPassi=[]; agTesto='';
  ['sNome','sMarca','sTaglia','sNote'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.value='';
  });
  renderPassi();
  hide('agSteps'); hide('rRic'); hide('eRic');
}

async function avviaAgente(){
  const capo=datiCapo();
  if(!capo.nome && !capo.marca){ toast('SERVE ALMENO NOME O MARCA'); return; }
  if(!busy('ricerca',BTN_RIC)) return;
  // Il rapporto vecchio sparisce prima di cominciare: finche' il nuovo non
  // c'e', non deve poter finire nella stima di un altro capo.
  lastRicerca=null; agPassi=[]; agTesto=''; renderPassi();
  show('agSteps'); hide('eRic'); hide('rRic');
  try{
    const prove=[], correlate=[];
    let queries=await pianifica(capo);

    for(let giro=1; giro<=AG_MAX_GIRI && queries.length; giro++){
      await eseguiQueries(queries, prove, correlate);
      if(conPrezzo(prove).length>=AG_PREZZI_OK) break;
      queries = giro<AG_MAX_GIRI ? await raffina(capo, prove, correlate) : [];
    }

    if(!prove.length){
      throw new Error('Le ricerche non hanno trovato niente di utile. Prova col nome del modello o con la marca esatta.');
    }

    // Le prove che vanno nel prompt sono esattamente quelle che finiscono a
    // schermo, nello stesso ordine: il modello cita per numero, e quel numero
    // deve portare a un link che si puo' aprire.
    const citate=ordinaProve(prove);

    // Il rapporto e' l'ultimo passo ed e' il piu' caro: nel suo prompt ci
    // stanno tutti i risultati trovati, e quando sfonda i 9s della function
    // arriva un 504. Buttare via anche le prove sarebbe il danno peggiore -
    // gli annunci ci sono, i prezzi pure, la quota di ricerca e' gia' spesa, e
    // mediana e range li calcola prezziDelle() senza chiedere niente a
    // nessuno. Quello che manca e' il commento, non i dati: si dice, e si
    // mostra il resto.
    let rapporto=null, senzaRapporto='';
    try{
      rapporto=await sintetizza(capo, citate);
    }catch(e){
      senzaRapporto=e.message;
    }
    lastRicerca={ capo, prove:citate, prezzi:prezziDelle(citate), rapporto };
    renderRicerca(senzaRapporto);
    show('rRic');
    tocco();
  }catch(e){
    if(e && e.nonConfigurato){
      // Senza SERPAPI_KEY l'agente non ha strumenti: il bottone sparisce
      // invece di riproporre lo stesso errore a ogni tocco.
      const b=document.getElementById('btnS');
      if(b) b.style.display='none';
      document.getElementById('eRic').textContent='⚠️ La ricerca online non è configurata sul server: serve la chiave SERPAPI_KEY.';
    }else{
      document.getElementById('eRic').textContent='⚠️ '+e.message;
    }
    show('eRic');
  }finally{
    idle('ricerca',BTN_RIC);
  }
}

/* --- 1. il piano --- */
async function pianifica(capo){
  const i=passo('Pianifico le ricerche');
  let queries=[];
  try{
    const r=await callAIJson({
      type:'text',
      json:true,
      prompt:`Sei un agente che deve scoprire online quanto vale un capo di abbigliamento usato sul mercato italiano (Vinted, Subito, eBay, Depop).

CAPO DA STUDIARE:
${descriviCapo(capo)}

Scrivi al massimo ${AG_MAX_QUERY} ricerche da dare a Google, in italiano, fatte per far uscire ANNUNCI VERI con un prezzo, non articoli di blog.
- almeno una deve puntare agli annunci dell'usato (per esempio con "vinted" o "subito" nel testo)
- se puoi, cerca prezzi di VENDUTO e non solo richieste: gli annunci ancora online sono quelli che NON si sono venduti a quel prezzo. Su eBay gli oggetti venduti sono indicizzati ("venduto", "prezzi di vendita"), su Vinted no
- una può puntare al prezzo del nuovo, che serve come punto di partenza
- solo parole chiave, come le scriverebbe una persona: niente domande, niente frasi
- se marca o modello non sono noti, usa categoria, materiale e colore

Rispondi SOLO con questo JSON valido, senza backtick né markdown:
{"queries":[{"q":"testo della ricerca","tipo":"web","perche":"cosa ti aspetti di trovare"}]}
Il campo tipo vale "web" per i risultati normali, "shopping" per le schede prodotto con il prezzo di listino.`
    });
    queries=normalizzaQueries(r.ok && r.data ? r.data.queries : null);
  }catch(e){
    // Il piano e' un lusso: se il modello non risponde, l'agente cerca lo
    // stesso con le query ovvie invece di fermarsi qui.
  }
  if(!queries.length) queries=pianoDiRiserva(capo);
  chiudiPasso(i,'fatto', queries.map(q=>q.q).join(' · '));
  return queries;
}

// Le query arrivano da un modello: possono essere oggetti strani, duplicati,
// o un romanzo. Qui diventano al massimo tre stringhe corte e distinte.
function normalizzaQueries(grezze){
  const out=[], viste=new Set();
  for(const g of (Array.isArray(grezze)?grezze:[])){
    const q=String((g&&g.q)||g||'').replace(/\s+/g,' ').trim().slice(0,160);
    if(!q || viste.has(q.toLowerCase())) continue;
    viste.add(q.toLowerCase());
    out.push({ q, tipo:(g&&g.tipo)==='shopping'?'shopping':'web' });
    if(out.length>=AG_MAX_QUERY) break;
  }
  return out;
}

function pianoDiRiserva(capo){
  const base=[capo.marca, capo.nome].filter(Boolean).join(' ').trim() || capo.note;
  return [
    { q:`${base} usato prezzo vinted`, tipo:'web' },
    { q:`${base} prezzo`, tipo:'shopping' }
  ];
}

/* --- 2. le ricerche --- */
async function eseguiQueries(queries, prove, correlate){
  const indici=queries.map(q=>passo(`Cerco: ${q.q}`));
  const esiti=await Promise.all(queries.map(q=>
    chiamaEndpoint(RICERCA_URL,{ query:q.q, tipo:q.tipo })
      .then(d=>({ ok:true, d }))
      .catch(e=>({ ok:false, e }))
  ));

  let primoErrore=null;
  esiti.forEach((esito,k)=>{
    if(!esito.ok){
      primoErrore=primoErrore||esito.e;
      chiudiPasso(indici[k],'ko', esito.e.message);
      return;
    }
    const trovati=Array.isArray(esito.d.risultati)?esito.d.risultati:[];
    for(const r of trovati){
      if(r && r.titolo && !prove.some(p=>p.titolo===r.titolo)) prove.push(r);
    }
    for(const c of (Array.isArray(esito.d.correlate)?esito.d.correlate:[])){
      if(c && !correlate.includes(c)) correlate.push(c);
    }
    chiudiPasso(indici[k],'fatto',
      `${trovati.length} risultati, ${trovati.filter(r=>r&&r.prezzo).length} con prezzo`);
  });

  // Se sono fallite tutte, il motivo vero (chiave mancante, quota finita)
  // deve arrivare all'utente al posto di un generico "non ho trovato niente".
  if(primoErrore && esiti.every(e=>!e.ok)) throw primoErrore;
}

/* --- 3. il raffinamento, solo se serve --- */
async function raffina(capo, prove, correlate){
  const i=passo('I prezzi trovati sono pochi: raffino la ricerca');
  let queries=[];
  try{
    const r=await callAIJson({
      type:'text',
      json:true,
      prompt:`Stai cercando online il valore di questo capo usato:
${descriviCapo(capo)}

Le ricerche fatte finora hanno trovato ${prove.length} risultati, di cui solo ${conPrezzo(prove).length} con un prezzo leggibile. Ecco i titoli:
${prove.slice(0,8).map((p,n)=>`${n+1}. ${String(p.titolo).slice(0,90)}${p.prezzo?` — ${p.prezzo.valore}${p.prezzo.valuta}`:''}`).join('\n')}

Ricerche correlate suggerite da Google: ${correlate.length?correlate.join(', '):'nessuna'}

Scrivi UNA sola ricerca nuova che abbia più probabilità di far uscire annunci con il prezzo. Cambia strategia rispetto a prima: nome del modello, sinonimo del capo, o una delle ricerche correlate.

Rispondi SOLO con questo JSON valido, senza backtick né markdown:
{"queries":[{"q":"testo della ricerca","tipo":"web"}]}`
    });
    queries=normalizzaQueries(r.ok && r.data ? r.data.queries : null).slice(0,1);
  }catch(e){
    // Idem: si ripiega su quello che ha suggerito Google.
  }
  if(!queries.length && correlate.length) queries=[{ q:correlate[0], tipo:'web' }];
  chiudiPasso(i, queries.length?'fatto':'ko',
    queries.length?queries[0].q:'nessuna ricerca migliore da provare');
  return queries;
}

/* --- 4. il rapporto --- */
// Prima quelle con un prezzo: se la lista va tagliata, meglio perdere un
// risultato senza numeri.
function ordinaProve(prove){
  return prove.slice()
    .sort((a,b)=>(b.prezzo?1:0)-(a.prezzo?1:0))
    .slice(0,AG_PROVE_PROMPT);
}

async function sintetizza(capo, prove){
  const i=passo('Leggo i risultati e scrivo il rapporto');
  const p=prezziDelle(prove);
  const elenco=prove.map((r,n)=>
    `${n+1}. ${String(r.titolo).slice(0,90)} — ${r.fonte||'fonte ignota'}`
    + (r.prezzo?` — ${r.prezzo.valore}${r.prezzo.valuta}`:' — prezzo non leggibile')
    + (r.snippet?`\n   ${String(r.snippet).slice(0,120)}`:'')).join('\n');

  // La chiamata puo' non tornare affatto - i 9s della function - e in quel caso
  // il passo nel diario restava aperto per sempre, come se stesse ancora
  // lavorando. Chi guarda deve vedere che si e' fermato, e dove.
  let r;
  try{
    r=await callAIJson({
    type:'text',
    json:true,
    prompt:`Sei un esperto del mercato italiano dell'usato e stai scrivendo un rapporto per chi deve vendere questo capo su Vinted.

CAPO:
${descriviCapo(capo)}

RISULTATI TROVATI ONLINE ADESSO (numerati):
${elenco}

${p?`PREZZI LETTI NEI RISULTATI: mediana ${p.mediana}€, da ${p.min}€ a ${p.max}€, su ${p.n} risultati con prezzo.`:'NESSUN PREZZO LEGGIBILE nei risultati.'}

REGOLE:
- usa SOLO i risultati qui sopra, non la tua memoria dei prezzi
- cita i risultati per numero, es. "(3)"
- se un risultato è di un negozio è il prezzo del NUOVO: su Vinted l'usato vale una frazione, dillo
- se i risultati non parlano dello stesso capo, o sono pochi, dichiara fiducia bassa invece di inventare un numero preciso
- il prezzo consigliato è per una vendita reale su Vinted Italia nella condizione indicata

Rispondi SOLO con questo JSON valido, senza backtick né markdown:
{"riassunto":"3-4 frasi su cosa dice il mercato per questo capo","prezzoConsigliato":25,"rangeMin":18,"rangeMax":35,"fiducia":"alta, media o bassa","domanda":"alta, media o bassa","osservazioni":["osservazione con il numero del risultato che la sostiene"],"consigli":["consiglio pratico per vendere questo capo"]}`
    });
  }catch(e){
    chiudiPasso(i,'ko', e.message);
    throw e;
  }

  if(!r.ok){
    chiudiPasso(i,'ko','il modello non ha risposto in JSON');
    throw new Error('Rapporto non interpretabile, riprova.');
  }
  chiudiPasso(i,'fatto');
  return r.data;
}

/* --- prezzi e resa a schermo --- */
// Solo euro: un prezzo in $ o £ nella stessa mediana la falserebbe senza che
// si veda, ed e' poi il numero che finisce nel prompt come "dato di mercato
// vero" (vedi sxDiTipo, stesso filtro, per lo scanner).
function conPrezzo(prove){
  return prove.filter(p=>p && p.prezzo && typeof p.prezzo.valore==='number' && p.prezzo.valuta==='€');
}

// Stessa scelta della function: la mediana, non la media. Un solo negozio
// fuori mercato sposterebbe tutto il rapporto.
function prezziDelle(prove){
  const valori=conPrezzo(prove).map(p=>p.prezzo.valore).sort((a,b)=>a-b);
  if(!valori.length) return null;
  const meta=Math.floor(valori.length/2);
  const mediana=valori.length%2?valori[meta]:(valori[meta-1]+valori[meta])/2;
  return { n:valori.length, min:valori[0], max:valori[valori.length-1], mediana:Math.round(mediana*100)/100 };
}

function renderRicerca(senzaRapporto){
  const d=lastRicerca.rapporto||{}, p=lastRicerca.prezzi;
  const prezzo=num(d.prezzoConsigliato,null,0,100000);
  const rMin=num(d.rangeMin,null,0,100000), rMax=num(d.rangeMax,null,0,100000);

  const valori=[
    prezzo!==null?{ n:prezzo+'€', l:'Prezzo consigliato' }:null,
    (rMin!==null&&rMax!==null)?{ n:`${rMin}–${rMax}€`, l:'Range' }:null,
    p?{ n:p.mediana+'€', l:`Mediana su ${p.n} annunci` }:null,
    d.fiducia?{ n:String(d.fiducia).slice(0,12), l:'Fiducia' }:null
  ].filter(Boolean);

  // Tutto quello che segue arriva dal modello o da SerpApi: testo non fidato,
  // esc() su ogni campo prima di finire in innerHTML.
  const osservazioni=Array.isArray(d.osservazioni)?d.osservazioni:[];
  const consigli=Array.isArray(d.consigli)?d.consigli:[];
  const prove=lastRicerca.prove;

  document.getElementById('rRicBody').innerHTML=
      (senzaRapporto
        ? `<div class="tip" style="border-color:var(--re);color:var(--re)">⚠️ Il riassunto dell'AI non e' arrivato (${esc(senzaRapporto)}). Gli annunci trovati e i loro prezzi sono qui sotto: mediana e range li calcola la pagina, non il modello.</div>`
        : '')
    + `<div class="agm">${valori.map(x=>`<div class="agv"><div class="agvn">${esc(x.n)}</div><div class="agvl">${esc(x.l)}</div></div>`).join('')}</div>`
    + (d.riassunto?`<p style="font-size:14px;line-height:1.7;color:#fff;margin-bottom:12px">${esc(d.riassunto)}</p>`:'')
    + (d.domanda?`<div class="hSub" style="margin-bottom:10px">Domanda sul mercato: ${esc(d.domanda)}</div>`:'')
    + (osservazioni.length?`<ul style="list-style:none;margin-bottom:6px">${osservazioni.map((o,i)=>`<li class="fli" style="--i:${i}"><span class="fdot"></span>${esc(o)}</li>`).join('')}</ul>`:'')
    + consigli.map(c=>`<div class="tip">💡 ${esc(c)}</div>`).join('')
    + `<div class="rl" style="margin:18px 0 0">🔗 Su cosa si basa</div>`
    + prove.map((r,n)=>`
      <div class="lr" style="--i:${n}">
        <div class="lrn" aria-hidden="true">${n+1}</div>
        <div style="flex:1;min-width:0">
          <div class="lrt">${r.link?`<a href="${esc(r.link)}" target="_blank" rel="noopener noreferrer" style="color:inherit">${esc(r.titolo)}</a>`:esc(r.titolo)}</div>
          <div class="lrs">${esc(r.fonte)}</div>
        </div>
        ${r.prezzo?`<div class="lrp">${r.prezzo.valore}${esc(r.prezzo.valuta)}</div>`:''}
      </div>`).join('');

  // Stessa voce di storico di annuncio e stima quando il capo e' lo stesso:
  // itemIdFor riusa l'id finche' nome e marca non cambiano.
  upsertHistoryItem(itemIdFor(lastRicerca.capo.nome, lastRicerca.capo.marca), {
    nome: lastRicerca.capo.nome, marca: lastRicerca.capo.marca,
    taglia: lastRicerca.capo.taglia, condizione: lastRicerca.capo.condizione,
    prezzoSuggerito: prezzo === null ? undefined : prezzo,
    rangeMin: rMin === null ? undefined : rMin, rangeMax: rMax === null ? undefined : rMax,
    consiglio: consigli[0] || undefined
  });

  agTesto=[
    d.riassunto||'',
    prezzo!==null?`Prezzo consigliato: ${prezzo}€${(rMin!==null&&rMax!==null)?` (range ${rMin}–${rMax}€)`:''}`:'',
    d.fiducia?`Fiducia: ${d.fiducia}`:'',
    osservazioni.length?'\n'+osservazioni.map(o=>'- '+o).join('\n'):'',
    consigli.length?'\n'+consigli.map(c=>'💡 '+c).join('\n'):''
  ].filter(Boolean).join('\n').trim();
}

function copiaRicerca(btn){ copyText(agTesto).then(ok=>{ if(ok) confermaBottone(btn); }); }

// I prezzi trovati valgono per il capo su cui l'agente ha cercato. Se nella
// scheda prezzo c'e' un altro capo - si stimano piu' capi di seguito - quei
// numeri non devono entrare nel prompt: una stima sbagliata con dati "veri"
// e' peggio di una stima senza dati.
function stessoCapo(a, b){
  const parole=c=>String(`${c.nome||''} ${c.marca||''}`).toLowerCase()
    .replace(/[^a-zà-ù0-9]+/g,' ').split(' ').filter(w=>w.length>2);
  const pa=parole(a), pb=parole(b);
  return pa.length>0 && pb.length>0 && pa.some(w=>pb.includes(w));
}

// Il rapporto e' l'unico dato di mercato davvero fresco che abbiamo: la stima
// prezzo lo legge da lastRicerca (vedi stimaPrezzo).
function usaRicercaPerPrezzo(){
  if(!lastRicerca) return;
  const c=lastRicerca.capo;
  if(c.nome && !v('pNome')) document.getElementById('pNome').value=c.nome;
  if(c.marca && !v('pMarca')) document.getElementById('pMarca').value=c.marca;
  applyCondizione('pCond', c.condizione);
  if(!sw('prezzo')) return;
  toast('💶 Ricerca agganciata alla stima');
}

// Arrivando dall'analisi foto la scheda e' gia' compilata: l'agente serve a
// cercare, non a farsi riscrivere gli stessi dati a mano.
function prefillRicerca(){
  const obj=lastAnalysis;
  if(!obj) return;
  const set=(id,val)=>{
    const el=document.getElementById(id);
    if(el && !el.value && val) el.value=String(val).slice(0,80);
  };
  set('sNome', obj.tipo);
  if(obj.brand && !obj.brand.toLowerCase().includes('non identificat')) set('sMarca', obj.brand);
  set('sTaglia', obj.taglie);
  set('sNote', [obj.colore, obj.materiale].filter(Boolean).join(' '));
  applyCondizione('sCond', obj.condizione);
}

function toRicerca(nome){
  if(nome && !v('sNome')) document.getElementById('sNome').value=String(nome).slice(0,80);
  if(!sw('ricerca')) return;
  toast('🤖 Controlla i dati e avvia la ricerca');
}

/* ===== LO SCANNER =====
   Le altre schede sono strumenti: una guarda le foto, una cerca online, una
   stima. Qui c'e' un agente che li usa da solo e in fila, perche' sono la
   stessa domanda spezzata in tre - "quanto ci ricavo?" - e farla in tre
   schede vuol dire ricopiare a mano gli stessi dati due volte.

   Tre fasi, che sono i tre verbi:

   1. SCANSIONA - le foto, l'etichetta a piena risoluzione, e Google Lens.
      Ne esce un'identita' del capo in cui ogni campo si porta dietro da dove
      arriva: letto sull'etichetta, dedotto dalla foto, riconosciuto da Lens,
      detto da te. "Carhartt letto sul cartellino" e "Carhartt dedotto dalla
      forma" portano allo stesso prezzo con due affidabilita' diverse, e chi
      vende deve poterle distinguere.

   2. CERCA a giri, e ogni giro parte da cosa manca ancora invece che da una
      lista fissa: pochi annunci dell'usato, risultati che parlano di un altro
      capo, prezzi troppo sparsi, mediana che si muove ancora. Si ferma quando
      il quadro sta in piedi, non dopo un numero fisso di ricerche - ma il
      budget di ricerche resta, perche' ognuna costa quota.

   3. CAPISCE I PREZZI, ed e' qui la differenza vera con l'agente della scheda
      Ricerca, che di tutti i prezzi trovati fa una mediana sola. Un annuncio
      Vinted a 30€ e una scheda Zalando a 89€ non sono lo stesso numero: il
      primo dice a quanto si vende, il secondo quanto costa nuovo. Lo scanner
      li separa, scarta gli estremi con i quartili, e il prezzo lo sceglie
      dentro la banda degli annunci veri. Il nuovo resta solo come tetto.

   Come l'altro agente, il ciclo gira nel browser: Netlify chiude le function
   a 10s e un giro intero non ci starebbe mai. */

const BTN_SX=['btnSx'];
// Quattro giri al massimo e sei ricerche in tutto: il primo giro ne spende
// fino a tre, gli altri una a testa e solo se serve. Sul piano gratuito di
// SerpApi sono 250 ricerche al mese, quindi il tetto e' un limite vero, non
// una precauzione.
const SX_MAX_GIRI=4, SX_MAX_RICERCHE=6, SX_QUERY_PRIMO_GIRO=3;
// Sotto i cinque annunci dell'usato una mediana non e' una mediana, e' un
// aneddoto.
const SX_USATI_OK=5;
// Quanto puo' essere largo il quartile centrale rispetto alla mediana prima
// che il numero smetta di voler dire qualcosa, e di quanto puo' ancora
// muoversi la mediana perche' il quadro si consideri fermo.
const SX_SPARSI=0.9, SX_STABILE=0.10;
const SX_PROVE_PROMPT=12;

let lastScan=null, sxPassi=[], sxTesto='';

/* --- il diario, come per l'altro agente: e' quello che lo rende
       controllabile invece di uno spinner lungo un minuto --- */
function sxPasso(testo){
  sxPassi.push({ testo, stato:'corso', nota:'' });
  sxRenderPassi();
  return sxPassi.length-1;
}

function sxChiudi(i, stato, nota){
  if(!sxPassi[i]) return;
  sxPassi[i].stato=stato;
  sxPassi[i].nota=nota||'';
  sxRenderPassi();
}

function sxRenderPassi(){
  const el=document.getElementById('sxList');
  if(!el) return;
  el.innerHTML=sxPassi.map(p=>`
    <li class="agp ${p.stato}">
      <span class="agi" aria-hidden="true">${p.stato==='corso'?'<span class="spin agspin"></span>':AG_SEGNI[p.stato]}</span>
      <span style="flex:1;min-width:0">${esc(p.testo)}${p.nota?`<div class="agn">${esc(p.nota)}</div>`:''}</span>
    </li>`).join('');
}

// Foto nuove: quello che lo scanner aveva capito del capo di prima non deve
// restare ne' a schermo ne' dentro al prompt della stima.
function resetScanner(){
  lastScan=null; sxPassi=[]; sxTesto=''; sxFatte.clear();
  sxRenderPassi();
  hide('sxSteps'); hide('rSx'); hide('eSx');
}

async function avviaScanner(){
  if(!selFiles.length){ toast('SERVONO LE FOTO DEL CAPO'); return; }
  if(!busy('scanner',BTN_SX)) return;
  lastScan=null; sxPassi=[]; sxTesto=''; sxFatte.clear(); sxRenderPassi();
  show('sxSteps'); hide('eSx'); hide('rSx');
  try{
    const identita=await sxScansione();
    const { prove, motivoStop, erroreRicerca }=await sxIndagine(identita);
    const mercato=sxMercato(prove);

    lastScan={ identita, prove:sxOrdina(prove), mercato, motivoStop, erroreRicerca, verdetto:null };
    // Senza un solo prezzo dell'usato non c'e' niente da concludere: il
    // modello inventerebbe un numero, ed e' esattamente quello che questo
    // agente esiste per non fare. L'identita' pero' vale gia' da sola.
    if(mercato.usato) lastScan.verdetto=await sxVerdetto(identita, mercato, lastScan.prove);
    sxDisegna();
    show('rSx');
    tocco();
  }catch(e){
    document.getElementById('eSx').textContent='⚠️ '+e.message;
    show('eSx');
  }finally{
    idle('scanner',BTN_SX);
  }
}

/* ============ 1. LA SCANSIONE: che capo e' ============ */

async function sxScansione(){
  const iFoto=sxPasso(`Guardo ${selFiles.length===1?'la foto':`le ${selFiles.length} foto`}${labelIndex>=0?' e l\'etichetta':''}`);
  let letto;
  try{
    letto=await leggiFoto();
  }catch(e){
    sxChiudi(iFoto,'ko', e.dettaglio ? e.message+' — il server dice: '+e.dettaglio : e.message);
    throw new Error('Non sono riuscito a leggere le foto: '+e.message);
  }
  if(!letto.risposta.ok){
    sxChiudi(iFoto,'ko', sxCosaHaDetto(letto.risposta.raw));
    throw new Error('Analisi delle foto non interpretabile, riprova.');
  }
  const analisi=letto.risposta.data;
  if(letto.etichetta) applicaEtichetta(analisi, letto.etichetta);
  // La scheda Analizza e' la stessa cosa vista da un'altra parte: quello che
  // lo scanner ha letto vale anche di la', senza rifare la richiesta.
  lastAnalysis=analisi; lastEtichetta=letto.etichetta;
  sxChiudi(iFoto,'fatto', [analisi.tipo, analisi.brand].filter(campoLetto).join(' · ')
    + (letto.etichetta && etichettaUtile(letto.etichetta) ? ' · etichetta letta' : '')
    + (lastGemini ? ` · Gemini non usato: ${lastGemini}` : ''));

  // Lens e' un lusso: dice il nome del modello, che e' la chiave della
  // ricerca, ma senza SERPAPI_KEY non c'e'. Il giro va avanti lo stesso.
  const iLente=sxPasso('Cerco il prodotto con la foto');
  let lens=null;
  try{
    lens=await identificaConLens();
    const quanti=(lens && Array.isArray(lens.risultati)) ? lens.risultati.length : 0;
    if(quanti){
      lastLens=lens;
      sxChiudi(iLente,'fatto', (lens.ipotesi||`${quanti} prodotti simili`)
        + (lens.prezzi?` · listino mediano ${lens.prezzi.mediana}€`:''));
    }else{
      lens=null;
      sxChiudi(iLente,'ko','nessun prodotto riconosciuto da questa foto');
    }
  }catch(e){
    sxChiudi(iLente,'ko', e.nonConfigurato ? 'ricerca per immagine non configurata (SERPAPI_KEY)' : e.message);
  }

  const iId=sxPasso('Metto insieme l\'identita\' del capo');
  const identita=sxIdentita(analisi, letto.etichetta, lens, v('sxNote'));
  sxChiudi(iId,'fatto', sxDescrizioneBreve(identita));
  return identita;
}

// Lens vuole il capo intero, non l'etichetta: la stessa scelta di
// identificaProdotto, qui senza toccare la scheda Analizza.
async function identificaConLens(){
  const idx=selFiles.findIndex((f,i)=>i!==labelIndex);
  const bmp=await decodeImage(selFiles[idx>=0?idx:0]);
  let base64;
  try{ base64=sottoPeso(bmp, 460*1024); }
  finally{ releaseImage(bmp); }
  return chiamaEndpoint(LENS_URL,{ image: base64 });
}

// Ogni campo tiene la sua provenienza. L'ordine e' sempre lo stesso: quello
// che c'e' scritto batte quello che si e' dedotto guardando.
function sxCampo(valore, fonte){
  return campoLetto(valore) ? { v:String(valore).trim().slice(0,120), f:fonte } : null;
}

function sxVal(campo){ return campo ? campo.v : ''; }

function sxIdentita(analisi, etichetta, lens, note){
  const a=analisi||{}, e=etichetta||{};
  const vintage = a.vintageStima && !/non vintage/i.test(a.vintageStima)
    && /media|alta/i.test(a.vintageConfidenza||'') ? a.vintageStima : '';
  return {
    tipo:       sxCampo(a.tipo, 'foto'),
    marca:      sxCampo(e.marca, 'etichetta') || sxCampo(a.brand, 'foto'),
    modello:    sxCampo(lens && lens.ipotesi, 'lente'),
    materiale:  sxCampo(e.composizione, 'etichetta') || sxCampo(a.materiale, 'foto'),
    taglia:     sxCampo(e.taglia, 'etichetta') || sxCampo(a.taglie, 'foto'),
    colore:     sxCampo(a.colore, 'foto'),
    condizione: sxCampo(a.condizione, 'foto'),
    epoca:      sxCampo(vintage, 'foto'),
    difetti:    sxCampo(a.note, 'foto'),
    tuo:        sxCampo(note, 'tu'),
    // Il listino di Lens non e' il prezzo dell'usato, ma e' un tetto vero:
    // sotto quello si vende, sopra no.
    listino:    (lens && lens.prezzi) ? lens.prezzi : null
  };
}

function sxDescrizioneBreve(id){
  return [sxVal(id.marca), sxVal(id.modello) || sxVal(id.tipo), sxVal(id.taglia)]
    .filter(Boolean).join(' · ');
}

function sxDescrivi(id){
  const righe=[
    ['Capo', sxVal(id.tipo)], ['Marca', sxVal(id.marca)], ['Modello riconosciuto', sxVal(id.modello)],
    ['Materiale', sxVal(id.materiale)], ['Taglia', sxVal(id.taglia)], ['Colore', sxVal(id.colore)],
    ['Condizione', sxVal(id.condizione)], ['Epoca', sxVal(id.epoca)],
    ['Difetti visti', sxVal(id.difetti)], ['Detto dal venditore', sxVal(id.tuo)]
  ];
  return righe.filter(r=>r[1]).map(r=>`- ${r[0]}: ${r[1]}`).join('\n') || '- nessun dato leggibile dalle foto';
}

/* ============ 2. L'INDAGINE: cercare finche' i conti tornano ============ */

async function sxIndagine(identita){
  const prove=[], correlate=[];
  let ricerche=0, lacuna=null, medianaPrima=null, motivoStop='', erroreRicerca=null;

  for(let giro=1; giro<=SX_MAX_GIRI && ricerche<SX_MAX_RICERCHE; giro++){
    const quante=Math.min(giro===1?SX_QUERY_PRIMO_GIRO:1, SX_MAX_RICERCHE-ricerche);
    const queries=await sxPiano(identita, prove, correlate, lacuna, quante, giro);
    if(!queries.length){ motivoStop='non avevo altre ricerche sensate da provare'; break; }

    const esito=await sxEsegui(queries, prove, correlate);
    ricerche+=queries.length;
    if(esito.errore) erroreRicerca=esito.errore;
    // Tutte fallite e niente in mano: e' un guasto vero (chiave, quota, rete),
    // ma non e' un motivo per buttare via la scansione. Si esce dal giro e il
    // rapporto dice cosa e' successo, con l'identita' del capo che resta.
    if(esito.errore && !prove.length){
      motivoStop='la ricerca online non ha risposto: '+esito.errore.message;
      break;
    }

    sxValuta(prove, identita);
    const mercato=sxMercato(prove);
    lacuna=sxLacuna(mercato, prove, medianaPrima);
    medianaPrima=mercato.usato ? mercato.usato.mediana : null;

    if(!lacuna){ motivoStop='i prezzi dell\'usato tornano fra loro'; break; }
    if(giro===SX_MAX_GIRI || ricerche>=SX_MAX_RICERCHE){
      motivoStop='ho finito il budget di ricerche con '+lacuna;
      break;
    }
    sxChiudi(sxPasso('Non mi basta: '+lacuna), 'fatto', 'faccio un altro giro');
  }

  sxValuta(prove, identita);
  return { prove, motivoStop, erroreRicerca };
}

async function sxPiano(identita, prove, correlate, lacuna, quante, giro){
  const i=sxPasso(giro===1?'Decido cosa cercare':'Cambio strategia di ricerca');
  let queries=[];
  try{
    const r=await callAIJson({
      type:'text',
      json:true,
      prompt:`Sei un agente che deve scoprire a quanto si vende DAVVERO questo capo usato sul mercato italiano dell'usato (Vinted, Subito, Depop, eBay).

CAPO, come l'ho scansionato dalle foto:
${sxDescrivi(identita)}

${lacuna?`COSA NON TORNA ANCORA: ${lacuna}.\nLe ricerche fatte finora hanno dato ${prove.length} risultati, di cui ${sxDiTipo(prove,'usato').length} annunci dell'usato con un prezzo. Titoli visti:\n${prove.slice(0,8).map((p,n)=>`${n+1}. ${String(p.titolo).slice(0,80)}${p.prezzo?` — ${p.prezzo.valore}€`:''}`).join('\n')}\n\nRicerche correlate suggerite da Google: ${correlate.length?correlate.slice(0,4).join(', '):'nessuna'}\n\nCambia strategia: se i risultati parlavano di un altro capo restringi (nome del modello, marca esatta); se erano pochi allarga (categoria e materiale invece del modello); se erano tutti di negozi punta esplicitamente ai siti dell'usato.`:'E\' il primo giro: parti dalle ricerche che hanno piu\' probabilita\' di far uscire annunci veri con un prezzo.'}

Scrivi ${quante===1?'UNA sola ricerca':`al massimo ${quante} ricerche`} da dare a Google, in italiano.
- almeno una deve puntare agli annunci dell'usato (per esempio con "vinted" o "subito" nel testo)
- solo parole chiave, come le scriverebbe una persona: niente domande, niente frasi
- non ripetere una ricerca gia' fatta

Rispondi SOLO con questo JSON valido, senza backtick né markdown:
{"queries":[{"q":"testo della ricerca","tipo":"web","perche":"cosa ti aspetti di trovare"}]}
Il campo tipo vale "web" per i risultati normali (dove stanno gli annunci dell'usato), "shopping" per le schede prodotto col prezzo di listino.`
    });
    queries=normalizzaQueries(r.ok && r.data ? r.data.queries : null).slice(0, quante);
  }catch(e){
    // Il piano e' un lusso: se il modello non risponde si cerca lo stesso.
  }
  queries=queries.filter(q=>!sxGiaFatta(q.q));
  if(!queries.length) queries=sxRiserva(identita, correlate).slice(0, quante);
  sxChiudi(i, queries.length?'fatto':'ko',
    queries.length?queries.map(q=>q.q).join(' · '):'nessuna ricerca nuova da provare');
  return queries;
}

// Le query gia' spese non si rifanno: la function le servirebbe dalla cache,
// ma sarebbe comunque un giro buttato di un budget da sei.
const sxFatte=new Set();
function sxGiaFatta(q){ return sxFatte.has(String(q).toLowerCase()); }

function sxRiserva(identita, correlate){
  const base=[sxVal(identita.marca), sxVal(identita.modello)||sxVal(identita.tipo)]
    .filter(Boolean).join(' ').trim() || sxVal(identita.tipo) || sxVal(identita.tuo);
  const proposte=[
    { q:`${base} usato vinted prezzo`, tipo:'web' },
    // Il venduto e' la prova migliore che esista, e su eBay e' l'unica che si
    // riesce a raccogliere: vale una delle poche ricerche di riserva.
    { q:`${base} venduto ebay prezzo`, tipo:'web' },
    { q:`${base} subito usato`, tipo:'web' },
    { q:`${base} prezzo`, tipo:'shopping' }
  ].concat(correlate.map(c=>({ q:c, tipo:'web' })));
  return proposte.filter(p=>p.q.trim() && !sxGiaFatta(p.q));
}

async function sxEsegui(queries, prove, correlate){
  const indici=queries.map(q=>sxPasso(`Cerco: ${q.q}`));
  queries.forEach(q=>sxFatte.add(q.q.toLowerCase()));
  const esiti=await Promise.all(queries.map(q=>
    chiamaEndpoint(RICERCA_URL,{ query:q.q, tipo:q.tipo })
      .then(d=>({ ok:true, d, q }))
      .catch(e=>({ ok:false, e }))
  ));

  let errore=null;
  esiti.forEach((esito,k)=>{
    if(!esito.ok){
      errore=errore||esito.e;
      sxChiudi(indici[k],'ko', esito.e.message);
      return;
    }
    const trovati=Array.isArray(esito.d.risultati)?esito.d.risultati:[];
    let nuovi=0;
    for(const r of trovati){
      if(!r || !r.titolo || prove.some(p=>p.titolo===r.titolo)) continue;
      // Da che tipo di ricerca arriva conta: una scheda shopping e' un
      // listino, non un annuncio, anche quando il dominio non lo dice.
      prove.push(Object.assign({}, r, { daShopping: esito.q.tipo==='shopping' }));
      nuovi++;
    }
    for(const c of (Array.isArray(esito.d.correlate)?esito.d.correlate:[])){
      if(c && !correlate.includes(c)) correlate.push(c);
    }
    sxChiudi(indici[k],'fatto',
      `${nuovi} risultati nuovi, ${trovati.filter(r=>r&&r.prezzo).length} con prezzo`);
  });
  return { errore };
}

/* ============ 3. CAPIRE I PREZZI ============ */

// Dove finisce l'usato e dove comincia il negozio. Il dominio e' il segnale
// piu' affidabile che abbiamo: su vinted.it si vende usato qualunque cosa
// dica il titolo, su zalando.it si vende nuovo lo stesso.
const SX_USATO=/vinted|subito\.it|subito|depop|wallapop|ebay|kijiji|mercatino|vestiaire|micolet|humana|rebelle|videdressing|vinokilo|swap/i;
const SX_NEGOZIO=/zalando|amazon|asos|farfetch|yoox|zara|h&m|hm\.com|uniqlo|nike\.com|adidas|footlocker|about-?you|luisaviaroma|mytheresa|ssense|shein|decathlon|cisalfa|snipes|foot\s?district/i;
// Quando il dominio non basta, lo dice il testo. "Nuovo con cartellino" su
// Vinted resta usato: e' il posto a decidere, non l'aggettivo.
const SX_TESTO_USATO=/\busat[oaie]\b|seconda mano|second[\s-]?hand|pre[\s-]?owned|pre[\s-]?loved|vintage/i;

function sxDoveSta(prova){
  const dove=`${prova.fonte||''} ${prova.link||''}`;
  if(SX_USATO.test(dove)) return 'usato';
  if(SX_NEGOZIO.test(dove)) return 'nuovo';
  if(prova.daShopping) return 'nuovo';
  if(SX_TESTO_USATO.test(`${prova.titolo||''} ${prova.snippet||''}`)) return 'usato';
  // Un sito qualunque che espone un prezzo, quasi sempre, e' un negozio: ma
  // "quasi sempre" non e' "sempre", e un incerto contato come usato
  // sposterebbe la mediana di nascosto. Resta fuori dai conti.
  return 'incerto';
}

function sxParole(testo){
  return String(testo||'').toLowerCase().replace(/[^a-zà-ù0-9]+/g,' ').split(' ').filter(w=>w.length>2);
}

// Un risultato che non nomina ne' la marca ne' il tipo di capo non parla di
// questo capo. Resta in elenco, marcato, ma fuori dalla mediana: e' proprio
// il modo in cui una stima "basata su dati veri" diventa sbagliata.
function sxPertinente(prova, identita){
  const testo=`${prova.titolo||''} ${prova.snippet||''}`.toLowerCase();
  const marca=sxVal(identita.marca).toLowerCase().trim();
  if(marca && testo.includes(marca)) return true;
  const parole=sxParole(sxVal(identita.tipo)).concat(sxParole(sxVal(identita.modello)));
  return parole.some(p=>testo.includes(p));
}

// La scala delle condizioni di Vinted, dal cartellino ancora attaccato al capo
// che si vede che e' stato messo. Fra i due estremi ci passa spesso il doppio
// del prezzo: mettere nella stessa mediana un "nuovo con cartellino" e un
// "soddisfacente" allarga la banda per un motivo che sapevamo gia'.
const SX_CONDIZIONI=[
  { n:4, re:/nuovo con (etichett|cartellin)|new with tag|\bnwt\b/i },
  { n:3, re:/nuovo senza (etichett|cartellin)|new without tag|\bnwot\b|mai (indossat|uss)|\bnuov[oa]\b/i },
  { n:2, re:/ottim[oaie]|come nuov|eccellente|quasi nuov|perfette condizioni/i },
  { n:1, re:/buon[oaie] condizion|\bbuon[oaie]\b/i },
  { n:0, re:/soddisfacent|accettabil|discret[oaie]|segni di usura|usurat|da sistemare|difettat|rovinat/i }
];

function sxScalaCondizione(testo){
  const t=String(testo||'');
  for(const c of SX_CONDIZIONI) if(c.re.test(t)) return c.n;
  return null;
}

// Un prezzo di venduto non e' un prezzo chiesto: e' l'unica prova che a quella
// cifra qualcuno ha davvero comprato. Su Vinted non e' pubblico, su eBay e nei
// mercatini a volte si', ed e' li' che vale la pena cercarlo.
// "venduto da" invece e' la riga di un negozio, non un esito.
const SX_VENDUTO=/\bvendut[oai]\b(?!\s+(da|e spedit))|\bsold\b|aggiudicat|prezzo di vendita/i;

// Quanto conta una prova, oltre al suo prezzo. Tre cose la spostano.
//
// L'eta': gli annunci vivi sono richieste, non vendite, e siccome gli invenduti
// restano online mentre i venduti spariscono, una banda fatta di soli annunci
// vivi pende verso l'alto. Un annuncio fermo da mesi e' proprio la prova che a
// quel prezzo non si e' venduto: pesa meno.
//
// La condizione: si confronta con quella del capo scansionato, perche' e' fra
// le due condizioni che ci passa il salto di prezzo piu' grosso.
//
// E l'esito: un venduto vale piu' di una richiesta.
//
// Quando non si sa niente - niente data, niente condizione - il peso resta
// uguale per tutti, e i conti vengono identici a una mediana semplice: il peso
// sposta qualcosa solo quando c'e' davvero qualcosa da sapere.
const SX_PESO_ETA=[[45,1],[90,0.8],[180,0.6],[365,0.45]], SX_PESO_ETA_OLTRE=0.3;
const SX_PESO_COND=[1,0.7,0.45,0.3], SX_PESO_COND_IGNOTA=0.8;
const SX_PESO_VENDUTO=1.6;
// Piu' vecchio di cosi' e l'annuncio si racconta come "vecchio" a schermo.
const SX_ETA_VECCHIA=90;

function sxPesoDi(prova, condizioneCapo){
  const giorni=(prova.eta && typeof prova.eta.giorni==='number') ? prova.eta.giorni : null;
  let peso=1;
  if(giorni!==null){
    const scaglione=SX_PESO_ETA.find(s=>giorni<=s[0]);
    peso*= scaglione ? scaglione[1] : SX_PESO_ETA_OLTRE;
  }
  const sua=sxScalaCondizione(`${prova.titolo||''} ${prova.snippet||''}`);
  const distanza=(sua!==null && condizioneCapo!==null) ? Math.abs(sua-condizioneCapo) : null;
  peso*= distanza===null ? SX_PESO_COND_IGNOTA : SX_PESO_COND[Math.min(3,distanza)];
  if(prova.venduto) peso*=SX_PESO_VENDUTO;
  return { peso, giorni, condizione:sua, distanza };
}

function sxValuta(prove, identita){
  const condCapo=sxScalaCondizione(sxVal(identita.condizione));
  for(const p of prove){
    p.mercato=sxDoveSta(p);
    p.pertinente=sxPertinente(p, identita);
    p.venduto=p.mercato==='usato' && SX_VENDUTO.test(`${p.titolo||''} ${p.snippet||''}`);
    const q=sxPesoDi(p, condCapo);
    p.peso=q.peso; p.giorni=q.giorni; p.condScala=q.condizione; p.condDist=q.distanza;
  }
}

function sxDiTipo(prove, mercato){
  return prove.filter(p=>p.pertinente && p.mercato===mercato && p.prezzo
    && typeof p.prezzo.valore==='number' && p.prezzo.valuta==='€');
}

// I prezzi di un mercato, ognuno col peso della prova da cui viene.
function sxCampioni(prove, mercato){
  return sxDiTipo(prove, mercato)
    .map(p=>({ valore:p.prezzo.valore, peso:(typeof p.peso==='number' && p.peso>0)?p.peso:0.01, prova:p }));
}

// Quantile pesato, per interpolazione. Con pesi tutti uguali da' esattamente i
// numeri di prima - ogni valore resta alla posizione (i-1)/(n-1) - quindi il
// peso sposta il quantile solo quando le prove valgono davvero diverso.
// Con pochi valori prendere l'elemento a indice intero salterebbe da un
// annuncio all'altro invece di stare in mezzo.
//
// Il prezzo di quell'identita' e' che il primo e l'ultimo valore restano
// ancorati a q=0 e q=1: un peso enorme su un estremo tira il quantile verso di
// se' ma non se lo porta tutto, mentre in mezzo lo fa. E' voluto - quel bordo
// e' l'unico posto dove un peso gonfiato potrebbe spostare la mediana da solo -
// ma chi ci mette mano si aspetti questo e non la media pesata dei manuali.
function sxQuantile(campioni, q){
  if(!campioni.length) return null;
  if(campioni.length===1) return campioni[0].valore;
  const somma=campioni.reduce((t,c)=>t+c.peso,0);
  const primo=campioni[0].peso, ultimo=campioni[campioni.length-1].peso;
  const den=somma-primo/2-ultimo/2;
  const arrotonda=x=>Math.round(x*100)/100;
  if(!(den>0)) return arrotonda(campioni[Math.round((campioni.length-1)*q)].valore);
  let cum=0;
  const pos=campioni.map(c=>{ cum+=c.peso; return (cum-c.peso/2-primo/2)/den; });
  if(q<=0) return arrotonda(campioni[0].valore);
  if(q>=1) return arrotonda(campioni[campioni.length-1].valore);
  for(let i=1;i<campioni.length;i++){
    if(q<=pos[i]){
      const a=pos[i-1], b=pos[i], t=b>a?(q-a)/(b-a):0;
      return arrotonda(campioni[i-1].valore + (campioni[i].valore-campioni[i-1].valore)*t);
    }
  }
  return arrotonda(campioni[campioni.length-1].valore);
}

// Un lotto stock a 400€ in mezzo a dieci felpe da 30 non e' il mercato, e'
// rumore: la regola dei quartili (Tukey) lo toglie senza dover scegliere a
// mano una soglia. Sotto i quattro valori non si filtra niente: con tre
// numeri il "fuori scala" non esiste.
function sxSenzaEstremi(campioni){
  const ordinati=campioni.slice().sort((a,b)=>a.valore-b.valore);
  if(ordinati.length<4) return { tenuti:ordinati, scartati:[] };
  const q1=sxQuantile(ordinati,0.25), q3=sxQuantile(ordinati,0.75), iqr=q3-q1;
  if(!(iqr>0)) return { tenuti:ordinati, scartati:[] };
  const basso=q1-1.5*iqr, alto=q3+1.5*iqr;
  return {
    tenuti: ordinati.filter(c=>c.valore>=basso && c.valore<=alto),
    scartati: ordinati.filter(c=>c.valore<basso || c.valore>alto).map(c=>c.valore)
  };
}

function sxStatistiche(campioni){
  const { tenuti, scartati }=sxSenzaEstremi(campioni);
  if(!tenuti.length) return null;
  const somma=tenuti.reduce((t,c)=>t+c.peso,0);
  const quadrati=tenuti.reduce((t,c)=>t+c.peso*c.peso,0);
  const conGiorni=tenuti.filter(c=>typeof c.prova.giorni==='number');
  return {
    n: tenuti.length,
    // Quante prove *contano* davvero. Dieci annunci di cui otto vecchi e di
    // un'altra condizione non sono dieci prove, e la fiducia lo deve sapere:
    // e' il numero equivalente di prove a peso pieno.
    nEff: Math.round(somma*somma/quadrati*10)/10,
    min: tenuti[0].valore,
    max: tenuti[tenuti.length-1].valore,
    q1: sxQuantile(tenuti,0.25),
    mediana: sxQuantile(tenuti,0.5),
    q3: sxQuantile(tenuti,0.75),
    scartati,
    venduti: tenuti.filter(c=>c.prova.venduto).length,
    stessaCond: tenuti.filter(c=>c.prova.condDist===0).length,
    datati: conGiorni.length,
    vecchi: conGiorni.filter(c=>c.prova.giorni>SX_ETA_VECCHIA).length
  };
}

function sxMercato(prove){
  const usato=sxStatistiche(sxCampioni(prove,'usato'));
  // I listini dei negozi pesano tutti uguale: una scheda prodotto e' una
  // scheda prodotto, non ha ne' condizione ne' esito.
  const nuovo=sxStatistiche(sxCampioni(prove,'nuovo').map(c=>Object.assign({},c,{peso:1})));
  const pertinenti=prove.filter(p=>p.pertinente).length;
  return {
    usato, nuovo,
    // Quanto vale l'usato rispetto al nuovo: e' il numero che dice se il capo
    // tiene il prezzo o lo perde, e non si puo' leggere da una mediana sola.
    tenuta: (usato && nuovo && nuovo.mediana>0) ? Math.round(usato.mediana/nuovo.mediana*100) : null,
    pertinenti, totale: prove.length
  };
}

// Com'e' fatta la banda, in una riga: e' la differenza fra "27€ su sei
// annunci" e "27€ su sei annunci di cui nessuno nella tua condizione".
function sxComposizione(u){
  if(!u) return '';
  const pezzi=[];
  if(u.venduti) pezzi.push(`${u.venduti} ${u.venduti===1?'e un prezzo di venduto':'sono prezzi di venduto'}`);
  if(u.stessaCond) pezzi.push(`${u.stessaCond} ${u.stessaCond===1?'ha':'hanno'} la stessa condizione del tuo`);
  if(u.vecchi) pezzi.push(`${u.vecchi} ${u.vecchi===1?'è un annuncio più vecchio':'sono annunci più vecchi'} di tre mesi e ${u.vecchi===1?'pesa':'pesano'} meno`);
  if(!pezzi.length) return `Di questi ${u.n} annunci non so né la data né la condizione: contano tutti uguale.`;
  return `Di ${u.n} annunci: ${pezzi.join(', ')}.`;
}

// Cosa manca ancora perche' il numero voglia dire qualcosa. E' anche la
// domanda con cui si scrive la ricerca del giro dopo: un agente che sa cosa
// gli manca cerca meglio di uno che ripete la stessa query con altre parole.
function sxLacuna(mercato, prove, medianaPrima){
  if(prove.length && mercato.pertinenti < prove.length/2){
    return 'piu\' di meta\' dei risultati parla di un altro capo';
  }
  if(!mercato.usato || mercato.usato.nEff < SX_USATI_OK){
    const u=mercato.usato;
    if(!u) return `ho 0 annunci dell'usato con un prezzo, ne servono ${SX_USATI_OK}`;
    // Il conto che manca e' quello delle prove che pesano, non delle righe:
    // sei annunci vecchi e di un'altra condizione valgono meno di sei prove,
    // e il giro dopo deve saperlo per cercare meglio invece che di piu'.
    return u.nEff < u.n - 0.4
      ? `ho ${u.n} annunci dell'usato ma valgono come ${u.nEff}: sono vecchi o di un'altra condizione`
      : `ho solo ${u.n} annunci dell'usato con un prezzo, ne servono ${SX_USATI_OK}`;
  }
  const larghezza=(mercato.usato.q3-mercato.usato.q1)/mercato.usato.mediana;
  if(larghezza>SX_SPARSI) return 'i prezzi dell\'usato sono troppo sparsi per dire un numero';
  if(medianaPrima && Math.abs(mercato.usato.mediana-medianaPrima)/medianaPrima > SX_STABILE){
    return 'la mediana si sta ancora muovendo';
  }
  return null;
}

// La fiducia la calcola il codice dai dati, non la dichiara il modello: un
// modello a cui si chiede quanto e' sicuro risponde quasi sempre "media".
//
// E non e' un'etichetta accanto a un numero che resta preciso lo stesso: con
// tre annunci sparsi "27€" sembra una misura e non lo e'. Sotto la soglia il
// campo "numero" dice di no, e la pagina mostra la banda invece della cifra.
function sxFiducia(mercato){
  const u=mercato.usato;
  if(!u || u.nEff<3){
    return { livello:'bassa', numero:false,
      perche:`solo ${u?u.n:0} annunci dell'usato con un prezzo leggibile${u&&u.nEff<u.n-0.4?`, che pesati valgono come ${u.nEff}`:''}` };
  }
  const largh=(u.q3-u.q1)/u.mediana;
  const pesati=u.nEff<u.n-0.4 ? ` (${u.n} trovati, ma vecchi o di un'altra condizione)` : '';
  if(u.nEff>=8 && largh<=0.45){
    return { livello:'alta', numero:true, perche:`${u.n} annunci dell'usato, e i prezzi stanno vicini fra loro` };
  }
  if(u.nEff>=SX_USATI_OK && largh<=SX_SPARSI){
    return { livello:'media', numero:true, perche:`${u.nEff} annunci dell'usato che contano${pesati}, prezzi abbastanza vicini` };
  }
  return { livello:'bassa', numero:false,
    perche: largh>SX_SPARSI
      ? `${u.n} annunci, ma con prezzi molto diversi fra loro (da ${u.min}€ a ${u.max}€)`
      : `${u.nEff} annunci che contano${pesati}: troppo pochi perche' un numero solo voglia dire qualcosa` };
}

// Quanto e' incerta la mediana, in euro. Meta' della larghezza del quartile
// centrale divisa per la radice delle prove che contano: piu' i prezzi sono
// sparsi e meno prove ci sono, piu' il range si allarga. E' il modo in cui la
// fiducia entra nel numero invece di restare un aggettivo di fianco.
function sxMargine(u){
  if(!u || !(u.nEff>0)) return 0;
  return Math.round((u.q3-u.q1)/(2*Math.sqrt(u.nEff))*10)/10;
}

/* ============ 4. IL VERDETTO ============ */

// Prima gli annunci dell'usato con un prezzo: se la lista va tagliata, si
// perde un listino di negozio, non la prova su cui si decide.
function sxOrdina(prove){
  const peso=p=>(p.pertinente?4:0)+(p.mercato==='usato'?2:0)+(p.prezzo?1:0);
  return prove.slice().sort((a,b)=>peso(b)-peso(a)).slice(0,SX_PROVE_PROMPT);
}

// "Il modello non ha risposto in JSON" non dice niente a nessuno: quello che
// ha risposto davvero e' l'unica cosa che spiega perche', e il diario e' il
// posto giusto per scriverlo.
function sxCosaHaDetto(raw){
  const testo=String(raw==null?'':raw).replace(/\s+/g,' ').trim();
  if(!testo) return 'il modello non ha risposto niente';
  return 'il modello non ha risposto in JSON, ha detto: '+testo.slice(0,180);
}

async function sxVerdetto(identita, mercato, prove){
  const i=sxPasso('Leggo i prezzi e decido');
  const u=mercato.usato, n=mercato.nuovo;
  // Ogni riga si porta dietro quello che la rende una prova migliore o
  // peggiore: se e' un venduto, quanto e' vecchia, in che condizione e' il
  // capo di cui parla. Il modello cita per numero, e deve poter dire "il (3)
  // e' di sei mesi fa" invece di trattarlo come l'annuncio di ieri.
  const cond=['soddisfacente','buono','ottimo','nuovo senza cartellino','nuovo con cartellino'];
  const elenco=prove.map((r,k)=>
    `${k+1}. [${r.pertinente?r.mercato:'fuori tema'}]${r.venduto?' [venduto]':''} ${String(r.titolo).slice(0,80)} — ${r.fonte||'fonte ignota'}`
    + (r.prezzo?` — ${r.prezzo.valore}${r.prezzo.valuta}`:' — prezzo non leggibile')
    + (r.eta && r.eta.testo?` — ${r.eta.testo}`:'')
    + (r.condScala!==null && r.condScala!==undefined?` — condizione: ${cond[r.condScala]}`:'')).join('\n');

  const r=await callAIJson({
    type:'text',
    json:true,
    prompt:`Sei un esperto del mercato italiano dell'usato e devi dire a quanto mettere in vendita questo capo su Vinted Italia.

CAPO SCANSIONATO:
${sxDescrivi(identita)}

PREZZI DEGLI ANNUNCI DELL'USATO (gia' separati dai listini dei negozi e ripuliti dagli estremi):
- ${u.n} annunci, da ${u.min}€ a ${u.max}€
- meta' degli annunci sta fra ${u.q1}€ e ${u.q3}€, la mediana e' ${u.mediana}€
- questi numeri sono gia' PESATI: un annuncio vecchio o di un'altra condizione conta meno di uno recente e nella stessa condizione, e un prezzo di venduto conta piu' di uno chiesto
- di questi ${u.n}: ${u.venduti} sono prezzi di venduto, ${u.stessaCond} sono nella stessa condizione del capo, ${u.vecchi} sono piu' vecchi di tre mesi
- ATTENZIONE: quasi tutti questi prezzi sono RICHIESTE di annunci ancora online, non vendite concluse. Gli invenduti restano online e i venduti spariscono, quindi la banda pende verso l'alto: se non ci sono prezzi di venduto, dillo fra i rischi
${n?`\nPREZZI DEI NEGOZI (il NUOVO, che fa da tetto): mediana ${n.mediana}€ su ${n.n} risultati.${mercato.tenuta?` L'usato vale circa il ${mercato.tenuta}% del nuovo.`:''}`:'\nNessun prezzo del nuovo trovato.'}

RISULTATI SU CUI SI BASA TUTTO (numerati, col mercato di provenienza fra parentesi quadre):
${elenco}

REGOLE:
- il prezzo consigliato deve stare fra ${u.q1}€ e ${u.q3}€, che e' dove sta meta' del mercato: se esci da li' devi dire nel campo "perche" quale risultato lo giustifica
- usa SOLO i numeri qui sopra, mai la tua memoria dei prezzi
- i risultati marcati "nuovo" sono prezzi di negozio, i "fuori tema" non parlano di questo capo: non contarli come prova di quanto si vende
- cita i risultati per numero, es. "(3)"
- se fra i risultati ci sono condizioni diverse dalla tua, tienine conto: fra un "nuovo con cartellino" e un "soddisfacente" ci passa spesso il doppio del prezzo
- "veloce" e' il prezzo per vendere in pochi giorni, "paziente" quello per cui vale la pena aspettare: sono due numeri diversi, ed e' la cosa piu' utile da sapere per chi vende

Rispondi SOLO con questo JSON valido, senza backtick né markdown:
{"lettura":"3-4 frasi su cosa dice il mercato per questo capo, con i numeri","prezzoConsigliato":${u.mediana},"prezzoVeloce":${u.q1},"prezzoPaziente":${u.q3},"perche":["osservazione col numero del risultato che la sostiene"],"rischi":["cosa potrebbe rendere sbagliata questa stima"],"consigli":["consiglio pratico per vendere questo capo"]}`
  });

  if(!r.ok){
    sxChiudi(i,'ko', sxCosaHaDetto(r.raw));
    throw new Error('Verdetto non interpretabile, riprova.');
  }
  sxChiudi(i,'fatto');
  return r.data;
}

/* ============ LA RESA A SCHERMO ============ */

// Il prezzo del modello riportato dentro la banda degli annunci veri. Non e'
// un ritocco nascosto: quando succede la pagina lo scrive, perche' un numero
// corretto di nascosto e' peggio di uno sbagliato in chiaro.
function sxDentroBanda(valore, u){
  if(valore===null || !u) return { valore, spostato:false };
  if(valore>=u.min && valore<=u.max) return { valore, spostato:false };
  return { valore: Math.min(u.max, Math.max(u.min, valore)), spostato:true };
}

// Il range del modello allargato dell'incertezza della banda: con pochi
// annunci e prezzi sparsi si apre, con tanti annunci vicini resta com'e'.
function sxAllarga(valore, delta, u){
  if(valore===null) return null;
  return sxDentroBanda(Math.round(valore+delta), u).valore;
}

function sxDisegna(){
  const s=lastScan, d=s.verdetto||{}, u=s.mercato.usato, n=s.mercato.nuovo;
  const fiducia=u?sxFiducia(s.mercato):{ livello:'nessuna', numero:false, perche:'nessun annuncio dell\'usato trovato' };
  const margine=sxMargine(u);

  const grezzo=num(d.prezzoConsigliato,null,0,100000);
  const corretto=sxDentroBanda(grezzo,u);
  // Sotto la soglia di fiducia il numero singolo non si dice proprio: resta la
  // banda, e scritto perche'. A volte non e' la risposta che si voleva, ma e'
  // la risposta che si ha.
  const prezzo=fiducia.numero?corretto.valore:null;
  const veloce=fiducia.numero?sxAllarga(sxDentroBanda(num(d.prezzoVeloce,null,0,100000),u).valore,-margine,u):null;
  const paziente=fiducia.numero?sxAllarga(sxDentroBanda(num(d.prezzoPaziente,null,0,100000),u).valore,margine,u):null;

  const identita=[
    ['Capo', s.identita.tipo], ['Marca', s.identita.marca], ['Modello', s.identita.modello],
    ['Materiale', s.identita.materiale], ['Taglia', s.identita.taglia], ['Colore', s.identita.colore],
    ['Condizione', s.identita.condizione], ['Epoca', s.identita.epoca], ['Difetti', s.identita.difetti]
  ].filter(r=>r[1]);

  const fonti={ etichetta:'letto sull\'etichetta', foto:'visto in foto', lente:'riconosciuto da Lens', tu:'detto da te' };
  let html='<div class="rl" style="margin-top:0">🧾 Identità del capo</div>'
    + identita.map(r=>`<div class="sxr"><span class="sxk">${esc(r[0])}</span>`
      + `<span class="sxv">${esc(r[1].v)}</span>`
      + `<span class="sxf${r[1].f==='etichetta'?' letta':''}">${esc(fonti[r[1].f]||r[1].f)}</span></div>`).join('');

  if(u){
    html+=`<div class="rl" style="margin-top:20px">💶 Il prezzo</div>`
      + (fiducia.numero
        ? `<div class="ph"><span class="pn">${prezzo!==null?prezzo+'€':'—'}</span>`
          + `<span class="pr">${veloce!==null&&paziente!==null?`veloce ${veloce}€ · paziente ${paziente}€`:''}</span></div>`
        : `<div class="ph"><span class="pn">${u.q1}–${u.q3}€</span><span class="pr">nessun numero singolo</span></div>`)
      + sxBanda(u, prezzo)
      + `<div class="agm">`
      + sxValore(u.mediana+'€', `Mediana di ${u.n} annunci usati`)
      + sxValore(`${u.q1}–${u.q3}€`, 'Dove sta metà del mercato')
      + (n?sxValore(n.mediana+'€', `Nuovo in negozio${s.mercato.tenuta?` · l'usato ne vale il ${s.mercato.tenuta}%`:''}`):'')
      + sxValore(fiducia.livello, 'Fiducia')
      + `</div>`
      + `<div class="hSub" style="margin-bottom:6px">Fiducia ${esc(fiducia.livello)}: ${esc(fiducia.perche)}.</div>`
      + `<div class="hSub" style="margin-bottom:12px">${esc(sxComposizione(u))}${fiducia.numero&&margine>0?` Il range tiene conto dell'incertezza: ±${margine}€.`:''}</div>`;
    if(!fiducia.numero){
      html+=`<div class="tip">⚠️ Non dico un prezzo solo: ${esc(fiducia.perche)}. Una cifra precisa qui sembrerebbe una misura senza esserlo. Quello che si può dire è che metà del mercato sta fra ${u.q1}€ e ${u.q3}€.</div>`;
    }
    if(fiducia.numero && corretto.spostato){
      html+=`<div class="tip">⚠️ Il prezzo proposto dal modello era ${grezzo}€, fuori dai prezzi trovati: l'ho riportato dentro la banda degli annunci veri (${u.min}–${u.max}€).</div>`;
    }
    if(!u.venduti){
      html+=`<div class="hSub" style="margin:10px 0">Nessuno di questi è un prezzo di venduto: sono richieste di annunci ancora online, e gli invenduti restano mentre i venduti spariscono. La banda pende un po' verso l'alto.</div>`;
    }
    if(u.scartati.length){
      html+=`<div class="hSub" style="margin:10px 0">Scartati come fuori scala: ${u.scartati.map(x=>x+'€').join(', ')}.</div>`;
    }
    // Come sono andati davvero i capi di chi sta usando l'app: e' l'unico dato
    // che nessun modello ha, e vale piu' di qualunque mediana di annunci.
    const cal=calibrazioneStorico();
    if(cal){
      const base=prezzo!==null?prezzo:u.mediana;
      const atteso=Math.round(base*(1+cal.scarto/100));
      html+=`<div class="tip">📉 I tuoi ultimi ${cal.n} capi venduti sono andati `
        + (cal.scarto<0?`il ${-cal.scarto}% sotto`:cal.scarto>0?`il ${cal.scarto}% sopra`:'esattamente')
        + ` il prezzo suggerito${cal.giorni!==null?`, in ${cal.giorni} giorni`:''}. Con lo stesso scarto questo capo andrebbe a ${atteso}€.</div>`;
    }
  }else{
    html+=`<div class="tip">⚠️ Non ho trovato nessun annuncio dell'usato con un prezzo leggibile, quindi non dico un numero: sarebbe inventato. `
      + esc(s.erroreRicerca ? s.erroreRicerca.message : 'Riprova col nome del modello, o aggiungi la foto dell\'etichetta.')+`</div>`;
  }

  if(d.lettura) html+=`<p style="font-size:14px;line-height:1.7;color:#fff;margin:14px 0 12px">${esc(d.lettura)}</p>`;
  const perche=Array.isArray(d.perche)?d.perche:[];
  if(perche.length){
    html+=`<ul style="list-style:none;margin-bottom:6px">${perche.map((o,i)=>`<li class="fli" style="--i:${i}"><span class="fdot"></span>${esc(o)}</li>`).join('')}</ul>`;
  }
  (Array.isArray(d.rischi)?d.rischi:[]).forEach(r=>{ html+=`<div class="tip">⚠️ ${esc(r)}</div>`; });
  (Array.isArray(d.consigli)?d.consigli:[]).forEach(c=>{ html+=`<div class="tip">💡 ${esc(c)}</div>`; });

  if(s.motivoStop) html+=`<div class="hSub" style="margin-top:14px">Mi sono fermato qui perché ${esc(s.motivoStop)}.</div>`;

  const etichette={ usato:'annuncio usato', nuovo:'negozio, prezzo del nuovo', incerto:'mercato non chiaro' };
  const scartati=(u && u.scartati) ? u.scartati : [];
  const marca=r=>{
    if(!r.pertinente) return { classe:'fuori', testo:'parla di un altro capo' };
    if(r.prezzo && r.mercato==='usato' && scartati.includes(r.prezzo.valore)){
      return { classe:'fuori', testo:'prezzo fuori scala, non conta' };
    }
    return { classe:r.mercato==='usato'?'usato':'', testo:etichette[r.mercato]||r.mercato };
  };
  html+=`<div class="rl" style="margin:20px 0 0">🔗 Su cosa si basa</div>`
    + s.prove.map((r,k)=>`
      <div class="lr${marca(r).classe==='fuori'?' fuori':''}" style="--i:${k}">
        <div class="lrn" aria-hidden="true">${k+1}</div>
        <div style="flex:1;min-width:0">
          <div class="lrt">${r.link?`<a href="${esc(r.link)}" target="_blank" rel="noopener noreferrer" style="color:inherit">${esc(r.titolo)}</a>`:esc(r.titolo)}</div>
          <div class="lrs">${esc(r.fonte)}</div>
          <span class="sxT ${marca(r).classe}">${esc(marca(r).testo)}</span>
        </div>
        ${r.prezzo?`<div class="lrp">${r.prezzo.valore}${esc(r.prezzo.valuta)}</div>`:''}
      </div>`).join('');

  document.getElementById('rSxBody').innerHTML=html;

  lastScan.prezzo=prezzo; lastScan.veloce=veloce; lastScan.paziente=paziente; lastScan.fiducia=fiducia;

  upsertHistoryItem(itemIdFor(sxNomeCapo(), sxVal(s.identita.marca)), {
    nome: sxNomeCapo(), marca: sxVal(s.identita.marca),
    taglia: sxVal(s.identita.taglia), condizione: sxVal(s.identita.condizione),
    prezzoSuggerito: prezzo === null ? undefined : prezzo,
    // Senza un numero singolo resta comunque la banda: e' quella che poi si
    // confronta con quanto il capo ha davvero venduto.
    rangeMin: veloce !== null ? veloce : (u ? u.q1 : undefined),
    rangeMax: paziente !== null ? paziente : (u ? u.q3 : undefined),
    fiducia: fiducia.livello,
    consiglio: (Array.isArray(d.consigli) && d.consigli[0]) || undefined,
    foto: lastThumbnail || undefined
  });

  sxTesto=[
    sxDescrizioneBreve(s.identita),
    prezzo!==null?`Prezzo consigliato: ${prezzo}€${veloce!==null&&paziente!==null?` (veloce ${veloce}€, paziente ${paziente}€)`:''}`
      :(u?`Nessun prezzo singolo: metà del mercato sta fra ${u.q1}€ e ${u.q3}€`:''),
    u?`Mediana di ${u.n} annunci usati: ${u.mediana}€, metà del mercato fra ${u.q1}€ e ${u.q3}€`:'',
    u?sxComposizione(u):'',
    n?`Nuovo in negozio: ${n.mediana}€`:'',
    `Fiducia ${fiducia.livello}: ${fiducia.perche}`,
    d.lettura||'',
    perche.length?'\n'+perche.map(o=>'- '+o).join('\n'):''
  ].filter(Boolean).join('\n').trim();
}

function sxValore(numero, etichetta){
  return `<div class="agv"><div class="agvn">${esc(String(numero))}</div><div class="agvl">${esc(etichetta)}</div></div>`;
}

// La banda: il tratto va dal minimo al massimo degli annunci usati, il pieno
// e' il quartile centrale, il segno e' il prezzo scelto.
function sxBanda(u, prezzo){
  const larghezza=Math.max(1, u.max-u.min);
  const pos=x=>Math.max(0, Math.min(100, (x-u.min)/larghezza*100));
  const a=pos(u.q1), b=pos(u.q3);
  return `<div class="sxBand" role="img" aria-label="Gli annunci usati vanno da ${u.min} a ${u.max} euro, metà stanno fra ${u.q1} e ${u.q3}${prezzo!==null?`, prezzo scelto ${prezzo}`:''}">`
    + `<div class="sxTrack"></div>`
    + `<div class="sxIqr" style="left:${a}%;width:${Math.max(2,b-a)}%"></div>`
    + (prezzo!==null?`<div class="sxMark" style="left:calc(${pos(prezzo)}% - 1px)"></div>`:'')
    + `</div><div class="sxEnds"><span>${u.min}€</span><span>${u.max}€</span></div>`;
}

function sxNomeCapo(){
  const id=lastScan?lastScan.identita:{};
  return sxVal(id.modello) || sxVal(id.tipo) || 'Capo scansionato';
}

function copiaScanner(btn){ copyText(sxTesto).then(ok=>{ if(ok) confermaBottone(btn); }); }

// Lo scanner ha gia' letto tutto quello che l'annuncio chiede: passare di la'
// non deve voler dire riscriverlo a mano.
function scannerPerAnnuncio(){
  if(!lastScan) return;
  const id=lastScan.identita;
  const set=(campo,valore)=>{ const el=document.getElementById(campo); if(el && valore) el.value=String(valore).slice(0,80); };
  set('aNome', sxVal(id.tipo)); set('aMarca', sxVal(id.marca));
  set('aTaglia', sxVal(id.taglia)); set('aColore', sxVal(id.colore));
  set('aMat', sxVal(id.materiale));
  document.getElementById('aNote').value=[sxVal(id.difetti), sxVal(id.tuo)].filter(Boolean).join('. ').slice(0,300);
  applyCondizione('aCond', sxVal(id.condizione));
  if(!sw('annuncio')) return;
  toast('✍️ Dati passati all\'annuncio');
}

function scannerPerPrezzo(){
  if(!lastScan) return;
  const id=lastScan.identita;
  if(!v('pNome')) document.getElementById('pNome').value=sxNomeCapo().slice(0,80);
  if(sxVal(id.marca) && !v('pMarca')) document.getElementById('pMarca').value=sxVal(id.marca).slice(0,80);
  if(sxVal(id.tipo) && !v('pCat')) document.getElementById('pCat').value=sxVal(id.tipo).slice(0,80);
  applyCondizione('pCond', sxVal(id.condizione));
  if(!sw('prezzo')) return;
  toast('💶 Scansione agganciata alla stima');
}


/* ===== STORICO (localStorage, solo su questo device) ===== */
const HISTORY_KEY = 'vintedAiHistory';

function itemIdFor(nome, marca){
  const sig = (nome+'|'+marca).trim().toLowerCase();
  if(currentItemId && lastItemSig === sig) return currentItemId;
  currentItemId = 'item_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);
  lastItemSig = sig;
  return currentItemId;
}

function loadHistory(){
  try{
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  }catch(e){
    return [];
  }
}

// Ogni voce si porta dietro una miniatura in base64: senza un tetto lo storico
// riempie la quota del localStorage e da li' in poi non salva piu' niente.
const MAX_HISTORY = 50;

function saveHistoryArr(arr){
  let list = arr.slice()
    .sort((a,b)=>(b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0))
    .slice(0, MAX_HISTORY);
  try{
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    return true;
  }catch(e){
    // Quota esaurita. Le miniature sono quasi tutto il peso: si buttano quelle
    // delle voci piu' vecchie prima di rinunciare a salvare.
    try{
      list = list.map((item,i)=> i<10 ? item : Object.assign({}, item, {foto:undefined}));
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
      return true;
    }catch(e2){
      toast('⚠️ Storico non salvato (spazio esaurito?)');
      return false;
    }
  }
}

// Un campo che non c'e' non e' un campo da cancellare. Le tre schede scrivono
// sulla stessa voce - l'annuncio il testo, la stima il prezzo, la ricerca il
// rapporto - e ognuna passa undefined per quello che non sa: senza questo
// filtro l'ultima che salvava cancellava il lavoro delle altre.
function soloNoti(patch){
  const out = {};
  for(const chiave of Object.keys(patch)){
    if(patch[chiave] !== undefined) out[chiave] = patch[chiave];
  }
  return out;
}

function upsertHistoryItem(id, patch){
  const arr = loadHistory();
  const dati = soloNoti(patch);
  const idx = arr.findIndex(x=>x.id===id);
  if(idx>=0){
    arr[idx] = Object.assign({}, arr[idx], dati, {id, updatedAt: Date.now()});
  }else{
    arr.unshift(Object.assign({id, createdAt: Date.now(), updatedAt: Date.now()}, dati));
  }
  saveHistoryArr(arr);
}

function deleteHistoryItem(id){
  const arr = loadHistory().filter(x=>x.id!==id);
  saveHistoryArr(arr);
  renderHistory();
  toast('🗑️ Eliminato');
}

function clearHistoryConfirm(){
  if(!loadHistory().length){ toast('Storico già vuoto'); return; }
  if(confirm('Cancellare tutto lo storico salvato su questo dispositivo? L\'azione non è reversibile.')){
    saveHistoryArr([]);
    renderHistory();
    toast('🗑️ Storico cancellato');
  }
}

// Lo storico e' l'unica traccia del lavoro fatto e vive solo nel localStorage
// di questo browser: basta un "cancella dati del sito" e mesi di annunci, stime
// e consigli spariscono senza che da nessuna parte ne esista una copia. Questo
// e' il modo di portarli via. Le voci escono intere, miniatura compresa: e'
// dalla foto che l'utente riconosce di quale capo si trattava.
function esportaStorico(){
  const voci = loadHistory();
  if(!voci.length){ toast('Storico vuoto: non c’è niente da esportare'); return; }
  const ora = new Date();
  const due = n => String(n).padStart(2, '0');
  // Nel nome ci va anche l'ora, per due motivi. La sola data farebbe finire due
  // esportazioni dello stesso giorno sullo stesso nome, e nella cartella dei
  // download resterebbe solo l'ultima. E l'ora e' quella locale, la stessa che
  // fmtDate mostra sotto ogni voce: con toISOString un export fatto in Italia
  // dopo mezzanotte usciva col nome del giorno prima, e chi cerca "quello di
  // stasera" non lo riconosce piu'.
  const quando = ora.getFullYear() + '-' + due(ora.getMonth()+1) + '-' + due(ora.getDate()) +
                 '_' + due(ora.getHours()) + '-' + due(ora.getMinutes()) + '-' + due(ora.getSeconds());
  // Il numero di formato serve a chi un giorno rileggera' questo file: senza,
  // un export di oggi e uno scritto dopo un cambio di forma delle voci sono
  // indistinguibili, e chi lo rilegge deve indovinare cosa ha in mano.
  const pacco = { formato: 1, esportatoIl: ora.toISOString(), voci: voci };
  const url = URL.createObjectURL(new Blob([JSON.stringify(pacco, null, 2)], {type:'application/json'}));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'storico-alba-' + quando + '.json';
  // Un anchor che non sta nel documento non fa partire il download su tutti i
  // browser: va attaccato, cliccato e tolto.
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revocare l'URL subito dopo il click taglia il download a meta': il browser
  // legge il blob quando la scrittura parte davvero, e con "chiedi sempre dove
  // salvare" attivo quel momento arriva solo dopo che l'utente ha scelto la
  // cartella. Con cinquanta voci e le loro miniature il blob pesa qualche mega,
  // quindi non e' roba che il browser si porta via in un attimo: due minuti
  // sono piu' di quanto serva a chiunque per premere Salva.
  setTimeout(()=>URL.revokeObjectURL(url), 120000);
  toast('⬇ Storico esportato: ' + voci.length + (voci.length===1 ? ' voce' : ' voci'));
}

function fmtDate(ts){
  const d = new Date(ts);
  return d.toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit',year:'numeric'}) + ' ' +
         d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
}

// Il modello puo' mettere un oggetto o un numero dove ci aspettavamo testo:
// senza String() qui, .replace lanciava e saltava tutto il rendering.
function esc(s){
  return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// La miniatura la produciamo noi, ma passa dal localStorage: se qualcosa la
// altera deve restare un'immagine, e non poter uscire dall'attributo src.
// E' l'unico campo di una voce che non passa da esc().
function safePhoto(src){
  return typeof src==='string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src) ? src : '';
}

// ===== L'ESITO: com'e' andata davvero =====
// Il prezzo suggerito e' una previsione, e finche' nessuno dice se ha venduto
// - a quanto, e in quanto tempo - resta una previsione che non si e' mai
// misurata con niente. Lo storico tiene gia' una voce per capo: chiederlo
// quando ci si ripassa sopra costa niente, e dopo qualche capo l'app puo' dire
// una cosa che nessun modello sa, perche' e' successa a chi la sta usando.
const CALIBRA_MIN = 3;

function medianaSemplice(valori){
  const o = valori.slice().sort((a,b)=>a-b);
  if(!o.length) return null;
  const m = Math.floor(o.length/2);
  return o.length % 2 ? o[m] : (o[m-1]+o[m])/2;
}

function calibrazioneStorico(){
  const venduti = loadHistory().filter(x => x.esito && x.esito.venduto
    && typeof x.esito.prezzo === 'number'
    && typeof x.prezzoSuggerito === 'number' && x.prezzoSuggerito > 0);
  if(venduti.length < CALIBRA_MIN) return null;
  const giorni = venduti.map(x => x.esito.giorni).filter(g => typeof g === 'number');
  return {
    n: venduti.length,
    // Negativo = venduto sotto il suggerito, che e' il caso normale.
    scarto: Math.round(medianaSemplice(venduti.map(x => (x.esito.prezzo - x.prezzoSuggerito) / x.prezzoSuggerito * 100))),
    giorni: giorni.length ? Math.round(medianaSemplice(giorni)) : null
  };
}

function esitoChiedi(id){
  const box = document.getElementById('es_' + id);
  if(!box) return;
  box.hidden = false;
  const campo = document.getElementById('esP_' + id);
  if(campo) campo.focus();
}

function esitoNonVenduto(id){
  upsertHistoryItem(id, { esito: { venduto:false, il: Date.now() } });
  renderHistory();
}

function esitoSalva(id){
  const prezzo = num(document.getElementById('esP_' + id) && document.getElementById('esP_' + id).value, null, 1, 100000);
  const giorni = num(document.getElementById('esG_' + id) && document.getElementById('esG_' + id).value, null, 0, 3650);
  if(prezzo === null){ toast('A quanto è venduto?'); return; }
  upsertHistoryItem(id, { esito: { venduto:true, prezzo, giorni: giorni === null ? undefined : giorni, il: Date.now() } });
  renderHistory();
  const cal = calibrazioneStorico();
  toast(cal ? `✅ Segnato. I tuoi capi vendono in media ${cal.scarto<0?`il ${-cal.scarto}% sotto`:cal.scarto>0?`il ${cal.scarto}% sopra`:'esattamente'} il suggerito`
            : '✅ Segnato: com\'è andata davvero');
}

function esitoRiapri(id){
  upsertHistoryItem(id, { esito: null });
  renderHistory();
}

// La domanda, o la risposta che era gia' stata data. Si mostra solo dove c'e'
// un prezzo suggerito da confrontare: senza, non ci sarebbe niente da imparare.
function esitoHtml(item){
  const id = esc(item.id);
  if(typeof item.prezzoSuggerito !== 'number') return '';
  const e = item.esito;
  if(e && e.venduto){
    const scarto = Math.round((e.prezzo - item.prezzoSuggerito) / item.prezzoSuggerito * 100);
    return `<div class="hEs">✅ Venduto a ${e.prezzo}€${typeof e.giorni === 'number' ? ` in ${e.giorni} ${e.giorni === 1 ? 'giorno' : 'giorni'}` : ''}`
      + (scarto ? ` · ${Math.abs(scarto)}% ${scarto < 0 ? 'sotto' : 'sopra'} il suggerito` : ' · esattamente il suggerito')
      + ` <button class="hb" data-az="esitoRiapri" data-arg="${id}">correggi</button></div>`;
  }
  if(e){
    return `<div class="hEs">⏳ Non ancora venduto <button class="hb" data-az="esitoChiedi" data-arg="${id}">è venduto</button>${esitoForm(id)}</div>`;
  }
  return `<div class="hEs">Venduto? <button class="hb" data-az="esitoChiedi" data-arg="${id}">sì</button>`
    + `<button class="hb" data-az="esitoNonVenduto" data-arg="${id}">non ancora</button>${esitoForm(id)}</div>`;
}

function esitoForm(id){
  return `<div class="hEsF" id="es_${id}" hidden>
      <input class="fc hEsIn" id="esP_${id}" type="number" inputmode="decimal" min="1" placeholder="a quanto? €" aria-label="Prezzo a cui è stato venduto"/>
      <input class="fc hEsIn" id="esG_${id}" type="number" inputmode="numeric" min="0" placeholder="in quanti giorni?" aria-label="Giorni per venderlo"/>
      <button class="hb" data-az="esitoSalva" data-arg="${id}">salva</button>
    </div>`;
}

function renderHistory(){
  const arr = loadHistory().sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  const list = document.getElementById('historyList');
  document.getElementById('historyEmpty').style.display = arr.length ? 'none' : '';
  renderCalibrazione();
  list.innerHTML = arr.map(item => {
    const foto = safePhoto(item.foto);
    return `
    <div class="hItem">
      <div class="hTop">
        ${foto ? `<img src="${foto}" alt="" style="width:52px;height:52px;border-radius:8px;object-fit:cover;border:1px solid var(--bd);flex-shrink:0"/>` : ''}
        <div style="flex:1">
          <div class="hName">${esc(item.nome)||'Capo senza nome'}${item.marca?' · '+esc(item.marca):''}</div>
          <div class="hSub">${esc(item.condizione)||''}${item.taglia?' · Taglia '+esc(item.taglia):''}</div>
        </div>
        <button class="hDel" data-id="${esc(item.id)}" title="Elimina" aria-label="Elimina ${esc(item.nome)||'voce'}">×</button>
      </div>
      ${item.titolo ? `<div class="hTitolo">${esc(item.titolo)}</div>` : ''}
      ${item.descrizione ? `<div class="hDesc">${esc(item.descrizione)}</div>` : ''}
      ${item.hashtag ? `<div class="hDesc" style="color:var(--t)">${esc(item.hashtag)}</div>` : ''}
      ${typeof item.prezzoSuggerito==='number' ? `<div class="hPrice">${item.prezzoSuggerito}€ <span style="font-size:12px;color:var(--mu);font-family:'Rajdhani',sans-serif">(range ${item.rangeMin}€–${item.rangeMax}€)</span></div>` : ''}
      ${item.consiglio ? `<div class="hSub" style="margin-top:6px">💡 ${esc(item.consiglio)}</div>` : ''}
      ${esitoHtml(item)}
      <div class="hDate">${fmtDate(item.updatedAt||item.createdAt)}</div>
    </div>
  `;}).join('');
}

// Quello che i capi di chi usa l'app hanno fatto davvero, in una riga. Non e'
// una statistica per far numero: e' il solo dato di verita' che questa app
// possa avere, e serve a leggere ogni prezzo suggerito da qui in avanti.
function renderCalibrazione(){
  const box = document.getElementById('calibra');
  if(!box) return;
  const cal = calibrazioneStorico();
  if(!cal){ box.style.display = 'none'; box.textContent = ''; return; }
  box.style.display = '';
  box.textContent = `📉 Su ${cal.n} capi venduti: vanno via `
    + (cal.scarto < 0 ? `in media il ${-cal.scarto}% sotto` : cal.scarto > 0 ? `in media il ${cal.scarto}% sopra` : 'esattamente a')
    + ' il prezzo suggerito'
    + (cal.giorni !== null ? `, in ${cal.giorni} ${cal.giorni === 1 ? 'giorno' : 'giorni'}` : '') + '.';
}

// La pagina si apre sul sole: la classe la mette sw(), ma al primo giro sw()
// non e' ancora passata di qui.
document.body.classList.add('home');

// Un solo listener sulla lista invece di un onclick costruito per ogni riga.
document.getElementById('historyList').addEventListener('click', e => {
  const btn = e.target.closest('.hDel');
  if(btn) deleteHistoryItem(btn.dataset.id);
});


// ===== I BOTTONI =====
// Un onclick nel markup e' codice inline esattamente come lo <script> che
// stava qui: la stessa riga di CSP che vieta l'uno vieta l'altro, e toglierne
// solo meta' non avrebbe fatto guadagnare niente. Quindi un ascoltatore solo,
// delegato: il nome dell'azione sta in data-az, l'eventuale argomento in
// data-arg. Delegato e non un addEventListener per bottone perche' meta' di
// questi bottoni non esistono al caricamento - le anteprime delle foto e le
// righe dei risultati nascono dopo, e un giro di listener andrebbe rifatto a
// ogni render.
// Due cose che sembrano cerimonia e non lo sono, prima che qualcuno le tolga.
//
// Le voci sono scritte a mano invece di risolvere el.dataset.az su window: da
// un data-az arriverebbe qualunque nome globale, e in questa pagina finisce
// nel DOM anche testo che viene dal modello e da SerpApi. Questo elenco e' la
// lista di cio' che un attributo puo' far partire.
//
// E ogni voce e' una arrow, non la funzione stessa: il dispatcher chiama
// azione(elemento, argomento), e passare quei due parametri a una funzione con
// parametri opzionali le cambia il senso - toRicerca(ipotesi) si ritroverebbe
// un elemento DOM al posto dell'ipotesi.
const AZIONI = {
  analyzePhoto:        () => analyzePhoto(),
  identificaProdotto:  () => identificaProdotto(),
  toRicerca:           () => toRicerca(),
  toRicercaLens:       () => toRicerca(lastLens && lastLens.ipotesi),
  toAnnuncio:          () => toAnnuncio(),
  genAnnuncio:         () => genAnnuncio(),
  shareAnnuncio:       () => shareAnnuncio(),
  openVinted:          () => openVinted(),
  stimaPrezzo:         () => stimaPrezzo(),
  avviaAgente:         () => avviaAgente(),
  usaRicercaPerPrezzo: () => usaRicercaPerPrezzo(),
  usaLensPerPrezzo:    () => usaLensPerPrezzo(),
  esportaStorico:      () => esportaStorico(),
  esitoChiedi:         (el, arg) => esitoChiedi(arg),
  esitoNonVenduto:     (el, arg) => esitoNonVenduto(arg),
  esitoSalva:          (el, arg) => esitoSalva(arg),
  esitoRiapri:         (el, arg) => esitoRiapri(arg),
  clearHistoryConfirm: () => clearHistoryConfirm(),
  avviaScanner:        () => avviaScanner(),
  scannerPerAnnuncio:  () => scannerPerAnnuncio(),
  scannerPerPrezzo:    () => scannerPerPrezzo(),
  // Queste tre volevano this: chi copia deve sapere quale bottone dire "fatto".
  cpField:             (el, arg) => cpField(arg, el),
  copiaRicerca:        (el) => copiaRicerca(el),
  copiaScanner:        (el) => copiaScanner(el),
  // E queste due un numero, che da un attributo torna indietro come stringa.
  delFile:             (el, arg) => delFile(Number(arg)),
  segnaEtichetta:      (el, arg) => segnaEtichetta(Number(arg))
};

document.addEventListener('click', e => {
  // closest e non e.target: si preme l'emoji dentro il bottone almeno quanto
  // il bottone.
  const el = e.target.closest && e.target.closest('[data-az]');
  if(!el) return;
  const azione = AZIONI[el.dataset.az];
  if(azione) azione(el, el.dataset.arg);
});
