const L = require('./lib');
const { chromium } = require('playwright-core');
let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${e !== undefined ? ' -> ' + JSON.stringify(e) : ''}`); } };

// Lo scanner gira nella pagina, come l'altro agente: qui si guarda proprio
// quello, con i tre endpoint sostituiti da stub. Quello che conta e' che
// separi gli annunci dell'usato dai listini dei negozi, perche' e' la cosa
// che l'agente della scheda Ricerca non fa.
const USATO = (titolo, prezzo, fonte) => ({
  titolo, fonte: fonte || 'Vinted', link: 'https://www.vinted.it/items/' + encodeURIComponent(titolo),
  snippet: 'annuncio di prova', prezzo: prezzo ? { valore: prezzo, valuta: '€' } : null
});
const NEGOZIO = (titolo, prezzo) => ({
  titolo, fonte: 'Zalando', link: 'https://www.zalando.it/' + encodeURIComponent(titolo),
  snippet: 'spedizione gratuita', prezzo: prezzo ? { valore: prezzo, valuta: '€' } : null
});

(async () => {
  const server = await L.serviSito(8893);
  const browser = await chromium.launch({ executablePath: L.chromium(), args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  let aiPost = [], ricPost = [], lensPost = [];
  let analisi = {
    tipo: 'Felpa hoodie', brand: 'Non identificato', colore: 'nero', materiale: 'cotone',
    condizione: 'Ottimo', taglie: 'M', stile: 'streetwear', note: 'lieve pilling ai polsini',
    vintageStima: 'Non vintage', vintageConfidenza: 'bassa'
  };
  let etichetta = { marca: 'Carhartt', composizione: '80% cotone 20% poliestere', taglia: 'L', testoLetto: 'CARHARTT WIP', leggibilita: 'alta' };
  let lens = { ipotesi: 'Carhartt WIP Hooded Chase Sweat', risultati: [{ titolo: 'Chase Sweat', fonte: 'Zalando', link: 'https://zalando.it/x', prezzo: { valore: 89, valuta: '€' } }], prezzi: { n: 1, min: 89, max: 89, mediana: 89 } };
  let verdetto = {
    lettura: 'Gli annunci dell\'usato stanno fra 30 e 55 euro (1)(2).',
    prezzoConsigliato: 42, prezzoVeloce: 34, prezzoPaziente: 52,
    perche: ['Il listino del nuovo (5) resta molto sopra'], rischi: ['La taglia L vende piu\' lenta'],
    consigli: ['Metti la foto dell\'etichetta interna']
  };
  let analisiJson = true, verdettoJson = true, ragionaAdAltaVoce = false;
  // Come risponde davvero un modello della famiglia Qwen3: il ragionamento
  // davanti, poi il JSON, spesso dentro i backtick.
  const comeRisponde = (oggetto) => ragionaAdAltaVoce
    ? '<think>Guardo le foto. La felpa sembra Carhartt, controllo l\'etichetta.</think>\n```json\n' + JSON.stringify(oggetto) + '\n```'
    : JSON.stringify(oggetto);
  let lensStatus = 200, lensErrore = 'Ricerca per immagine non configurata';
  let ricercaStatus = 200, ricercaErrore = 'Ricerca online non disponibile al momento. Riprova tra poco.';
  // Il caso normale: sei annunci Vinted e due schede di negozio. Le mediane
  // sono diverse apposta, cosi' si vede quale delle due finisce a schermo.
  let risultatiPer = () => [
    USATO('Felpa Carhartt WIP nera', 30), USATO('Hoodie Carhartt taglia L', 35),
    USATO('Carhartt WIP Chase Sweat', 40), USATO('Felpa Carhartt usata', 45),
    USATO('Carhartt hoodie nero M', 50), USATO('Felpa Carhartt WIP L', 55),
    NEGOZIO('Carhartt WIP Chase Sweat nuovo', 89), NEGOZIO('Carhartt hoodie collezione', 95)
  ];
  let correlate = ['carhartt chase sweat prezzo'];

  const tipoPrompt = (b) => {
    if (b.type === 'image' && /Trascrivi ESATTAMENTE/.test(b.prompt)) return 'etichetta';
    if (b.type === 'image') return 'analisi';
    if (/Sei un agente che deve scoprire a quanto si vende DAVVERO/.test(b.prompt)) return 'piano';
    if (/PREZZI DEGLI ANNUNCI DELL'USATO/.test(b.prompt)) return 'verdetto';
    if (/Scrivi al massimo 3 ricerche/.test(b.prompt)) return 'pianoAgente';
    return 'altro';
  };
  const primo = (tipo) => aiPost.find(b => tipoPrompt(b) === tipo);
  const tutti = (tipo) => aiPost.filter(b => tipoPrompt(b) === tipo);

  await page.route('**/.netlify/functions/claude', async route => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 't.t', expiresIn: 900000 }) });
    const b = JSON.parse(req.postData());
    aiPost.push(b);
    let risposta;
    switch (tipoPrompt(b)) {
      case 'analisi': risposta = analisiJson ? comeRisponde(analisi) : 'non e json'; break;
      case 'etichetta': risposta = comeRisponde(etichetta); break;
      case 'piano': risposta = JSON.stringify({ queries: [{ q: 'carhartt chase sweat usato vinted', tipo: 'web' }] }); break;
      case 'verdetto': risposta = verdettoJson ? JSON.stringify(verdetto) : 'nemmeno questo e json'; break;
      default: risposta = JSON.stringify({ prezzoSuggerito: 40, rangeMin: 30, rangeMax: 50, percentuale: 50, motivazione: 'ok', fattori: [], consiglio: 'ok' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: risposta, model: 'modello-finto', provider: 'groq' }) });
  });
  await page.route('**/.netlify/functions/lens', async route => {
    lensPost.push(JSON.parse(route.request().postData()));
    if (lensStatus !== 200) return route.fulfill({ status: lensStatus, contentType: 'application/json', body: JSON.stringify({ error: lensErrore }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(lens) });
  });
  await page.route('**/.netlify/functions/ricerca', async route => {
    const b = JSON.parse(route.request().postData());
    ricPost.push(b);
    if (ricercaStatus !== 200) return route.fulfill({ status: ricercaStatus, contentType: 'application/json', body: JSON.stringify({ error: ricercaErrore }) });
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ query: b.query, tipo: b.tipo, risultati: risultatiPer(b), correlate, prezzi: null })
    });
  });

  await page.goto('http://127.0.0.1:8893/', { waitUntil: 'load' });
  const reset = () => { aiPost = []; ricPost = []; lensPost = []; };
  const attendiFine = () => page.waitForFunction(() => !document.getElementById('btnSx').disabled, null, { timeout: 40000 });
  const attendiRapporto = () => page.waitForSelector('#rSx:not([style*="display: none"])', { timeout: 40000 });

  const jpeg = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 400;
    const x = c.getContext('2d'); x.fillStyle = '#777'; x.fillRect(0, 0, 400, 400);
    return c.toDataURL('image/jpeg', 0.8);
  });
  const mettiFoto = (sel) => page.setInputFiles(sel, [{ name: 'capo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg.split(',')[1], 'base64') }]);

  console.log('\n-- il raggio e la scheda --');
  check('il sole ha un raggio per lo scanner', await page.evaluate(() => !!document.querySelector('.raggio[data-scheda="scanner"]')));
  await page.click('.raggio[data-scheda="scanner"] .presa');
  check('il raggio apre la scheda', await page.evaluate(() => document.querySelector('.tp.on').id) === 'tab-scanner', await page.evaluate(() => document.querySelector('.tp.on').id));
  check('senza foto non si parte', await page.evaluate(() => document.getElementById('btnSx').disabled));
  check('parte senza rapporto e senza diario', await page.evaluate(() => document.getElementById('rSx').style.display === 'none' && document.getElementById('sxSteps').style.display === 'none'));

  console.log('\n-- le foto sono le stesse delle due schede --');
  await mettiFoto('#sxFile');
  check('la foto scelta qui accende il bottone', await page.evaluate(() => !document.getElementById('btnSx').disabled));
  check('e si vede anche nell\'anteprima dell\'analisi', await page.evaluate(() => document.querySelectorAll('#ps .pw').length) === 1);
  check('e in quella dello scanner', await page.evaluate(() => document.querySelectorAll('#sxPs .pw').length) === 1);
  await page.evaluate(() => segnaEtichetta(0));
  check('il marcatore etichetta vale per tutte e due', await page.evaluate(() => document.querySelectorAll('.pw.tag').length) === 2);

  console.log('\n-- un giro completo --');
  reset();
  await page.click('#btnSx');
  await attendiRapporto();

  check('guarda le foto per prime', tipoPrompt(aiPost[0]) === 'analisi' || tipoPrompt(aiPost[0]) === 'etichetta', aiPost.map(tipoPrompt));
  check('legge l\'etichetta a parte', !!primo('etichetta'));
  check('chiede a Lens di riconoscere il prodotto', lensPost.length === 1);

  const corpo = await page.textContent('#rSxBody');
  check('la marca la prende dall\'etichetta, non dalla foto', /Carhartt/.test(corpo), corpo.slice(0, 200));
  check('e dice che l\'ha letta li\'', corpo.includes('letto sull\'etichetta'), corpo.slice(0, 400));
  check('il modello riconosciuto arriva da Lens', corpo.includes('Chase Sweat') && corpo.includes('riconosciuto da Lens'));
  check('quello che ha solo visto lo dichiara come visto', corpo.includes('visto in foto'));

  console.log('\n-- usato e nuovo restano due cose diverse --');
  check('la mediana e\' quella dei soli annunci usati', corpo.includes('42.5€') || corpo.includes('42,5€'), (corpo.match(/Mediana[^€]*€/) || [])[0]);
  check('il prezzo dei negozi c\'e\', ma per conto suo', /Nuovo in negozio/.test(corpo), corpo.slice(0, 600));
  check('dice quanto vale l\'usato rispetto al nuovo', /l'usato ne vale il \d+%/.test(corpo), (corpo.match(/l'usato ne vale il \d+%/) || [])[0]);
  const tag = await page.evaluate(() => Array.from(document.querySelectorAll('#rSxBody .sxT')).map(t => t.textContent.trim()));
  check('ogni prova dice da che mercato viene', tag.filter(t => /annuncio usato/.test(t)).length >= 5 && tag.filter(t => /negozio/.test(t)).length >= 2, tag);

  const promptVerdetto = primo('verdetto');
  check('il verdetto riceve i quartili, non una mediana sola', /meta' degli annunci sta fra 36.25€ e 48.75€/.test(promptVerdetto.prompt), (promptVerdetto.prompt.match(/meta' degli annunci.*/) || [])[0]);
  check('il verdetto riceve il prezzo del nuovo come tetto', /PREZZI DEI NEGOZI/.test(promptVerdetto.prompt));
  check('il verdetto vede il mercato di ogni risultato', /\[usato\]/.test(promptVerdetto.prompt) && /\[nuovo\]/.test(promptVerdetto.prompt));
  check('il verdetto riceve l\'identita\' scansionata', /Marca: Carhartt/.test(promptVerdetto.prompt) && /Taglia: L/.test(promptVerdetto.prompt));
  check('il piano riceve l\'identita\' scansionata', /Carhartt/.test(primo('piano').prompt));

  check('il prezzo consigliato finisce a schermo', corpo.includes('42€'), corpo.slice(0, 300));
  // Il modello dice 34 e 52; la banda di sei annunci fra 36.25 e 48.75 porta
  // un'incertezza di ~2.6€, e il range che si mostra si apre di quella.
  check('il veloce e il paziente si aprono dell\'incertezza della banda',
    corpo.includes('31€') && corpo.includes('55€'), (corpo.match(/veloce[^·]*·[^\n]*/) || [])[0]);
  check('e la pagina scrive di quanto', /±2\.6€/.test(corpo), (corpo.match(/±[\d.]+€/) || [])[0]);
  check('la banda dei prezzi si disegna', await page.evaluate(() => !!document.querySelector('#rSxBody .sxIqr') && !!document.querySelector('#rSxBody .sxMark')));
  check('la banda si legge anche senza vederla', /da 30 a 55 euro/.test(await page.evaluate(() => document.querySelector('#rSxBody .sxBand').getAttribute('aria-label'))));
  check('la lettura del mercato finisce a schermo', corpo.includes('Gli annunci dell\'usato stanno fra 30'));
  check('i rischi finiscono a schermo', corpo.includes('vende piu\' lenta'));
  check('le prove hanno il link', await page.evaluate(() => document.querySelectorAll('#rSxBody .lr a').length) >= 5);
  check('i link si aprono in sicurezza', await page.evaluate(() => Array.from(document.querySelectorAll('#rSxBody .lr a')).every(a => a.rel.includes('noopener'))));

  const passi = await page.evaluate(() => Array.from(document.querySelectorAll('#sxList .agp')).map(li => li.textContent.trim()));
  check('il diario racconta la scansione', /Guardo la foto e l'etichetta/.test(passi[0]), passi[0]);
  check('il diario racconta Lens', passi.some(p => /Cerco il prodotto con la foto/.test(p)), passi);
  check('il diario racconta ogni ricerca', passi.some(p => /Cerco:/.test(p)));
  check('il diario si chiude col verdetto', /decido/i.test(passi[passi.length - 1]), passi[passi.length - 1]);

  console.log('\n-- il modello che ragiona ad alta voce --');
  // Com'e' arrivato il guasto sul sito: il modello con visione risponde col
  // suo ragionamento davanti al JSON, e lo scanner si fermava a "analisi non
  // interpretabile" senza dire cosa avesse letto.
  reset();
  const analisiPulita0 = analisi;
  ragionaAdAltaVoce = true;
  await page.click('#btnSx');
  await attendiRapporto();
  check('la scansione va avanti lo stesso', /Carhartt/.test(await page.textContent('#rSxBody')));
  check('e il diario non segnala nessun problema',
    await page.evaluate(() => document.querySelectorAll('#sxList .agp.ko').length) === 0);
  ragionaAdAltaVoce = false;
  analisi = analisiPulita0;

  console.log('\n-- quando invece non c\'e proprio JSON, lo dice --');
  reset();
  analisiJson = false;
  await page.click('#btnSx');
  await attendiFine();
  const diario = await page.textContent('#sxList');
  check('il diario riporta cosa ha risposto il modello',
    /ha detto/.test(diario) && /non e json/.test(diario), diario.slice(0, 300));
  analisiJson = true;

  console.log('\n-- doppio invio --');
  reset();
  await page.evaluate(() => { document.getElementById('btnSx').click(); document.getElementById('btnSx').click(); });
  await attendiFine();
  check('due click = una sola scansione', tutti('analisi').length === 1, aiPost.map(tipoPrompt));

  console.log('\n-- un prezzo fuori scala non sposta la mediana --');
  reset();
  risultatiPer = () => [
    USATO('Felpa Carhartt A', 30), USATO('Felpa Carhartt B', 32), USATO('Felpa Carhartt C', 35),
    USATO('Felpa Carhartt D', 38), USATO('Felpa Carhartt E', 40), USATO('Felpa Carhartt F', 42),
    USATO('Stock 20 felpe Carhartt', 900)
  ];
  await page.click('#btnSx');
  await attendiRapporto();
  const conEstremo = await page.textContent('#rSxBody');
  check('lo scarta e lo dice', /Scartati come fuori scala: 900€/.test(conEstremo), (conEstremo.match(/Scartati[^.]*\./) || [])[0]);
  check('la mediana resta quella degli annunci veri', /Mediana di 6 annunci/.test(conEstremo), (conEstremo.match(/Mediana di \d+ annunci/) || [])[0]);
  check('e il massimo della banda non e\' il lotto', !/900€/.test((conEstremo.match(/\d+€\s*$/m) || [''])[0]));

  console.log('\n-- un risultato che parla di un altro capo non conta --');
  reset();
  risultatiPer = () => [
    USATO('Felpa Carhartt A', 30), USATO('Felpa Carhartt B', 34), USATO('Felpa Carhartt C', 36),
    USATO('Felpa Carhartt D', 40), USATO('Felpa Carhartt E', 44),
    USATO('Bicicletta da corsa Bianchi', 300)
  ];
  await page.click('#btnSx');
  await attendiRapporto();
  const conEstraneo = await page.textContent('#rSxBody');
  check('lo marca come fuori tema', /parla di un altro capo/.test(conEstraneo), conEstraneo.slice(-400));
  check('e lo tiene fuori dai conti', /Mediana di 5 annunci/.test(conEstraneo), (conEstraneo.match(/Mediana di \d+ annunci/) || [])[0]);
  check('il verdetto lo vede marcato', /\[fuori tema\]/.test(primo('verdetto').prompt));

  console.log('\n-- quando il quadro non sta in piedi, cerca ancora --');
  reset();
  let giroRicerca = 0;
  risultatiPer = () => {
    giroRicerca++;
    return giroRicerca <= 3
      ? [USATO('Felpa Carhartt scarsa ' + giroRicerca, 40), NEGOZIO('Carhartt nuovo ' + giroRicerca, 89)]
      : [USATO('Felpa Carhartt tanta A', 30), USATO('Felpa Carhartt tanta B', 34), USATO('Felpa Carhartt tanta C', 36),
         USATO('Felpa Carhartt tanta D', 40), USATO('Felpa Carhartt tanta E', 44)];
  };
  await page.click('#btnSx');
  await attendiFine();
  check('con pochi annunci usati fa un altro giro', ricPost.length > 3, ricPost.length);
  const pianiTardivi = tutti('piano').slice(1);
  check('e il giro nuovo parte da cosa manca', pianiTardivi.some(b => /COSA NON TORNA ANCORA/.test(b.prompt)), pianiTardivi.length);
  check('la lacuna e\' scritta a lettere, non e\' un numero interno', /annunci dell'usato/.test((pianiTardivi[0] || { prompt: '' }).prompt));
  check('il diario dice perche\' non si e\' fermato', (await page.textContent('#sxList')).includes('Non mi basta'), (await page.textContent('#sxList')).slice(0, 300));

  console.log('\n-- il budget di ricerche e\' un tetto vero --');
  reset();
  risultatiPer = () => [USATO('Felpa Carhartt sempre uguale', 40), NEGOZIO('Carhartt nuovo', 89)];
  await page.click('#btnSx');
  await attendiFine();
  check('non spende mai piu\' di sei ricerche', ricPost.length <= 6, ricPost.length);
  check('e non ripete due volte la stessa query', new Set(ricPost.map(r => r.query)).size === ricPost.length, ricPost.map(r => r.query));
  check('quando si ferma dice perche\'', /Mi sono fermato qui perché/.test(await page.textContent('#rSxBody')), (await page.textContent('#rSxBody')).slice(-300));

  console.log('\n-- un numero fuori dai prezzi trovati viene riportato dentro --');
  reset();
  risultatiPer = () => [
    USATO('Felpa Carhartt A', 30), USATO('Felpa Carhartt B', 34), USATO('Felpa Carhartt C', 36),
    USATO('Felpa Carhartt D', 40), USATO('Felpa Carhartt E', 44), USATO('Felpa Carhartt F', 46)
  ];
  const verdettoBuono = verdetto;
  verdetto = Object.assign({}, verdetto, { prezzoConsigliato: 500 });
  await page.click('#btnSx');
  await attendiRapporto();
  const riportato = await page.textContent('#rSxBody');
  check('il prezzo grande non e\' quello del modello', await page.textContent('#rSxBody .pn') !== '500€', await page.textContent('#rSxBody .pn'));
  check('e sta dentro i prezzi trovati', await page.textContent('#rSxBody .pn') === '46€', await page.textContent('#rSxBody .pn'));
  check('lo dice invece di correggere di nascosto', /era 500€, fuori dai prezzi trovati/.test(riportato), (riportato.match(/era 500€[^.]*/) || [])[0]);
  verdetto = verdettoBuono;

  console.log('\n-- la fiducia la calcola il codice, non il modello --');
  reset();
  risultatiPer = () => [USATO('Felpa Carhartt A', 10), USATO('Felpa Carhartt B', 20), USATO('Felpa Carhartt C', 30),
                        USATO('Felpa Carhartt D', 60), USATO('Felpa Carhartt E', 90), USATO('Felpa Carhartt F', 120)];
  await page.click('#btnSx');
  await attendiRapporto();
  check('prezzi sparsi = fiducia bassa', /Fiducia bassa/.test(await page.textContent('#rSxBody')), (await page.textContent('#rSxBody')).match(/Fiducia \w+[^.]*/)[0]);
  reset();
  risultatiPer = () => [USATO('Felpa Carhartt A', 38), USATO('Felpa Carhartt B', 39), USATO('Felpa Carhartt C', 40),
                        USATO('Felpa Carhartt D', 41), USATO('Felpa Carhartt E', 42), USATO('Felpa Carhartt F', 43),
                        USATO('Felpa Carhartt G', 44), USATO('Felpa Carhartt H', 45)];
  await page.click('#btnSx');
  await attendiRapporto();
  check('molti annunci vicini fra loro = fiducia alta', /Fiducia alta/.test(await page.textContent('#rSxBody')), (await page.textContent('#rSxBody')).match(/Fiducia \w+[^.]*/)[0]);

  console.log('\n-- sotto la soglia non esce un numero solo, esce la banda --');
  reset();
  risultatiPer = () => [USATO('Felpa Carhartt A', 10), USATO('Felpa Carhartt B', 20), USATO('Felpa Carhartt C', 30),
                        USATO('Felpa Carhartt D', 60), USATO('Felpa Carhartt E', 90), USATO('Felpa Carhartt F', 120)];
  await page.click('#btnSx');
  await attendiRapporto();
  const incerto = await page.textContent('#rSxBody');
  check('col mercato sparso non stampa una cifra sola',
    /–/.test(await page.textContent('#rSxBody .pn')) && !/^\d+€$/.test(await page.textContent('#rSxBody .pn')),
    await page.textContent('#rSxBody .pn'));
  check('e dice perche\' non la dice', /Non dico un prezzo solo/.test(incerto), incerto.slice(0, 600));
  check('la banda resta, con dentro dove sta meta\' del mercato',
    /Dove sta metà del mercato/.test(incerto) && /[\d.]+–[\d.]+€/.test(await page.textContent('#rSxBody .pn')), incerto.slice(0, 400));
  check('e nello storico non finisce un prezzo che non ha detto',
    await page.evaluate(() => loadHistory().every(x => x.prezzoSuggerito === undefined || typeof x.prezzoSuggerito === 'number')));

  console.log('\n-- un annuncio vecchio non vale come uno di ieri --');
  reset();
  const VECCHIO = (t, p) => Object.assign(USATO(t, p), { eta: { testo: '10 mesi fa', giorni: 300 } });
  const RECENTE = (t, p) => Object.assign(USATO(t, p), { eta: { testo: '5 giorni fa', giorni: 5 } });
  risultatiPer = () => [
    RECENTE('Felpa Carhartt recente A', 40), RECENTE('Felpa Carhartt recente B', 41), RECENTE('Felpa Carhartt recente C', 42),
    VECCHIO('Felpa Carhartt vecchia A', 60), VECCHIO('Felpa Carhartt vecchia B', 61), VECCHIO('Felpa Carhartt vecchia C', 62)
  ];
  await page.click('#btnSx');
  await attendiRapporto();
  const conVecchi = await page.textContent('#rSxBody');
  // Senza pesi la mediana di 40,41,42,60,61,62 sarebbe 51: gli invenduti da
  // dieci mesi la tiravano su da soli.
  check('la mediana pende verso gli annunci ancora caldi', /41\.81€/.test(conVecchi), (conVecchi.match(/Mediana[^€]*€/) || [])[0]);
  check('e la pagina dice quanti pesano meno perche\' vecchi',
    /3 sono annunci più vecchi di tre mesi/.test(conVecchi), (conVecchi.match(/Di \d+ annunci[^.]*\./) || [])[0]);
  check('il verdetto vede l\'eta\' di ogni riga', /10 mesi fa/.test(primo('verdetto').prompt));

  console.log('\n-- la condizione: nella stessa mediana non ci va di tutto --');
  reset();
  risultatiPer = () => [
    USATO('Felpa Carhartt ottime condizioni A', 40), USATO('Felpa Carhartt ottime condizioni B', 41),
    USATO('Felpa Carhartt ottime condizioni C', 42),
    USATO('Felpa Carhartt nuovo con cartellino A', 60), USATO('Felpa Carhartt nuovo con cartellino B', 61),
    USATO('Felpa Carhartt nuovo con cartellino C', 62)
  ];
  await page.click('#btnSx');
  await attendiRapporto();
  const conCondizioni = await page.textContent('#rSxBody');
  check('un "nuovo col cartellino" non pesa come il capo in ottimo stato',
    /41\.81€/.test(conCondizioni), (conCondizioni.match(/Mediana[^€]*€/) || [])[0]);
  check('e dice quanti hanno davvero la stessa condizione',
    /3 hanno la stessa condizione del tuo/.test(conCondizioni), (conCondizioni.match(/Di \d+ annunci[^.]*\./) || [])[0]);
  check('il verdetto legge la condizione riga per riga, col nome della tendina',
    /condizione: nuovo con etichetta/.test(primo('verdetto').prompt),
    (primo('verdetto').prompt.match(/— condizione: [^\n]*/) || [])[0]);

  console.log('\n-- venduto e chiesto non sono lo stesso prezzo --');
  reset();
  risultatiPer = () => [
    USATO('Felpa Carhartt A', 40), USATO('Felpa Carhartt B', 42), USATO('Felpa Carhartt C', 44),
    USATO('Felpa Carhartt D', 46), USATO('Felpa Carhartt E', 48)
  ];
  await page.click('#btnSx');
  await attendiRapporto();
  check('se nessuno e\' un venduto lo dice, e dice da che parte pende la banda',
    /Nessuno di questi è un prezzo di venduto/.test(await page.textContent('#rSxBody')));
  reset();
  const VENDUTO = (t, p) => Object.assign(USATO(t, p, 'eBay'), { titolo: t + ' venduto', link: 'https://www.ebay.it/itm/1' });
  risultatiPer = () => [
    USATO('Felpa Carhartt A', 40), USATO('Felpa Carhartt B', 42), USATO('Felpa Carhartt C', 44),
    USATO('Felpa Carhartt D', 46), VENDUTO('Felpa Carhartt E', 30)
  ];
  await page.click('#btnSx');
  await attendiRapporto();
  const conVenduto = await page.textContent('#rSxBody');
  check('un prezzo di venduto viene contato, e detto', /è un prezzo di venduto/.test(conVenduto), (conVenduto.match(/Di \d+ annunci[^.]*\./) || [])[0]);
  check('il verdetto lo vede marcato', /\[venduto\]/.test(primo('verdetto').prompt), (primo('verdetto').prompt.match(/\d+\. \[[^\]]+\]\s*\[venduto\][^\n]*/) || [])[0]);
  check('e fra le ricerche di riserva ce n\'e una che punta al venduto',
    await page.evaluate(() => sxRiserva({ marca: { v: 'Carhartt', f: 'foto' }, tipo: { v: 'felpa', f: 'foto' } }, []).some(p => /venduto/.test(p.q))));

  console.log('\n-- gli esiti veri arrivano fino alla stima --');
  reset();
  await page.evaluate(() => {
    localStorage.clear();
    upsertHistoryItem('cal_1', { nome: 'A', prezzoSuggerito: 40, esito: { venduto: true, prezzo: 34, giorni: 10 } });
    upsertHistoryItem('cal_2', { nome: 'B', prezzoSuggerito: 50, esito: { venduto: true, prezzo: 40, giorni: 12 } });
    upsertHistoryItem('cal_3', { nome: 'C', prezzoSuggerito: 20, esito: { venduto: true, prezzo: 18, giorni: 20 } });
  });
  risultatiPer = () => [
    USATO('Felpa Carhartt A', 40), USATO('Felpa Carhartt B', 42), USATO('Felpa Carhartt C', 44),
    USATO('Felpa Carhartt D', 46), USATO('Felpa Carhartt E', 48)
  ];
  await page.click('#btnSx');
  await attendiRapporto();
  const conEsiti = await page.textContent('#rSxBody');
  check('il rapporto dice come sono andati davvero i suoi capi', /3 capi venduti sono andati il 15% sotto/.test(conEsiti), (conEsiti.match(/📉[^.]*\./) || [])[0]);
  check('e cosa vorrebbe dire su questo', /andrebbe a \d+€/.test(conEsiti), (conEsiti.match(/andrebbe a \d+€/) || [])[0]);
  await page.evaluate(() => { document.getElementById('pNome').value = ''; document.getElementById('pMarca').value = ''; });
  await page.click('#rSx .cbtn:nth-child(2)');
  await page.click('#btnP');
  await page.waitForSelector('#rPre:not([style*="display: none"])', { timeout: 40000 });
  check('e la stima prezzo li riceve come vendite concluse',
    /ESITI VERI di chi vende/.test(aiPost[aiPost.length - 1].prompt), aiPost[aiPost.length - 1].prompt.slice(-400));
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => sw('scanner'));

  console.log('\n-- testo del modello e di SerpApi: sempre escapato --');
  reset();
  risultatiPer = () => [
    { titolo: '<img src=x onerror="window.__bucato=1">', fonte: '<b>Vinted</b>', link: 'https://vinted.it/x', snippet: 'felpa carhartt', prezzo: { valore: 30, valuta: '€' } },
    USATO('Felpa Carhartt B', 34), USATO('Felpa Carhartt C', 38), USATO('Felpa Carhartt D', 40), USATO('Felpa Carhartt E', 44)
  ];
  const analisiPulita = analisi;
  analisi = Object.assign({}, analisi, { colore: '<img src=x onerror="window.__bucato=2">' });
  verdetto = Object.assign({}, verdetto, { lettura: '<script>window.__bucato=3</script>ok', perche: ['<img src=x onerror="window.__bucato=4">'] });
  await page.click('#btnSx');
  await attendiRapporto();
  check('niente HTML iniettato dal modello o da SerpApi', await page.evaluate(() => !window.__bucato));
  check('il testo ostile si vede come testo', (await page.textContent('#rSxBody')).includes('<img src=x'));
  analisi = analisiPulita;
  verdetto = verdettoBuono;

  console.log('\n-- senza chiave di ricerca resta comunque la scansione --');
  reset();
  ricercaStatus = 501; ricercaErrore = 'Ricerca online non configurata sul server (SERPAPI_KEY)';
  await page.click('#btnSx');
  await attendiRapporto();
  const senzaChiave = await page.textContent('#rSxBody');
  check('l\'identita\' del capo si vede lo stesso', /Carhartt/.test(senzaChiave), senzaChiave.slice(0, 200));
  check('non inventa un prezzo', !/Il prezzo/.test(senzaChiave), senzaChiave.slice(0, 400));
  check('e dice che manca la chiave', /SERPAPI_KEY/.test(senzaChiave), senzaChiave.slice(0, 500));
  check('senza prezzi non chiede nemmeno il verdetto', !primo('verdetto'), aiPost.map(tipoPrompt));
  ricercaStatus = 200;

  console.log('\n-- senza Lens il giro va avanti --');
  reset();
  lensStatus = 501;
  risultatiPer = () => [USATO('Felpa Carhartt A', 30), USATO('Felpa Carhartt B', 34), USATO('Felpa Carhartt C', 38),
                        USATO('Felpa Carhartt D', 40), USATO('Felpa Carhartt E', 44)];
  await page.click('#btnSx');
  await attendiRapporto();
  check('il passo di Lens risulta fallito', await page.evaluate(() => Array.from(document.querySelectorAll('#sxList .agp.ko')).some(li => /Cerco il prodotto/.test(li.textContent))));
  check('ma il prezzo arriva lo stesso', /Il prezzo/.test(await page.textContent('#rSxBody')));
  lensStatus = 200;

  console.log('\n-- quando il modello non collabora --');
  reset();
  verdettoJson = false;
  await page.click('#btnSx');
  await attendiFine();
  check('verdetto illeggibile: errore chiaro, non pagina rotta', /riprova/i.test(await page.textContent('#eSx')), await page.textContent('#eSx'));
  verdettoJson = true;
  reset();
  analisiJson = false;
  await page.click('#btnSx');
  await attendiFine();
  check('analisi illeggibile: si ferma dicendolo', /interpretabile/i.test(await page.textContent('#eSx')), await page.textContent('#eSx'));
  check('e non spreca ricerche', ricPost.length === 0, ricPost.length);
  analisiJson = true;

  console.log('\n-- la scansione alimenta la stima prezzo --');
  reset();
  risultatiPer = () => [
    USATO('Felpa Carhartt A', 30), USATO('Felpa Carhartt B', 34), USATO('Felpa Carhartt C', 38),
    USATO('Felpa Carhartt D', 40), USATO('Felpa Carhartt E', 44),
    NEGOZIO('Carhartt WIP Chase Sweat nuovo', 89), NEGOZIO('Carhartt hoodie nuovo', 95)
  ];
  await page.click('#btnSx');
  await attendiRapporto();
  await page.click('#rSx .cbtn:nth-child(2)');   // "Usa per la stima prezzo"
  check('porta sulla scheda prezzo', await page.evaluate(() => document.getElementById('tab-prezzo').classList.contains('on')));
  check('porta con se il capo e la marca', (await page.inputValue('#pNome')).includes('Chase Sweat') && await page.inputValue('#pMarca') === 'Carhartt',
    { nome: await page.inputValue('#pNome'), marca: await page.inputValue('#pMarca') });
  await page.click('#btnP');
  await page.waitForSelector('#rPre:not([style*="display: none"])', { timeout: 40000 });
  const promptPrezzo = aiPost[aiPost.length - 1].prompt;
  check('la stima riceve gli annunci dell\'usato', /SCANSIONE appena fatta/.test(promptPrezzo), promptPrezzo.slice(-500));
  check('separati dai prezzi di negozio', /prezzi di NEGOZIO/.test(promptPrezzo));
  check('e la conclusione dello scanner', /prezzo concluso dallo scanner/.test(promptPrezzo));

  console.log('\n-- i dati di un capo non finiscono nella stima di un altro --');
  reset();
  await page.fill('#pNome', 'Scarpe running'); await page.fill('#pMarca', 'Asics');
  await page.click('#btnP');
  await page.waitForSelector('#rPre:not([style*="display: none"])', { timeout: 40000 });
  check('capo diverso: la scansione resta fuori dal prompt', !/SCANSIONE appena fatta/.test(aiPost[aiPost.length - 1].prompt));

  console.log('\n-- la scansione alimenta l\'annuncio --');
  reset();
  await page.evaluate(() => sw('scanner'));
  await page.click('#rSx .cbtn:nth-child(1)');   // "Usa per l'annuncio"
  check('porta sulla scheda annuncio', await page.evaluate(() => document.getElementById('tab-annuncio').classList.contains('on')));
  check('con marca, taglia e materiale letti sull\'etichetta',
    await page.inputValue('#aMarca') === 'Carhartt' && await page.inputValue('#aTaglia') === 'L' && /cotone/.test(await page.inputValue('#aMat')),
    { marca: await page.inputValue('#aMarca'), taglia: await page.inputValue('#aTaglia'), mat: await page.inputValue('#aMat') });
  check('e i difetti visti nelle note', /pilling/.test(await page.inputValue('#aNote')), await page.inputValue('#aNote'));

  console.log('\n-- la scansione finisce nello storico --');
  await page.evaluate(() => sw('storico'));
  const storico = await page.textContent('#historyList');
  check('la voce c\'e\', col capo riconosciuto', /Chase Sweat/.test(storico), storico.slice(0, 300));
  check('e col prezzo concluso', /42€/.test(storico), storico.slice(0, 400));

  console.log('\n-- foto nuove, capo nuovo --');
  await page.evaluate(() => sw('scanner'));
  await mettiFoto('#fileInput');
  check('il rapporto vecchio sparisce', await page.evaluate(() => document.getElementById('rSx').style.display === 'none'));
  check('e anche il diario vecchio', await page.evaluate(() => document.getElementById('sxList').children.length === 0));
  reset();
  await page.evaluate(() => sw('prezzo'));
  await page.fill('#pNome', 'Carhartt WIP Hooded Chase Sweat'); await page.fill('#pMarca', 'Carhartt');
  await page.click('#btnP');
  await page.waitForSelector('#rPre:not([style*="display: none"])', { timeout: 40000 });
  check('la scansione del capo di prima non alimenta piu\' la stima', !/SCANSIONE appena fatta/.test(aiPost[aiPost.length - 1].prompt));

  console.log('\n-- errori JS accumulati --');
  check('nessun errore JS in tutta la sessione', errors.length === 0, errors);

  await browser.close();
  server.close();
  console.log(`\n${pass} passati, ${fail} falliti`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
