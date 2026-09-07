const L = require('./lib');
const { chromium } = require('playwright-core');
const { check, fine } = L.contatore();

// Il profilo del capo e la confidenza del campione, chiamati direttamente.
// Sono due conti che si vedono poco a schermo - una riga di fianco a un campo,
// un numero sotto il prezzo - ma decidono quanto ci si puo' fidare di tutto il
// resto, e sbagliati non si vedono come un errore: si vedono come un capo
// identificato bene e un prezzo solido. Qui si guarda che una marca letta sul
// cartellino valga piu' di una dedotta, che due fonti d'accordo valgano piu'
// di una sola, che due che si contraddicono valgano meno, e che venti annunci
// di un altro capo non facciano confidenza.
(async () => {
  const server = await L.serviSito(8901);
  const browser = await chromium.launch({ executablePath: L.chromium(), args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errori = [];
  page.on('pageerror', e => errori.push(String(e)));
  await L.senzaGuida(page);
  await page.goto('http://127.0.0.1:8901/', { waitUntil: 'load' });

  const val = (fn) => page.evaluate(fn);

  console.log('\n-- da dove arriva un campo dice quanto vale --');
  const fonti = await val(() => ({
    etichetta: sxCampo('Nike', 'etichetta'),
    foto: sxCampo('Nike', 'foto'),
    lente: sxCampo('Air Max 90', 'lente'),
    tu: sxCampo('42', 'tu'),
    vuoto: sxCampo('non identificato', 'foto')
  }));
  check('una marca letta sul cartellino vale piu\' di una vista in foto',
    fonti.etichetta.c > fonti.foto.c, { etichetta: fonti.etichetta.c, foto: fonti.foto.c });
  check('e la foto resta la fonte che sbaglia di piu\'',
    fonti.foto.c < fonti.lente.c && fonti.lente.c < fonti.tu.c && fonti.tu.c < fonti.etichetta.c,
    [fonti.foto.c, fonti.lente.c, fonti.tu.c, fonti.etichetta.c]);
  check('un campo illeggibile non e\' un campo con fiducia bassa: non c\'e\'', fonti.vuoto === null);

  console.log('\n-- due fonti sullo stesso campo --');
  const unito = await val(() => ({
    concordi: sxUnisci(sxCampo('Nike', 'etichetta'), sxCampo('Nike', 'foto')),
    discordi: sxUnisci(sxCampo('Nike', 'etichetta'), sxCampo('Adidas', 'foto')),
    sola: sxUnisci(null, sxCampo('Nike', 'foto')),
    niente: sxUnisci(null, null),
    solaEtichetta: sxCampo('Nike', 'etichetta').c
  }));
  check('due fonti d\'accordo valgono piu\' della migliore delle due',
    unito.concordi.c > unito.solaEtichetta && unito.concordi.c <= 0.99,
    { insieme: unito.concordi.c, sola: unito.solaEtichetta });
  check('due che si contraddicono: vince l\'etichetta, ma non e\' piu\' una certezza',
    unito.discordi.v === 'Nike' && unito.discordi.c < unito.solaEtichetta, unito.discordi);
  check('e il disaccordo resta scritto, invece di sparire',
    unito.discordi.contro && unito.discordi.contro.v === 'Adidas' && unito.discordi.contro.f === 'foto',
    unito.discordi.contro);
  check('una fonte sola resta quella che e\'', unito.sola.v === 'Nike' && unito.sola.f === 'foto');
  check('nessuna fonte: niente campo', unito.niente === null);

  console.log('\n-- il profilo: campi piatti, fiducia e fonte a fianco --');
  const profilo = await val(() => sxProfilo({
    tipo: sxCampo('sneakers', 'foto'),
    marca: sxUnisci(sxCampo('Nike', 'etichetta'), sxCampo('Nike', 'foto')),
    modello: sxCampo('Air Max 90', 'lente'),
    taglia: sxCampo('42', 'etichetta'),
    colore: sxCampo('bianco', 'foto'),
    materiale: sxCampo('pelle', 'etichetta'),
    condizione: sxCampo('Buone condizioni', 'tu'),
    epoca: null,
    difetti: sxCampo('graffio sulla punta', 'foto')
  }));
  check('i campi ci sono, con i nomi del prodotto',
    profilo.marca === 'Nike' && profilo.modello === 'Air Max 90' && profilo.categoria === 'sneakers'
    && profilo.taglia === '42' && profilo.colore === 'bianco' && profilo.materiale === 'pelle'
    && profilo.condizione === 'Buone condizioni', profilo);
  check('ogni campo si porta dietro la sua fiducia',
    profilo.fiducia.marca > profilo.fiducia.colore && profilo.fiducia.taglia > profilo.fiducia.modello,
    profilo.fiducia);
  check('e la sua fonte',
    profilo.fonti.marca === 'etichetta' && profilo.fonti.modello === 'lente'
    && profilo.fonti.condizione === 'tu' && profilo.fonti.colore === 'foto', profilo.fonti);
  check('un campo che non c\'e\' non finisce nel profilo con un buco',
    !('epoca' in profilo) && !('epoca' in profilo.fiducia), Object.keys(profilo));

  console.log('\n-- quanto un annuncio parla davvero di questo capo --');
  const IDENTITA = {
    marca: { v: 'Nike', f: 'etichetta', c: 0.97 },
    tipo: { v: 'sneakers', f: 'foto', c: 0.62 },
    modello: { v: 'Air Max 90', f: 'lente', c: 0.85 },
    condizione: { v: 'Buone condizioni', f: 'tu', c: 0.9 }
  };
  const grado = (titolo) => page.evaluate(([t, id]) =>
    sxGradoPertinenza({ titolo: t, snippet: '' }, id), [titolo, IDENTITA]);
  const pieno = await grado('Nike Air Max 90 sneakers bianche');
  const soloMarca = await grado('Nike felpa');
  const soloTipo = await grado('sneakers usate');
  check('marca, modello e tipo insieme: pieno', pieno === 1, pieno);
  check('la marca da sola vale piu\' del tipo da solo', soloMarca > soloTipo, { soloMarca, soloTipo });
  check('e tutti e due meno di tutto insieme', soloMarca < pieno && soloTipo > 0, { soloMarca, soloTipo });
  check('niente in comune: zero, e resta fuori dalla mediana',
    await grado('lampada da tavolo') === 0
    && await page.evaluate(([id]) => sxPertinente({ titolo: 'lampada da tavolo', snippet: '' }, id), [IDENTITA]) === false);
  // La regola di prima non e' cambiata: bastava la marca, o una parola del
  // tipo. Il grado e' piu' fine, ma la soglia che taglia e' la stessa.
  check('chi era pertinente prima lo e\' ancora',
    await page.evaluate(([id]) => [
      sxPertinente({ titolo: 'Nike felpa', snippet: '' }, id),
      sxPertinente({ titolo: 'sneakers usate', snippet: '' }, id),
      sxPertinente({ titolo: 'lampada', snippet: '' }, id)
    ], [IDENTITA]).then(r => r[0] === true && r[1] === true && r[2] === false));

  console.log('\n-- la confidenza del campione --');
  const conf = (comparabili) => page.evaluate(c => sxConfidenza(c), comparabili);
  const uguali = (n, somiglianza, freschezza) =>
    Array.from({ length: n }, () => ({ somiglianza, freschezza }));
  check('nessun comparabile: zero, non "non lo so"', await conf([]) === 0);
  check('venti annunci identici e freschi: uno', await conf(uguali(20, 1, 1)) === 1, await conf(uguali(20, 1, 1)));
  // Il conto del modello, verificato a mano: 10/20 = 0.5 di quantita',
  // 0.5*0.30 + 0.8*0.45 + 0.6*0.25 = 0.66.
  check('i pesi sono quelli dichiarati: 0.30 quantita\', 0.45 somiglianza, 0.25 freschezza',
    await conf(uguali(10, 0.8, 0.6)) === 0.66, await conf(uguali(10, 0.8, 0.6)));
  check('oltre i venti non si guadagna piu\' niente',
    await conf(uguali(20, 0.8, 0.8)) === await conf(uguali(40, 0.8, 0.8)));
  check('venti annunci di un altro capo valgono meno di cinque uguali al tuo',
    await conf(uguali(20, 0.1, 1)) < await conf(uguali(5, 1, 1)),
    { altri: await conf(uguali(20, 0.1, 1)), tuoi: await conf(uguali(5, 1, 1)) });
  check('e piu\' annunci uguali fanno piu\' confidenza',
    await conf(uguali(4, 0.9, 0.9)) < await conf(uguali(12, 0.9, 0.9)));

  console.log('\n-- dagli annunci veri al numero --');
  const USATO = (titolo, prezzo, eta) => ({
    titolo, fonte: 'Vinted', link: 'https://www.vinted.it/items/' + encodeURIComponent(titolo),
    snippet: '', eta, prezzo: { valore: prezzo, valuta: '€' }
  });
  const mercato = (prove) => page.evaluate(([pr, id]) => {
    sxValuta(pr, id);
    const m = sxMercato(pr);
    return { usato: m.usato, fiducia: sxFiducia(m), perche: sxPercheConfidenza(m.usato) };
  }, [prove, IDENTITA]);

  const buono = await mercato([1, 2, 3, 4, 5, 6].map(i =>
    USATO('Nike Air Max 90 sneakers buone condizioni ' + i, 60 + i, { testo: '5 giorni fa', giorni: 5 })));
  const scarso = await mercato([1, 2, 3, 4, 5, 6].map(i =>
    USATO('Nike felpa ' + i, 60 + i, { testo: '2 anni fa', giorni: 730 })));
  check('sei annunci dello stesso modello, freschi e nella tua condizione: confidenza alta',
    buono.usato.confidenza > 0.7, buono.usato.confidenza);
  check('sei annunci di un altro capo e vecchi di due anni: confidenza bassa',
    scarso.usato.confidenza < buono.usato.confidenza - 0.2,
    { buono: buono.usato.confidenza, scarso: scarso.usato.confidenza });
  check('la fiducia si porta dietro il punteggio, e viene dallo stesso conto',
    buono.fiducia.punteggio === buono.usato.confidenza, buono.fiducia);
  // Il caso che il numero solo nasconde: prezzi vicinissimi - quindi livello
  // alto - su annunci che parlano di un altro capo.
  check('livello e confidenza guardano cose diverse, e si vede',
    scarso.fiducia.livello === buono.fiducia.livello && scarso.fiducia.punteggio < buono.fiducia.punteggio,
    { livelli: [scarso.fiducia.livello, buono.fiducia.livello] });
  check('e la confidenza si spiega partendo dal lato piu\' debole',
    scarso.perche.indexOf('freschezza') < scarso.perche.indexOf('somiglianza')
    && scarso.perche.indexOf('quantit') < scarso.perche.indexOf('somiglianza')
    && /6 annunci su 20/.test(scarso.perche), scarso.perche);
  check('senza annunci non c\'e\' punteggio da dare',
    (await page.evaluate(() => sxFiducia({ usato: null, nuovo: null }))).punteggio === 0);

  check('nessun errore di pagina', errori.length === 0, errori);
  await browser.close();
  server.close();
  fine();
})();
