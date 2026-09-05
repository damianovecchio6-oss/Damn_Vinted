const L = require('./lib');
const { chromium } = require('playwright-core');
const { check, fine } = L.contatore();

// I conti sui prezzi, chiamati direttamente invece che attraverso un giro
// intero dello scanner. Non e' una doppia copia di scanner.js: li' si guarda
// che il rapporto dica la cosa giusta partendo da annunci finti, qui si guarda
// cosa succede ai casi che un giro normale non produce quasi mai - un annuncio
// solo, sei annunci allo stesso prezzo, un peso enorme, una voce di storico
// storta. Sono i casi in cui un conto sbagliato non si vede come un errore ma
// come un prezzo, e un prezzo sbagliato costruito su numeri veri e' la forma
// di guasto piu' difficile da riconoscere a occhio.
(async () => {
  const server = await L.serviSito(8892);
  const browser = await chromium.launch({ executablePath: L.chromium(), args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errori = [];
  page.on('pageerror', e => errori.push(String(e)));
  await L.senzaGuida(page);
  await page.goto('http://127.0.0.1:8892/', { waitUntil: 'load' });

  const q = (valori, pesi, quantile) => page.evaluate(([v, p, qq]) =>
    sxQuantile(v.map((x, i) => ({ valore: x, peso: p[i], prova: {} })), qq), [valori, pesi, quantile]);

  // Un annuncio Vinted, un titolo, un prezzo: quello che serve per far
  // attraversare a una prova tutta la valutazione.
  const IDENTITA = { marca: { v: 'Carhartt', f: 'foto' }, tipo: { v: 'felpa', f: 'foto' }, condizione: { v: 'Ottimo', f: 'foto' } };
  const valuta = (prove) => page.evaluate(([pr, identita]) => {
    const p = pr.map(x => Object.assign({ fonte: 'Vinted', link: 'https://www.vinted.it/items/1', snippet: '' }, x,
      { prezzo: { valore: x.prezzo, valuta: '€' } }));
    sxValuta(p, identita);
    const m = sxMercato(p);
    return { usato: m.usato, pesi: p.map(x => x.peso), fiducia: m.usato ? sxFiducia(m) : null, margine: sxMargine(m.usato), composizione: sxComposizione(m.usato) };
  }, [prove, IDENTITA]);

  console.log('\n-- il quantile pesato --');
  // La promessa su cui poggia tutto il resto: se della data e della condizione
  // non si sa niente - e capita spesso - i conti devono restare quelli di
  // prima. Senza questa riga il peso sarebbe un cambio di prezzo mascherato.
  check('a pesi uguali da\' gli stessi numeri del quantile non pesato',
    await q([30, 35, 40, 45, 50, 55], [1, 1, 1, 1, 1, 1], 0.25) === 36.25, await q([30, 35, 40, 45, 50, 55], [1, 1, 1, 1, 1, 1], 0.25));
  check('e conta il rapporto fra i pesi, non la loro scala',
    await q([30, 35, 40, 45, 50, 55], [.3, .3, .3, .3, .3, .3], 0.25) === 36.25);
  check('un valore solo torna se stesso', await q([42], [1], 0.5) === 42);
  check('due valori si interpolano in mezzo', await q([10, 20], [1, 1], 0.5) === 15);
  check('lista vuota -> null, non NaN', await q([], [], 0.5) === null);
  check('pesi tutti a zero: torna un numero, non una divisione per zero',
    typeof (await q([10, 20, 30], [0, 0, 0], 0.5)) === 'number', await q([10, 20, 30], [0, 0, 0], 0.5));
  check('un quantile fuori scala resta dentro i valori',
    await q([10, 20, 30], [1, 1, 1], -1) === 10 && await q([10, 20, 30], [1, 1, 1], 2) === 30);

  // Il primo e l'ultimo valore restano ancorati a q=0 e q=1: e' quello che
  // rende il quantile identico a prima a pesi uguali, e vuol dire che un peso
  // gonfiato su un estremo non puo' portarsi via la mediana da solo. In mezzo
  // invece se la prende. Chi cambia questa funzione aspettandosi la media
  // pesata dei manuali deve trovare qui scritto che non lo e'.
  const bordo = await q([10, 20, 30], [1, 1, 50], 0.5);
  check('un peso enorme sul bordo tira il quantile verso di se\'', bordo > 20 && bordo < 30, bordo);
  check('e piu\' pesa piu\' tira', bordo > await q([10, 20, 30], [1, 1, 5], 0.5), [await q([10, 20, 30], [1, 1, 5], 0.5), bordo]);
  check('lo stesso peso in mezzo invece se lo prende tutto', await q([10, 20, 30], [1, 50, 1], 0.5) === 20, await q([10, 20, 30], [1, 50, 1], 0.5));

  console.log('\n-- quanto vale una prova --');
  const condizioni = await valuta([
    { titolo: 'Felpa Carhartt nuovo con cartellino', prezzo: 70 },
    { titolo: 'Felpa Carhartt ottime condizioni', prezzo: 40 },
    { titolo: 'Felpa Carhartt buone condizioni', prezzo: 35 },
    { titolo: 'Felpa Carhartt soddisfacente', prezzo: 25 }
  ]);
  check('il peso scende man mano che la condizione si allontana dalla tua',
    condizioni.pesi[1] > condizioni.pesi[2] && condizioni.pesi[2] > condizioni.pesi[0] && condizioni.pesi[0] === condizioni.pesi[3],
    condizioni.pesi);
  check('e conta quanti hanno davvero la stessa condizione', condizioni.usato.stessaCond === 1, condizioni.usato.stessaCond);

  const eta = await valuta([
    { titolo: 'Felpa Carhartt A', prezzo: 40, eta: { testo: '5 giorni fa', giorni: 5 } },
    { titolo: 'Felpa Carhartt B', prezzo: 41, eta: { testo: '2 mesi fa', giorni: 60 } },
    { titolo: 'Felpa Carhartt C', prezzo: 42, eta: { testo: '10 mesi fa', giorni: 300 } },
    { titolo: 'Felpa Carhartt D', prezzo: 43, eta: { testo: '3 anni fa', giorni: 1100 } }
  ]);
  check('un annuncio pesa meno man mano che invecchia',
    eta.pesi[0] > eta.pesi[1] && eta.pesi[1] > eta.pesi[2] && eta.pesi[2] > eta.pesi[3], eta.pesi);
  check('e una data che manca non vale come una data vecchia',
    (await valuta([{ titolo: 'Felpa Carhartt A', prezzo: 40 }])).pesi[0] > eta.pesi[3]);

  const venduto = await valuta([
    { titolo: 'Felpa Carhartt A', prezzo: 40 },
    { titolo: 'Felpa Carhartt B venduto', prezzo: 40, link: 'https://www.ebay.it/itm/1' }
  ]);
  check('un prezzo di venduto pesa piu\' di uno chiesto', venduto.pesi[1] > venduto.pesi[0], venduto.pesi);
  check('e viene contato', venduto.usato.venduti === 1, venduto.usato.venduti);
  // "venduto da Marco" sotto un annuncio ancora aperto non e' un esito: e' il
  // nome di chi vende. Contarlo come vendita conclusa gli darebbe il peso
  // della prova migliore che abbiamo.
  const daChi = await valuta([
    { titolo: 'Felpa Carhartt A', prezzo: 40, snippet: 'venduto da Marco, spedizione inclusa' },
    { titolo: 'Felpa Carhartt B', prezzo: 40, snippet: 'spedizione inclusa' }
  ]);
  check('"venduto da" e\' chi vende, non un esito: nessun bonus',
    daChi.usato.venduti === 0 && daChi.pesi[0] === daChi.pesi[1], { venduti: daChi.usato.venduti, pesi: daChi.pesi });

  console.log('\n-- i casi che un giro normale non produce quasi mai --');
  const solo = await valuta([{ titolo: 'Felpa Carhartt A', prezzo: 40 }]);
  check('un annuncio solo: le statistiche ci sono ma non basta per un numero',
    solo.usato.n === 1 && solo.fiducia.livello === 'bassa' && solo.fiducia.numero === false, solo.fiducia);
  check('e il margine resta un numero', Number.isFinite(solo.margine), solo.margine);

  const identici = await valuta([1, 2, 3, 4, 5, 6].map(i => ({ titolo: 'Felpa Carhartt ' + i, prezzo: 40 })));
  check('sei annunci allo stesso prezzo: nessuna divisione per zero',
    identici.usato.mediana === 40 && identici.margine === 0 && identici.fiducia.livello === 'media',
    { mediana: identici.usato.mediana, margine: identici.margine, fiducia: identici.fiducia.livello });

  const meta = await valuta([40, 41, 42, 60, 61, 62].map((prezzo, i) => ({
    titolo: 'Felpa Carhartt ' + i, prezzo,
    eta: i < 3 ? { testo: '5 giorni fa', giorni: 5 } : { testo: '10 mesi fa', giorni: 300 }
  })));
  check('sei annunci di cui tre svalutati non valgono sei prove',
    meta.usato.n === 6 && meta.usato.nEff < 6 && meta.usato.nEff > 3, { n: meta.usato.n, nEff: meta.usato.nEff });
  check('e la mediana pende verso quelli ancora caldi', meta.usato.mediana < 45, meta.usato.mediana);
  check('la composizione lo dice a lettere', /3 sono annunci più vecchi/.test(meta.composizione), meta.composizione);
  check('quando non si sa niente di niente, lo dice pure quello',
    /non so né la data né la condizione/.test(identici.composizione), identici.composizione);

  console.log('\n-- la calibrazione: solo vendite vere, o niente --');
  const cal = (voci) => page.evaluate(v => {
    localStorage.clear();
    v.forEach((x, i) => upsertHistoryItem('c' + i, x));
    return calibrazioneStorico();
  }, voci);
  const VENDUTO = (suggerito, prezzo, giorni) => ({ nome: 'Capo', prezzoSuggerito: suggerito, esito: { venduto: true, prezzo, giorni } });

  check('due esiti non fanno una media', await cal([VENDUTO(40, 34, 10), VENDUTO(50, 40, 12)]) === null);
  check('un "non ancora" non conta come vendita',
    await cal([VENDUTO(40, 34, 10), VENDUTO(50, 40, 12), { nome: 'C', prezzoSuggerito: 20, esito: { venduto: false } }]) === null);
  check('senza prezzo suggerito non c\'e\' niente da confrontare',
    await cal([VENDUTO(40, 34, 10), VENDUTO(50, 40, 12), { nome: 'C', esito: { venduto: true, prezzo: 18, giorni: 9 } }]) === null);
  // Un suggerito a 0 darebbe Infinity, un prezzo scritto a parole NaN: una
  // riga sola cosi' avvelenerebbe la mediana di tutte le altre.
  check('voci storte (suggerito 0, prezzo scritto a parole) restano fuori',
    await cal([{ nome: 'A', prezzoSuggerito: 0, esito: { venduto: true, prezzo: 30, giorni: 3 } },
               { nome: 'B', prezzoSuggerito: 50, esito: { venduto: true, prezzo: 'quaranta', giorni: 12 } },
               VENDUTO(20, 18, 20)]) === null);

  const sotto = await cal([VENDUTO(40, 34, 10), VENDUTO(50, 40, 12), VENDUTO(20, 18, 20)]);
  check('tre vendite vere: scarto e giorni sono mediane, non medie',
    sotto.n === 3 && sotto.scarto === -15 && sotto.giorni === 12, sotto);
  const sopra = await cal([VENDUTO(40, 44), VENDUTO(50, 55), VENDUTO(20, 22)]);
  check('chi vende sopra il suggerito lo vede scritto sopra', sopra.scarto === 10, sopra);
  check('e senza i giorni non se li inventa', sopra.giorni === null, sopra.giorni);

  check('nessun errore JS in tutta la sessione', errori.length === 0, errori);

  await browser.close();
  server.close();
  fine();
})().catch(e => { console.error(e); process.exit(1); });
