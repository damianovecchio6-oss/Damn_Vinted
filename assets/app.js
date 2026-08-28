/* ==========================================================================
   Damn Vinted — logica applicativa
   Nessun handler inline nell'HTML: tutto passa da data-action + delegation.
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- stato ---------- */
  var selFiles = [];                              // File[] selezionati (max 4)
  var previewUrls = [];                           // objectURL delle anteprime, da revocare
  var selTone = 'amichevole e informale';
  var lastAnalysis = null;                        // ultimo JSON di analisi foto
  var lastAnnuncio = null;                        // {titolo, descrizione, hashtag}
  var currentItemId = null;                       // id della voce di storico in corso
  var lastThumbnail = null;                       // data URL della miniatura

  var MAX_FILES = 4;
  var MAX_PAYLOAD_CHARS = 5200000;                // margine sotto il limite 6MB di Netlify
  var CONDIZIONI = ['Nuovo con etichetta', 'Nuovo senza etichetta', 'Ottimo', 'Buono', 'Soddisfacente'];
  var HISTORY_KEY = 'vintedAiHistory';

  /* ---------- helper DOM ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var val = function (id) { var el = $(id); return el && el.value ? el.value.trim() : ''; };
  var show = function (id) { var el = $(id); if (el) el.style.display = ''; };
  var hide = function (id) { var el = $(id); if (el) el.style.display = 'none'; };
  var setText = function (id, txt) { var el = $(id); if (el) el.textContent = txt; };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var toastTimer = null;
  function toast(msg, dur) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, dur || 2500);
  }

  /* Copia negli appunti il testo di un elemento (una sola implementazione). */
  function copyFrom(id) {
    var el = $(id);
    var txt = el ? el.textContent : '';
    if (!txt) { toast('⚠️ Niente da copiare'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(
        function () { toast('✅ Copiato!'); },
        function () { toast('⚠️ Copia non riuscita'); }
      );
      return;
    }
    var ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('✅ Copiato!'); }
    catch (e) { toast('⚠️ Copia non riuscita'); }
    document.body.removeChild(ta);
  }

  /* ---------- navigazione tab ---------- */
  function switchTab(name) {
    var panel = $('tab-' + name);
    var navBtn = $('nav-' + name);
    if (!panel || !navBtn) return;
    Array.prototype.forEach.call(document.querySelectorAll('.tp'), function (p) { p.classList.remove('on'); });
    Array.prototype.forEach.call(document.querySelectorAll('.nb'), function (b) {
      b.classList.remove('on');
      b.setAttribute('aria-selected', 'false');
    });
    panel.classList.add('on');
    navBtn.classList.add('on');
    navBtn.setAttribute('aria-selected', 'true');
    if (name === 'storico') renderHistory();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- selezione foto ---------- */
  function clearPreviewUrls() {
    previewUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    previewUrls = [];
  }

  function renderPreviews() {
    var box = $('ps');
    if (!box) return;
    clearPreviewUrls();
    box.innerHTML = selFiles.map(function (f, i) {
      var url = URL.createObjectURL(f);
      previewUrls.push(url);
      return '<div class="pw">' +
             '<img src="' + url + '" class="pi" alt="Anteprima foto ' + (i + 1) + '"/>' +
             '<button class="pd" type="button" data-action="del-file" data-index="' + i + '" aria-label="Rimuovi foto ' + (i + 1) + '">×</button>' +
             '</div>';
    }).join('');
  }

  function syncUploadUI() {
    var has = selFiles.length > 0;
    var ubox = $('ubox');
    if (ubox) ubox.classList.toggle('has', has);
    setText('ulabel', has
      ? selFiles.length + (selFiles.length === 1 ? ' foto' : ' foto') + ' — tocca per cambiare'
      : 'Tocca per scegliere la foto');
    var btn = $('btnA');
    if (btn) btn.disabled = !has;
  }

  function onFilesChosen(e) {
    selFiles = Array.prototype.slice.call(e.target.files || []).slice(0, MAX_FILES);
    currentItemId = null;
    lastAnalysis = null;
    lastThumbnail = null;
    renderPreviews();
    syncUploadUI();
  }

  function delFile(i) {
    selFiles.splice(i, 1);
    renderPreviews();
    syncUploadUI();
  }

  /* ---------- chiamata al backend ---------- */
  async function callAI(payload) {
    var body = JSON.stringify(payload);
    if (body.length > MAX_PAYLOAD_CHARS) {
      throw new Error('Immagini troppo pesanti: prova con meno foto.');
    }
    var r = await fetch('/.netlify/functions/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body
    });
    var d;
    try { d = await r.json(); }
    catch (e) { throw new Error('Risposta non valida dal server (HTTP ' + r.status + ')'); }
    if (d.error) throw new Error(d.error);
    if (!d.text) throw new Error('Risposta vuota dal server');
    return d.text;
  }

  /* Estrae il JSON da una risposta del modello, tollerando backtick e testo attorno. */
  function parseModelJson(raw) {
    var cleaned = String(raw).replace(/```json/gi, '').replace(/```/g, '').trim();
    try { return JSON.parse(cleaned); } catch (e) { /* si prova col fallback */ }
    var start = cleaned.indexOf('{');
    var end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)); } catch (e2) { /* niente da fare */ }
    }
    return null;
  }

  /* ---------- compressione immagini ---------- */
  function compressImage(file, maxSize, quality) {
    maxSize = maxSize || 800;
    quality = quality || 0.75;
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
          else { w = Math.round(w * maxSize / h); h = maxSize; }
        }
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        var dataUrl = canvas.toDataURL('image/jpeg', quality);
        URL.revokeObjectURL(url);
        resolve(dataUrl.split(',')[1]);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Caricamento immagine fallito'));
      };
      img.src = url;
    });
  }

  /* Più foto = ognuna più leggera, per restare sotto il limite del payload. */
  function compressionSettings(count) {
    if (count <= 1) return { maxSize: 1280, quality: 0.85 };
    if (count === 2) return { maxSize: 1152, quality: 0.82 };
    return { maxSize: 1024, quality: 0.78 };
  }

  /* ---------- condizione ---------- */
  /* Mappa un testo libero sulle opzioni della select.
     Le due varianti "Nuovo con/senza etichetta" vanno distinte prima del
     confronto sulla prima parola, altrimenti "senza" finisce su "con". */
  function matchCondizione(raw) {
    if (!raw) return null;
    var s = String(raw).toLowerCase().trim();
    for (var i = 0; i < CONDIZIONI.length; i++) {
      if (s.indexOf(CONDIZIONI[i].toLowerCase()) >= 0) return CONDIZIONI[i];
    }
    if (s.indexOf('etichetta') >= 0 || s.indexOf('nuovo') >= 0) {
      return s.indexOf('senza') >= 0 ? 'Nuovo senza etichetta' : 'Nuovo con etichetta';
    }
    for (var j = 0; j < CONDIZIONI.length; j++) {
      if (s.indexOf(CONDIZIONI[j].toLowerCase().split(' ')[0]) >= 0) return CONDIZIONI[j];
    }
    return null;
  }

  function applyCondizione(selectId, raw) {
    var match = matchCondizione(raw);
    var el = $(selectId);
    if (match && el) el.value = match;
  }

  /* ---------- 1. analisi foto ---------- */
  function promptAnalisi(count) {
    var intro = count > 1
      ? 'Le ' + count + ' foto seguenti ritraggono LO STESSO capo da angolazioni e dettagli diversi (etichette, cuciture, difetti). Valutale insieme come un unico capo.'
      : 'Analizza questo capo di abbigliamento.';
    return intro + ' Guardalo con l\'occhio di un esperto di seconda mano e vintage. Guarda con attenzione l\'etichetta (se visibile): il tipo di font del logo, il formato dell\'etichetta di lavaggio/composizione, lo stile di cucitura, il tipo di tessuto, eventuali codici o scritte — questi sono indizi per capire se il capo è vintage e di che epoca.\n\n' +
      'Rispondi SOLO con questo JSON valido, senza backtick né markdown, nessun testo prima o dopo:\n' +
      '{"tipo":"es: giacca in pelle","brand":"leggi l\'etichetta, se non visibile scrivi Non identificato","colore":"","materiale":"es: 100% cotone, se visibile sull\'etichetta","condizione":"una tra: Nuovo con etichetta, Nuovo senza etichetta, Ottimo, Buono, Soddisfacente","taglie":"taglie probabili","stagione":"","stile":"es: streetwear, casual, elegante, sportivo, vintage","fasciaPrezzo":"es: 20-50€","fasciaPrezzoMin":20,"fasciaPrezzoMax":50,"note":"difetti visibili, usura, dettagli particolari","vintageStima":"es: Anni 90, Y2K, Anni 80, oppure Non vintage se non ci sono indizi","vintageIndizi":"elenco breve degli indizi visivi concreti che ti fanno pensare sia vintage (o assenza di indizi), es: etichetta con font squadrato tipico anni 90, cucitura a doppio filo, tessuto pesante non più in uso","vintageConfidenza":"una tra: bassa, media, alta - quanto sei sicuro della stima vintage"}';
  }

  function renderAnalisi(obj) {
    var isVintage = obj.vintageStima && obj.vintageStima.toLowerCase().indexOf('non vintage') < 0;
    var vintageLine = isVintage
      ? '\n🕰️ POSSIBILE VINTAGE: ' + obj.vintageStima + ' (confidenza: ' + (obj.vintageConfidenza || 'non specificata') + ')' +
        '\n🔍 INDIZI: ' + (obj.vintageIndizi || '')
      : '';
    setText('rFotoTxt',
      '🏷️ TIPO DI CAPO: ' + (obj.tipo || '') +
      '\n👔 BRAND / MARCA: ' + (obj.brand || '') +
      '\n🎨 COLORE/I: ' + (obj.colore || '') +
      '\n🧵 MATERIALE: ' + (obj.materiale || '') +
      '\n⭐ CONDIZIONE STIMATA: ' + (obj.condizione || '') +
      '\n📐 TAGLIE PROBABILI: ' + (obj.taglie || '') +
      '\n🗓️ STAGIONE: ' + (obj.stagione || '') +
      '\n✨ STILE: ' + (obj.stile || '') +
      '\n💰 FASCIA DI PREZZO ORIGINALE STIMATA: ' + (obj.fasciaPrezzo || '') +
      '\n💡 NOTE: ' + (obj.note || '') + vintageLine);
  }

  async function analyzePhoto() {
    if (!selFiles.length) return;
    show('lFoto'); hide('rFoto'); hide('eFoto');
    var btn = $('btnA');
    if (btn) btn.disabled = true;
    setText('lFotoTxt', selFiles.length > 1 ? 'Analisi di ' + selFiles.length + ' immagini…' : 'Analisi immagine…');

    try {
      var cfg = compressionSettings(selFiles.length);
      var images = [];
      for (var i = 0; i < selFiles.length; i++) {
        images.push({
          base64: await compressImage(selFiles[i], cfg.maxSize, cfg.quality),
          mime: 'image/jpeg'
        });
      }

      try { lastThumbnail = 'data:image/jpeg;base64,' + await compressImage(selFiles[0], 160, 0.5); }
      catch (thumbErr) { lastThumbnail = null; }

      var txt = await callAI({
        type: 'image',
        images: images,
        prompt: promptAnalisi(images.length)
      });

      var obj = parseModelJson(txt);
      if (!obj) {
        lastAnalysis = null;
        setText('rFotoTxt', txt);
        show('rFoto');
        return;
      }
      lastAnalysis = obj;
      renderAnalisi(obj);
      show('rFoto');
    } catch (e) {
      setText('eFoto', '⚠️ ' + e.message);
      show('eFoto');
    } finally {
      hide('lFoto');
      syncUploadUI();
    }
  }

  /* ---------- passaggio analisi → annuncio + prezzo ---------- */
  function toAnnuncio() {
    if (!lastAnalysis) { toast('ANALIZZA PRIMA UN CAPO!'); return; }
    var obj = lastAnalysis;
    currentItemId = 'item_' + Date.now();

    var brandNoto = obj.brand && obj.brand.toLowerCase().indexOf('non identificat') < 0;

    if (obj.tipo) $('aNome').value = obj.tipo;
    if (brandNoto) $('aMarca').value = obj.brand;
    if (obj.colore) $('aColore').value = obj.colore;
    if (obj.materiale) $('aMat').value = obj.materiale;
    applyCondizione('aCond', obj.condizione);
    $('aNote').value = '';

    if (obj.tipo) { $('pNome').value = obj.tipo; $('pCat').value = obj.tipo; }
    if (brandNoto) $('pMarca').value = obj.brand;
    applyCondizione('pCond', obj.condizione);

    if (typeof obj.fasciaPrezzoMin === 'number' && typeof obj.fasciaPrezzoMax === 'number' && !$('pPrezzo').value) {
      $('pPrezzo').value = Math.round((obj.fasciaPrezzoMin + obj.fasciaPrezzoMax) / 2);
    }

    switchTab('annuncio');
    toast('// GENERO ANNUNCIO...');
    setTimeout(genAnnuncio, 600);
  }

  /* ---------- 2. generazione annuncio ---------- */
  var ANGOLI = [
    'parti descrivendo subito il colore o il materiale',
    'parti dall\'occasione in cui useresti questo capo',
    'parti da un dettaglio delle note o della condizione',
    'parti in modo diretto, dicendo cosa vendi e perché è comodo/bello da indossare',
    'parti da come sta o da un abbinamento pratico'
  ];

  function vintageHint() {
    if (!lastAnalysis || !lastAnalysis.vintageStima) return '';
    if (lastAnalysis.vintageStima.toLowerCase().indexOf('non vintage') >= 0) return '';
    var conf = (lastAnalysis.vintageConfidenza || '').toLowerCase();
    if (conf !== 'media' && conf !== 'alta') return '';
    return '\n- Possibile epoca vintage: ' + lastAnalysis.vintageStima +
           ' (indizi: ' + (lastAnalysis.vintageIndizi || 'non specificati') + ')' +
           ' — menzionalo con cautela, es. "in stile anni 90" o "con dettagli che richiamano gli anni 90", MAI come certificazione assoluta';
  }

  async function genAnnuncio() {
    show('lAnn'); hide('rAnn'); hide('eAnn');
    try {
      var angolo = ANGOLI[Math.floor(Math.random() * ANGOLI.length)];
      var raw = await callAI({
        type: 'text',
        creative: true,
        prompt: 'Scrivi un annuncio Vinted in italiano, tono ' + selTone + ', per questo capo:\n' +
          '- Capo: ' + (val('aNome') || 'Non specificato') + '\n' +
          '- Marca: ' + (val('aMarca') || 'Non specificata') + '\n' +
          '- Taglia: ' + (val('aTaglia') || 'Non specificata') + '\n' +
          '- Condizione: ' + val('aCond') + '\n' +
          '- Colore: ' + (val('aColore') || 'Non specificato') + '\n' +
          '- Materiale: ' + (val('aMat') || 'Non specificato') + '\n' +
          '- Dettagli: ' + (val('aNote') || 'Nessuno') + vintageHint() + '\n\n' +
          'Per la descrizione, ' + angolo + ' — non iniziare sempre allo stesso modo.\n\n' +
          'REGOLE IMPORTANTI per non suonare generico o da pubblicità:\n' +
          '- Vietate frasi fatte tipo "capo must-have", "perfetto per ogni occasione", "pezzo unico nel suo genere", "dona un tocco di classe", "ideale per ogni stagione", o qualunque frase che potrebbe andare bene per QUALSIASI capo\n' +
          '- Ogni frase deve contenere almeno un dettaglio CONCRETO preso dai dati sopra (il colore esatto, il materiale, un dettaglio delle note, l\'occasione d\'uso specifica per quel tipo di capo)\n' +
          '- Scrivi come lo scriverebbe una persona reale che vende un proprio vestito, non un copywriter pubblicitario\n' +
          '- Massimo 1 emoji in tutta la descrizione, zero se il tono è "professionale ed elegante"\n' +
          '- Se non hai abbastanza dettagli specifici, sii onesto e breve piuttosto che riempire con frasi vuote\n\n' +
          'Rispondi SOLO con questo JSON valido, senza backtick né markdown, nessun testo prima o dopo:\n' +
          '{"titolo":"max 60 caratteri, specifico non generico","descrizione":"3-5 frasi concrete","hashtag":"10 hashtag separati da spazio, es #tag1 #tag2"}'
      });

      var d = parseModelJson(raw);
      if (!d) {
        // Il modello non ha risposto in JSON: mostriamo comunque il testo grezzo.
        lastAnnuncio = { titolo: '', descrizione: raw, hashtag: '' };
        setText('rAnnTitolo', '');
        setText('rAnnDesc', raw);
        setText('rAnnHash', '');
        show('rAnn');
        return;
      }

      lastAnnuncio = { titolo: d.titolo || '', descrizione: d.descrizione || '', hashtag: d.hashtag || '' };
      setText('rAnnTitolo', lastAnnuncio.titolo);
      setText('rAnnDesc', lastAnnuncio.descrizione);
      setText('rAnnHash', lastAnnuncio.hashtag);
      show('rAnn');

      if (!currentItemId) currentItemId = 'item_' + Date.now();
      upsertHistoryItem(currentItemId, {
        nome: val('aNome'), marca: val('aMarca'), taglia: val('aTaglia'), condizione: val('aCond'),
        titolo: lastAnnuncio.titolo, descrizione: lastAnnuncio.descrizione, hashtag: lastAnnuncio.hashtag,
        foto: lastThumbnail || undefined
      });
    } catch (e) {
      setText('eAnn', '⚠️ ' + e.message);
      show('eAnn');
    } finally {
      hide('lAnn');
    }
  }

  function annuncioTesto() {
    if (!lastAnnuncio) return '';
    return [lastAnnuncio.titolo, lastAnnuncio.descrizione, lastAnnuncio.hashtag]
      .filter(Boolean).join('\n\n');
  }

  function shareAnnuncio() {
    var txt = annuncioTesto();
    if (!txt) { toast('⚠️ Genera prima un annuncio'); return; }
    if (navigator.share) {
      navigator.share({ title: 'Annuncio Vinted', text: txt }).catch(function () { /* annullato */ });
    } else {
      copyFrom('rAnnDesc');
    }
  }

  function openVinted() {
    var titolo = lastAnnuncio ? lastAnnuncio.titolo : '';
    if (titolo && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(titolo).catch(function () { /* non bloccante */ });
    }
    window.open('https://www.vinted.it/items/new', '_blank', 'noopener');
    toast(titolo ? '✅ Titolo copiato — incollalo su Vinted!' : '🛍️ Vinted aperto');
  }

  /* ---------- 3. stima prezzo ---------- */
  function num(x, fallback) {
    var n = typeof x === 'number' ? x : parseFloat(x);
    return isFinite(n) ? n : fallback;
  }

  async function stimaPrezzo() {
    show('lPre'); hide('rPre'); hide('ePre');
    var bar = $('pBar');
    if (bar) bar.style.width = '0%';
    try {
      var raw = await callAI({
        type: 'text',
        prompt: 'Sei un esperto di second-hand e resell sul mercato italiano, con conoscenza approfondita di Vinted Italia.\n' +
          'Analizza questi dati e stima il prezzo di rivendita REALISTICO su Vinted Italia:\n\n' +
          'CAPO: ' + (val('pNome') || 'Non specificato') + '\n' +
          'MARCA: ' + (val('pMarca') || 'Non specificata') + '\n' +
          'CONDIZIONE: ' + val('pCond') + '\n' +
          'PREZZO ORIGINALE: ' + (val('pPrezzo') ? val('pPrezzo') + '€' : 'Non noto') + '\n' +
          'ANNO ACQUISTO: ' + (val('pAnno') || 'Non noto') + '\n' +
          'CATEGORIA: ' + (val('pCat') || 'Abbigliamento') + '\n\n' +
          'Considera attentamente:\n' +
          '1. POPOLARITÀ DEL BRAND su Vinted Italia (brand luxury, streetwear, fast fashion hanno valori molto diversi)\n' +
          '2. DEPREZZAMENTO reale (fast fashion perde 60-80% del valore, luxury 20-40%)\n' +
          '3. CONDIZIONE (nuovo con etichetta vale molto di più di "buono")\n' +
          '4. STAGIONALITÀ (un cappotto in estate vale meno)\n' +
          '5. DOMANDA ATTUALE su Vinted per quel tipo di capo\n' +
          '6. CONCORRENZA (quanti articoli simili ci sono su Vinted)\n' +
          '7. Se il brand non è noto, stima in base alla categoria e condizione\n' +
          '8. Dai un prezzo COMPETITIVO che venda velocemente, non il massimo teorico\n\n' +
          'Rispondi SOLO con questo JSON valido senza backtick ne markdown:\n' +
          '{"prezzoSuggerito":25,"rangeMin":18,"rangeMax":35,"percentuale":60,"motivazione":"Spiegazione dettagliata del prezzo basata su dati reali Vinted","fattori":["Fattore specifico 1","Fattore specifico 2","Fattore specifico 3","Fattore specifico 4"],"consiglio":"Consiglio pratico specifico per vendere questo capo velocemente su Vinted"}'
      });

      var d = parseModelJson(raw);
      if (!d) throw new Error('Risposta AI in formato inatteso, riprova.');

      var prezzo = num(d.prezzoSuggerito, null);
      if (prezzo === null) throw new Error('L\'AI non ha restituito un prezzo valido, riprova.');
      var rMin = num(d.rangeMin, null);
      var rMax = num(d.rangeMax, null);
      var perc = Math.max(0, Math.min(100, num(d.percentuale, 55)));

      setText('pNum', prezzo + '€');
      setText('pRng', (rMin !== null && rMax !== null) ? 'range: ' + rMin + '€ – ' + rMax + '€' : '');
      setText('pMot', d.motivazione || '');
      setTimeout(function () { if (bar) bar.style.width = perc + '%'; }, 80);

      var fattori = Array.isArray(d.fattori) ? d.fattori : [];
      $('pFact').innerHTML = fattori.map(function (f) {
        return '<li class="fli"><span class="fdot"></span>' + esc(f) + '</li>';
      }).join('');

      var tip = $('pTip');
      if (d.consiglio) {
        tip.innerHTML = '💡 <strong>Consiglio:</strong> ' + esc(d.consiglio);
        tip.style.display = '';
      } else {
        tip.style.display = 'none';
      }
      show('rPre');

      if (!currentItemId) currentItemId = 'item_' + Date.now();
      upsertHistoryItem(currentItemId, {
        nome: val('pNome'), marca: val('pMarca'), condizione: val('pCond'),
        prezzoSuggerito: prezzo, rangeMin: rMin, rangeMax: rMax, consiglio: d.consiglio || '',
        foto: lastThumbnail || undefined
      });
    } catch (e) {
      setText('ePre', '⚠️ ' + e.message);
      show('ePre');
    } finally {
      hide('lPre');
    }
  }

  /* ---------- 4. storico (localStorage, solo su questo device) ---------- */
  function loadHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistoryArr(arr) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
    } catch (e) {
      toast('⚠️ Storico non salvato (spazio esaurito?)');
    }
  }

  function upsertHistoryItem(id, patch) {
    var arr = loadHistory();
    var idx = -1;
    for (var i = 0; i < arr.length; i++) { if (arr[i].id === id) { idx = i; break; } }
    if (idx >= 0) {
      arr[idx] = Object.assign({}, arr[idx], patch, { id: id, updatedAt: Date.now() });
    } else {
      arr.unshift(Object.assign({ id: id, createdAt: Date.now(), updatedAt: Date.now() }, patch));
    }
    saveHistoryArr(arr);
  }

  function deleteHistoryItem(id) {
    saveHistoryArr(loadHistory().filter(function (x) { return x.id !== id; }));
    renderHistory();
    toast('🗑️ Eliminato');
  }

  function clearHistoryConfirm() {
    if (!loadHistory().length) { toast('Storico già vuoto'); return; }
    if (confirm('Cancellare tutto lo storico salvato su questo dispositivo? L\'azione non è reversibile.')) {
      saveHistoryArr([]);
      renderHistory();
      toast('🗑️ Storico cancellato');
    }
  }

  function fmtDate(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
           d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }

  function historyItemHtml(item) {
    var thumb = (typeof item.foto === 'string' && item.foto.indexOf('data:image/') === 0)
      ? '<img src="' + esc(item.foto) + '" class="hThumb" alt=""/>'
      : '';
    var prezzo = '';
    if (typeof item.prezzoSuggerito === 'number') {
      var range = (typeof item.rangeMin === 'number' && typeof item.rangeMax === 'number')
        ? ' <span class="hRange">(range ' + item.rangeMin + '€–' + item.rangeMax + '€)</span>'
        : '';
      prezzo = '<div class="hPrice">' + item.prezzoSuggerito + '€' + range + '</div>';
    }
    return '<div class="hItem">' +
      '<div class="hTop">' + thumb +
        '<div class="hMain">' +
          '<div class="hName">' + (esc(item.nome) || 'Capo senza nome') + (item.marca ? ' · ' + esc(item.marca) : '') + '</div>' +
          '<div class="hSub">' + esc(item.condizione) + (item.taglia ? ' · Taglia ' + esc(item.taglia) : '') + '</div>' +
        '</div>' +
        '<button class="hDel" type="button" data-action="del-history" data-id="' + esc(item.id) + '" aria-label="Elimina" title="Elimina">×</button>' +
      '</div>' +
      (item.titolo ? '<div class="hTitolo">' + esc(item.titolo) + '</div>' : '') +
      (item.descrizione ? '<div class="hDesc">' + esc(item.descrizione) + '</div>' : '') +
      (item.hashtag ? '<div class="hDesc hHash">' + esc(item.hashtag) + '</div>' : '') +
      prezzo +
      (item.consiglio ? '<div class="hSub hTipRow">💡 ' + esc(item.consiglio) + '</div>' : '') +
      '<div class="hDate">' + fmtDate(item.updatedAt || item.createdAt) + '</div>' +
    '</div>';
  }

  function renderHistory() {
    var arr = loadHistory().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    $('historyEmpty').style.display = arr.length ? 'none' : '';
    $('historyList').innerHTML = arr.map(historyItemHtml).join('');
  }

  /* ---------- wiring ---------- */
  var ACTIONS = {
    'tab': function (el) { switchTab(el.dataset.tab); },
    'analyze': analyzePhoto,
    'del-file': function (el) { delFile(parseInt(el.dataset.index, 10)); },
    'copy': function (el) { copyFrom(el.dataset.target); },
    'to-annuncio': toAnnuncio,
    'gen-annuncio': genAnnuncio,
    'share-annuncio': shareAnnuncio,
    'open-vinted': openVinted,
    'stima-prezzo': stimaPrezzo,
    'clear-history': clearHistoryConfirm,
    'del-history': function (el) { deleteHistoryItem(el.dataset.id); }
  };

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var fn = ACTIONS[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el); }
  });

  document.getElementById('fileInput').addEventListener('change', onFilesChosen);

  Array.prototype.forEach.call(document.querySelectorAll('#toneChips .chip'), function (c) {
    c.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('#toneChips .chip'), function (x) {
        x.classList.remove('on');
        x.setAttribute('aria-pressed', 'false');
      });
      c.classList.add('on');
      c.setAttribute('aria-pressed', 'true');
      selTone = c.dataset.t;
    });
  });

  // Il tasto "Condividi" ha senso solo dove esiste la Web Share API.
  if (!navigator.share) {
    var shareBtn = document.querySelector('[data-action="share-annuncio"]');
    if (shareBtn) shareBtn.style.display = 'none';
  }

  window.addEventListener('pagehide', clearPreviewUrls);
})();
