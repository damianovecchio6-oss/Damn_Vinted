#!/usr/bin/env node
// Ritaglia le pose della mascot e le prepara per la pagina.
//
// Gli originali stanno in arte/mascotte/ come escono da Procreate: 2360x1640,
// tratto bianco. Da li' escono i file di public/img/ che il CSS usa come
// MASCHERA - conta solo l'alpha, il colore lo mette il tema - quindi qui il
// disegno viene ridotto a "quanto e' opaco ogni pixel" e nient'altro.
//
// Due cose che sembrano dettagli e non lo sono:
//
// 1. Le pose si ritagliano tutte con LO STESSO riquadro, calcolato come unione
//    dei loro contorni. Ritagliata ognuna sul suo, la mascot cambierebbe
//    posizione e misura a ogni cambio di posa: invece di respirare, salterebbe.
//
// 2. Una posa col fondo rosa acceso non e' persa: il rosa e' piatto e il tratto
//    e' bianco, quindi l'opacita' si ricava dal colore (bianco = 1, rosa = 0) e
//    i bordi sfumati restano sfumati. Va detto con --rosa, perche' su un file
//    gia' trasparente lo stesso conto darebbe una sagoma piena.
//
// Uso:  node scripts/mascotte.js
// Serve sharp: npm i --no-save sharp

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const RADICE = path.join(__dirname, '..');
const ARTE = path.join(RADICE, 'arte', 'mascotte');
const USCITA = path.join(RADICE, 'public', 'img');
const LATO = 448;        // resa massima ~104px, per schermi a 4x
const MARGINE = 1.06;    // un filo d'aria intorno al disegno

// [file di partenza, nome in public/img, il fondo e' rosa?]
const POSE = [
  ['aperti.png',               'mascotte-a',          false],
  ['aperti-2-fondo-rosa.png',  'mascotte-b',          true],
  ['occhiolino.png',           'mascotte-occhiolino', false]
];

// Il rosa del canvas di Procreate, letto una volta dall'angolo del file.
const canale = (v, fondo) => Math.max(0, Math.min(255, Math.round((v - fondo) * 255 / (255 - fondo))));

async function alpha(file, rosa) {
  const img = sharp(file);
  const { width, height } = await img.metadata();
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(width * height * 4);
  let fondo = 0;
  if (rosa) {
    // L'angolo in alto a sinistra e' fondo per definizione: nessuno disegna li'.
    fondo = Math.min(data[1], data[2]);
  }
  for (let i = 0, p = 0; i < data.length; i += info.channels, p += 4) {
    const a = rosa
      ? canale(Math.min(data[i + 1], data[i + 2]), fondo)   // bianco = pieno, rosa = niente
      : data[i + 3];
    out[p] = out[p + 1] = out[p + 2] = 255;                 // la sagoma e' bianca: il colore lo mette il CSS
    out[p + 3] = a;
  }
  return { raw: out, width, height };
}

// Il rettangolo che contiene tutto il disegno, con una soglia bassa: sotto
// quella siamo nella sfumatura del pennello, non nel tratto.
function contorno({ raw, width, height }) {
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (raw[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  return { x0, y0, x1, y1 };
}

(async () => {
  const pose = [];
  for (const [file, nome, rosa] of POSE) {
    const percorso = path.join(ARTE, file);
    if (!fs.existsSync(percorso)) throw new Error('manca ' + percorso);
    const a = await alpha(percorso, rosa);
    pose.push({ nome, ...a, box: contorno(a) });
  }

  const u = pose.reduce((acc, p) => ({
    x0: Math.min(acc.x0, p.box.x0), y0: Math.min(acc.y0, p.box.y0),
    x1: Math.max(acc.x1, p.box.x1), y1: Math.max(acc.y1, p.box.y1)
  }), pose[0].box);

  // Quadrato: la mascot in pagina sta in una casella quadrata, e un ritaglio
  // rettangolare la schiaccerebbe o la lascerebbe storta dentro.
  const lato = Math.round(Math.max(u.x1 - u.x0, u.y1 - u.y0) * MARGINE);
  const cx = Math.round((u.x0 + u.x1) / 2), cy = Math.round((u.y0 + u.y1) / 2);
  const taglio = { left: cx - (lato >> 1), top: cy - (lato >> 1), width: lato, height: lato };

  fs.mkdirSync(USCITA, { recursive: true });
  for (const p of pose) {
    const base = sharp(p.raw, { raw: { width: p.width, height: p.height, channels: 4 } })
      .extract(taglio)
      .resize(LATO, LATO);
    await base.clone().webp({ quality: 86, effort: 6 }).toFile(path.join(USCITA, p.nome + '.webp'));
    await base.clone().png({ compressionLevel: 9 }).toFile(path.join(USCITA, p.nome + '.png'));
    console.log(p.nome, '->', LATO + 'px');
  }
  console.log('riquadro comune', taglio);
})().catch(e => { console.error(e.message || e); process.exit(1); });
