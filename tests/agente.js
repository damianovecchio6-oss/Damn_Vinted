const L = require('./lib');
const { chromium } = require('playwright-core');
let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${e !== undefined ? ' -> ' + JSON.stringify(e) : ''}`); } };

// Il ciclo dell'agente sta nella pagina, non nella function: qui si guarda
// proprio quello, con i due endpoint sostituiti da stub.
const RISULTATO = (titolo, prezzo, fonte) => ({
  titolo, fonte: fonte || 'Vinted', link: 'https://vinted.it/' + encodeURIComponent(titolo),
  snippet: 'annuncio di prova', prezzo: prezzo ? { valore: prezzo, valuta: '€' } : null
});

(async () => {
  const server = await L.serviSito(8896);
  const browser = await chromium.launch({ executablePath: L.chromium(), args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  let aiPost = [], ricPost = [];
  let piano = { queries: [
    { q: 'felpa carhartt usata vinted', tipo: 'web', perche: 'annunci veri' },
    { q: 'carhartt hoodie prezzo', tipo: 'shopping', perche: 'listino del nuovo' }
  ] };
  let raffinamento = { queries: [{ q: 'carhartt hoodie usato subito', tipo: 'web' }] };
  let rapporto = {
    riassunto: 'Gli annunci partono da 30€ e arrivano a 60€ (1)(3).',
    prezzoConsigliato: 42, rangeMin: 35, rangeMax: 55, fiducia: 'media', domanda: 'alta',
    osservazioni: ['Il prezzo del nuovo (2) resta molto sopra l\'usato'],
    consigli: ['Metti la foto dell\'etichetta interna']
  };
  let pianoJson = true, rapportoJson = true;
  // Titoli diversi per query: l'agente scarta i doppioni, e due ricerche che
  // tornano gli stessi tre annunci valgono tre prove, non sei.
  let risultatiPer = (b) => [RISULTATO('Felpa Carhartt ' + b.query, 45), RISULTATO('Hoodie Carhartt ' + b.query, 30), RISULTATO('Carhartt WIP ' + b.query, 60)];
  let ricercaStatus = 200, ricercaErrore = 'Ricerca online non disponibile al momento. Riprova tra poco.';

  await page.route('**/.netlify/functions/claude', async route => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 't.t', expiresIn: 900000 }) });
    const b = JSON.parse(req.postData());
    aiPost.push(b);
    let risposta;
    if (/Scrivi al massimo 3 ricerche/.test(b.prompt)) risposta = pianoJson ? JSON.stringify(piano) : 'non e json, mi spiace';
    else if (/Scrivi UNA sola ricerca nuova/.test(b.prompt)) risposta = JSON.stringify(raffinamento);
    else if (/RISULTATI TROVATI ONLINE ADESSO/.test(b.prompt)) risposta = rapportoJson ? JSON.stringify(rapporto) : 'nemmeno questo e json';
    else risposta = JSON.stringify({ prezzoSuggerito: 40, rangeMin: 30, rangeMax: 50, percentuale: 50, motivazione: 'ok', fattori: [], consiglio: 'ok' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: risposta, model: 'modello-finto', provider: 'groq' }) });
  });
  await page.route('**/.netlify/functions/ricerca', async route => {
    const b = JSON.parse(route.request().postData());
    ricPost.push(b);
    if (ricercaStatus !== 200) return route.fulfill({ status: ricercaStatus, contentType: 'application/json', body: JSON.stringify({ error: ricercaErrore }) });
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ query: b.query, tipo: b.tipo, risultati: risultatiPer(b), correlate: ['carhartt wip prezzo'], prezzi: null })
    });
  });

  await page.goto('http://127.0.0.1:8896/', { waitUntil: 'load' });
  const reset = () => { aiPost = []; ricPost = []; };
  const compila = async (nome, marca) => {
    await page.fill('#sNome', nome); await page.fill('#sMarca', marca);
  };
  const attendiFine = () => page.waitForFunction(() => !document.getElementById('btnS').disabled, null, { timeout: 30000 });

  console.log('\n-- la scheda esiste ed e\' raggiungibile --');
  await page.click('#nav-ricerca');
  check('la scheda si apre dalla barra in basso', await page.evaluate(() => document.getElementById('tab-ricerca').classList.contains('on')));
  check('parte senza rapporto e senza passi', await page.evaluate(() => document.getElementById('rRic').style.display === 'none' && document.getElementById('agSteps').style.display === 'none'));
  await page.click('#btnS');
  check('senza nome ne marca non parte nessuna ricerca', ricPost.length === 0);

  console.log('\n-- un giro completo --');
  reset();
  await compila('Felpa hoodie', 'Carhartt');
  await page.click('#btnS');
  await page.waitForSelector('#rRic:not([style*="display: none"])', { timeout: 30000 });

  check('prima pianifica, poi cerca', /Scrivi al massimo 3 ricerche/.test(aiPost[0].prompt));
  check('il piano riceve i dati del capo', /Marca: Carhartt/.test(aiPost[0].prompt) && /Capo: Felpa hoodie/.test(aiPost[0].prompt));
  check('esegue tutte le query del piano', ricPost.length === 2, ricPost.map(r => r.query));
  check('le query eseguite sono quelle pianificate', ricPost[0].query === 'felpa carhartt usata vinted' && ricPost[1].query === 'carhartt hoodie prezzo');
  check('il tipo scelto dal piano viene rispettato', ricPost[1].tipo === 'shopping', ricPost[1]);
  check('con abbastanza prezzi non raffina', !aiPost.some(b => /Scrivi UNA sola ricerca nuova/.test(b.prompt)));

  const promptRapporto = aiPost.find(b => /RISULTATI TROVATI ONLINE ADESSO/.test(b.prompt));
  check('il rapporto vede i risultati trovati', /Felpa Carhartt/.test(promptRapporto.prompt) && /Hoodie Carhartt/.test(promptRapporto.prompt));
  check('il rapporto vede la mediana calcolata', /mediana 45€/.test(promptRapporto.prompt), (promptRapporto.prompt.match(/PREZZI LETTI.*/) || [])[0]);
  check('il rapporto chiede JSON', promptRapporto.json === true);

  const corpo = await page.textContent('#rRicBody');
  check('il prezzo consigliato finisce a schermo', corpo.includes('42€'), corpo.slice(0, 120));
  check('il range finisce a schermo', corpo.includes('35–55€'));
  check('la mediana degli annunci finisce a schermo', corpo.includes('45€'));
  check('il riassunto finisce a schermo', corpo.includes('Gli annunci partono da 30'));
  check('le osservazioni finiscono a schermo', corpo.includes('resta molto sopra l\'usato'));
  check('i consigli finiscono a schermo', corpo.includes('foto dell\'etichetta interna'));
  check('le prove sono elencate con il link', await page.evaluate(() => document.querySelectorAll('#rRicBody .lr a').length) >= 3);
  check('i link delle prove si aprono in sicurezza', await page.evaluate(() => Array.from(document.querySelectorAll('#rRicBody .lr a')).every(a => a.rel.includes('noopener'))));

  const passi = await page.evaluate(() => Array.from(document.querySelectorAll('#agList .agp')).map(li => li.textContent.trim()));
  check('il diario mostra la pianificazione', /Pianifico le ricerche/.test(passi[0]), passi[0]);
  check('il diario mostra ogni ricerca fatta', passi.filter(p => /Cerco:/.test(p)).length === 2, passi);
  check('il diario dice quanti prezzi ha trovato', /3 con prezzo/.test(passi[1]), passi[1]);
  check('il diario si chiude col rapporto', /rapporto/i.test(passi[passi.length - 1]), passi[passi.length - 1]);
  check('i passi finiti sono marcati come tali', await page.evaluate(() => document.querySelectorAll('#agList .agp.fatto').length) === passi.length);

  console.log('\n-- doppio invio --');
  reset();
  await page.evaluate(() => { document.getElementById('btnS').click(); document.getElementById('btnS').click(); });
  await attendiFine();
  check('due click = una sola pianificazione', aiPost.filter(b => /Scrivi al massimo 3 ricerche/.test(b.prompt)).length === 1, aiPost.length);

  console.log('\n-- raffinamento quando i prezzi sono pochi --');
  reset();
  risultatiPer = (b) => /subito/.test(b.query)
    ? [RISULTATO('Carhartt su Subito', 38), RISULTATO('Altra felpa', 44)]
    : [RISULTATO('Felpa senza prezzo ' + b.query, null), RISULTATO('Un solo prezzo ' + b.query, 50)];
  await page.click('#btnS');
  await attendiFine();
  check('con pochi prezzi chiede un raffinamento', aiPost.some(b => /Scrivi UNA sola ricerca nuova/.test(b.prompt)));
  check('il raffinamento vede cosa ha gia\' trovato', /Felpa senza prezzo/.test(aiPost.find(b => /Scrivi UNA sola ricerca nuova/.test(b.prompt)).prompt));
  check('il raffinamento vede le ricerche correlate di Google', /carhartt wip prezzo/.test(aiPost.find(b => /Scrivi UNA sola ricerca nuova/.test(b.prompt)).prompt));
  check('esegue la query raffinata', ricPost.some(r => r.query === 'carhartt hoodie usato subito'), ricPost.map(r => r.query));
  check('si ferma comunque a due giri', ricPost.length === 3, ricPost.map(r => r.query));

  console.log('\n-- quando il modello non collabora --');
  reset();
  pianoJson = false;
  risultatiPer = (b) => [RISULTATO('Felpa Carhartt ' + b.query, 45), RISULTATO('Hoodie ' + b.query, 30), RISULTATO('WIP ' + b.query, 60)];
  await page.click('#btnS');
  await attendiFine();
  check('piano illeggibile: cerca lo stesso con le query ovvie', ricPost.length >= 1, ricPost.map(r => r.query));
  check('la query di riserva parte da marca e nome', /Carhartt Felpa hoodie/i.test(ricPost[0].query), ricPost[0]);
  check('la riserva cerca sull\'usato', /vinted/i.test(ricPost[0].query), ricPost[0]);
  pianoJson = true;

  reset();
  rapportoJson = false;
  await page.click('#btnS');
  await attendiFine();
  check('rapporto illeggibile: errore chiaro, non pagina rotta', /riprova/i.test(await page.textContent('#eRic')), await page.textContent('#eRic'));
  check('il passo del rapporto risulta fallito', await page.evaluate(() => document.querySelectorAll('#agList .agp.ko').length) === 1);
  rapportoJson = true;

  console.log('\n-- testo del modello e di SerpApi: sempre escapato --');
  reset();
  risultatiPer = (b) => [
    { titolo: '<img src=x onerror="window.__bucato=1">', fonte: '<b>fonte</b>', link: 'https://vinted.it/x', snippet: '', prezzo: { valore: 20, valuta: '€' } },
    RISULTATO('Normale ' + b.query, 30), RISULTATO('Altro ' + b.query, 40)
  ];
  rapporto = Object.assign({}, rapporto, { riassunto: '<script>window.__bucato=2</script>ok', osservazioni: ['<img src=x onerror="window.__bucato=3">'] });
  await page.click('#btnS');
  await page.waitForSelector('#rRic:not([style*="display: none"])', { timeout: 30000 });
  check('niente HTML iniettato dal rapporto', await page.evaluate(() => !window.__bucato));
  check('il titolo ostile si vede come testo', (await page.textContent('#rRicBody')).includes('<img src=x'));

  console.log('\n-- il rapporto alimenta la stima prezzo --');
  reset();
  await page.click('#rRic .cbtn');   // "Usa per la stima prezzo"
  check('porta sulla scheda prezzo', await page.evaluate(() => document.getElementById('tab-prezzo').classList.contains('on')));
  check('porta con se nome e marca', await page.inputValue('#pNome') === 'Felpa hoodie' && await page.inputValue('#pMarca') === 'Carhartt');
  await page.click('#btnP');
  await page.waitForSelector('#rPre:not([style*="display: none"])', { timeout: 30000 });
  const promptPrezzo = aiPost[aiPost.length - 1].prompt;
  check('la stima riceve i prezzi trovati dall\'agente', /RICERCA ONLINE/.test(promptPrezzo), promptPrezzo.slice(-400));
  check('la stima riceve la conclusione dell\'agente', /conclusione dell'agente: 42€/.test(promptPrezzo));

  console.log('\n-- i numeri citati portano al link giusto --');
  reset();
  // Prima query senza prezzi, seconda con: a schermo devono comparire prima
  // quelle con un prezzo, e il prompt deve avere lo stesso ordine.
  risultatiPer = (b) => /shopping|prezzo/.test(b.query)
    ? [RISULTATO('Con prezzo A', 40), RISULTATO('Con prezzo B', 55), RISULTATO('Con prezzo C', 62)]
    : [RISULTATO('Senza prezzo A', null), RISULTATO('Senza prezzo B', null)];
  await page.click('#nav-ricerca');
  await page.click('#btnS');
  await page.waitForSelector('#rRic:not([style*="display: none"])', { timeout: 30000 });
  const elenco = (aiPost.find(b => /RISULTATI TROVATI ONLINE ADESSO/.test(b.prompt)).prompt.match(/^\d+\. .+$/gm) || []);
  const righe = await page.evaluate(() => Array.from(document.querySelectorAll('#rRicBody .lr')).map(r => ({
    n: r.querySelector('.lrn').textContent.trim(), titolo: r.querySelector('.lrt').textContent.trim()
  })));
  check('le prove a schermo sono numerate', righe.every((r, i) => r.n === String(i + 1)), righe.map(r => r.n));
  check('stesso numero di prove nel prompt e a schermo', elenco.length === righe.length, { prompt: elenco.length, schermo: righe.length });
  check('il numero 1 del rapporto e la prima riga sono la stessa cosa', elenco[0].includes(righe[0].titolo), { prompt: elenco[0], schermo: righe[0].titolo });
  check('il numero 3 del rapporto e la terza riga sono la stessa cosa', elenco[2].includes(righe[2].titolo), { prompt: elenco[2], schermo: righe[2].titolo });
  check('le prove con un prezzo vengono prima', righe.slice(0, 3).every(r => /Con prezzo/.test(r.titolo)), righe.map(r => r.titolo));
  check('la mediana mostrata e quella delle prove elencate', (await page.textContent('#rRicBody')).includes('55€'));

  console.log('\n-- i dati di un capo non finiscono nella stima di un altro --');
  reset();
  await page.click('#nav-prezzo');
  await page.fill('#pNome', 'Scarpe running'); await page.fill('#pMarca', 'Asics');
  await page.click('#btnP');
  await page.waitForSelector('#rPre:not([style*="display: none"])', { timeout: 30000 });
  check('capo diverso: la ricerca resta fuori dal prompt', !/RICERCA ONLINE/.test(aiPost[aiPost.length - 1].prompt));
  reset();
  await page.fill('#pNome', 'Felpa hoodie'); await page.fill('#pMarca', 'Carhartt');
  await page.click('#btnP');
  await page.waitForSelector('#rPre:not([style*="display: none"])', { timeout: 30000 });
  check('stesso capo: la ricerca rientra da sola', /RICERCA ONLINE/.test(aiPost[aiPost.length - 1].prompt));

  console.log('\n-- la ricerca finisce nello storico --');
  await page.click('#nav-storico');
  const storico = await page.textContent('#historyList');
  check('la voce c\'e\', col nome del capo', /Felpa hoodie/.test(storico), storico.slice(0, 200));
  check('col prezzo che ha concluso l\'agente', /42€/.test(storico), storico.slice(0, 300));

  console.log('\n-- lo storico non perde quello che sa gia --');
  reset();
  // Prima la stima, che salva un prezzo. Poi l'agente sullo stesso capo, con
  // un rapporto che il prezzo non ce l'ha: la voce di storico deve tenersi
  // quello della stima invece di restare senza.
  await page.evaluate(() => { try{ localStorage.removeItem('vintedAiHistory'); }catch(e){} });
  await page.click('#nav-prezzo');
  await page.fill('#pNome', 'Giacca jeans'); await page.fill('#pMarca', 'Levis');
  await page.click('#btnP');
  await page.waitForSelector('#rPre:not([style*="display: none"])', { timeout: 30000 });
  const prezzoStimato = await page.textContent('#pNum');

  const rapportoSenzaPrezzo = Object.assign({}, rapporto, {
    prezzoConsigliato: 'non stimabile', rangeMin: null, rangeMax: null, consigli: []
  });
  const rapportoPieno = rapporto;
  rapporto = rapportoSenzaPrezzo;
  await page.click('#nav-ricerca');
  await page.evaluate(() => { ['sNome','sMarca','sTaglia','sNote'].forEach(id => { document.getElementById(id).value=''; }); });
  await compila('Giacca jeans', 'Levis');
  await page.click('#btnS');
  await page.waitForSelector('#rRic:not([style*="display: none"])', { timeout: 30000 });
  rapporto = rapportoPieno;

  await page.click('#nav-storico');
  const voci = await page.evaluate(() => Array.from(document.querySelectorAll('.hItem')).map(h => h.textContent.replace(/\s+/g, ' ')));
  const voce = voci.find(t => /Giacca jeans/.test(t)) || '';
  check('la ricerca non crea una voce doppia', voci.filter(t => /Giacca jeans/.test(t)).length === 1, voci.length);
  check('il prezzo della stima resta nello storico', voce.includes(prezzoStimato), voce.slice(0, 220));
  check('il consiglio della stima non viene cancellato', /💡/.test(voce), voce.slice(0, 220));

  console.log('\n-- il diario si vede mentre gira, non solo alla fine --');
  reset();
  let sblocca;
  const bloccata = new Promise(r => { sblocca = r; });
  await page.route('**/.netlify/functions/ricerca', async route => {
    await bloccata;
    const b = JSON.parse(route.request().postData());
    ricPost.push(b);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ query: b.query, risultati: risultatiPer(b), correlate: [], prezzi: null }) });
  });
  await page.click('#nav-ricerca');
  await page.click('#btnS');
  // La ricerca e' ferma sulla promessa: il diario deve gia' mostrare il passo
  // "Cerco:" in corso, con la pianificazione chiusa sopra.
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('#agList .agp.corso')).some(li => /Cerco:/.test(li.textContent)),
    null, { timeout: 30000 });
  check('mentre cerca, il passo in corso e\' gia\' a schermo', true);
  check('la pianificazione risulta gia\' chiusa', await page.evaluate(() => document.querySelector('#agList .agp').classList.contains('fatto')));
  check('il passo in corso ha il suo spinner', await page.evaluate(() => !!document.querySelector('#agList .agp.corso .agspin')));
  sblocca();
  await attendiFine();
  await page.unroute('**/.netlify/functions/ricerca');
  await page.route('**/.netlify/functions/ricerca', async route => {
    const b = JSON.parse(route.request().postData());
    ricPost.push(b);
    if (ricercaStatus !== 200) return route.fulfill({ status: ricercaStatus, contentType: 'application/json', body: JSON.stringify({ error: ricercaErrore }) });
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ query: b.query, tipo: b.tipo, risultati: risultatiPer(b), correlate: ['carhartt wip prezzo'], prezzi: null })
    });
  });

  console.log('\n-- foto nuove, capo nuovo --');
  reset();
  const jpeg = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 400;
    const x = c.getContext('2d'); x.fillStyle = '#888'; x.fillRect(0, 0, 400, 400);
    return c.toDataURL('image/jpeg', 0.8);
  });
  await page.click('#nav-foto');
  await page.setInputFiles('#fileInput', [{ name: 'capo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg.split(',')[1], 'base64') }]);
  await page.click('#nav-ricerca');
  check('i campi della ricerca vecchia sono stati svuotati', await page.inputValue('#sMarca') === '', await page.inputValue('#sMarca'));
  check('il rapporto vecchio sparisce dalla pagina', await page.evaluate(() => document.getElementById('rRic').style.display === 'none'));
  check('e anche il diario vecchio', await page.evaluate(() => document.getElementById('agList').children.length === 0));
  reset();
  await page.click('#nav-prezzo');
  await page.fill('#pNome', 'Felpa hoodie'); await page.fill('#pMarca', 'Carhartt');
  await page.click('#btnP');
  await page.waitForSelector('#rPre:not([style*="display: none"])', { timeout: 30000 });
  check('la ricerca del capo di prima non alimenta piu\' la stima', !/RICERCA ONLINE/.test(aiPost[aiPost.length - 1].prompt));
  await page.click('#nav-ricerca');
  await compila('Felpa hoodie', 'Carhartt');

  console.log('\n-- ricerca non configurata sul server --');
  reset();
  ricercaStatus = 501; ricercaErrore = 'Ricerca online non configurata sul server (SERPAPI_KEY)';
  await page.click('#nav-ricerca');
  await page.click('#btnS');
  await attendiFine();
  check('lo dice invece di ripetere un errore qualsiasi', /SERPAPI_KEY/.test(await page.textContent('#eRic')), await page.textContent('#eRic'));
  check('il bottone sparisce: senza chiave non c\'e\' niente da fare', await page.evaluate(() => document.getElementById('btnS').style.display === 'none'));

  console.log('\n-- quota finita --');
  await page.evaluate(() => { document.getElementById('btnS').style.display = ''; });
  reset();
  ricercaStatus = 429; ricercaErrore = 'Ricerche online esaurite per questo mese.';
  await page.click('#btnS');
  await attendiFine();
  check('l\'errore di quota arriva all\'utente', /esaurite/.test(await page.textContent('#eRic')), await page.textContent('#eRic'));
  check('senza risultati non scrive nessun rapporto', !aiPost.some(b => /RISULTATI TROVATI ONLINE ADESSO/.test(b.prompt)));
  check('i passi falliti sono marcati', await page.evaluate(() => document.querySelectorAll('#agList .agp.ko').length) >= 1);
  ricercaStatus = 200;

  console.log('\n-- la scheda si compila da sola dall\'analisi --');
  await page.evaluate(() => {
    ['sNome', 'sMarca', 'sTaglia', 'sNote'].forEach(id => { document.getElementById(id).value = ''; });
    lastAnalysis = { tipo: 'Giacca di jeans', brand: 'Levi\'s', taglie: 'L', colore: 'blu', materiale: 'denim', condizione: 'Ottimo' };
    sw('foto');
  });
  await page.click('#nav-ricerca');
  check('nome e marca arrivano dall\'analisi', await page.inputValue('#sNome') === 'Giacca di jeans' && await page.inputValue('#sMarca') === 'Levi\'s');
  check('taglia e dettagli arrivano dall\'analisi', await page.inputValue('#sTaglia') === 'L' && await page.inputValue('#sNote') === 'blu denim');
  check('la condizione finisce nella tendina', await page.inputValue('#sCond') === 'Ottimo');
  await page.fill('#sNome', 'scritto a mano');
  await page.click('#nav-foto'); await page.click('#nav-ricerca');
  check('quello che l\'utente ha scritto non viene sovrascritto', await page.inputValue('#sNome') === 'scritto a mano');

  console.log('\n-- errori JS accumulati --');
  check('nessun errore JS in tutta la sessione', errors.length === 0, errors);

  await browser.close();
  server.close();
  console.log(`\n${pass} passati, ${fail} falliti`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
