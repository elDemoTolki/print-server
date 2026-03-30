const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');
const config = require('../config');
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');
const { broadcast } = require('./events');

// Dimensiones en píxeles a 300 DPI — orientación PORTRAIT (alto > ancho).
// 15×20 cm → foto: 1772×2362 px  — papel 15×20 cm → 425×567 pt
// 10×18 cm → papel en impresora; foto 7×10 cm centrada en canvas 10×18 cm:
//   foto: 827×1181 px  canvas: 1181×2126 px
// page-width/page-height en puntos PostScript (1 pt = 25.4/72 mm):
//   100 mm → 284 pt  |  150 mm → 425 pt  |  180 mm → 510 pt  |  200 mm → 567 pt
//    70 mm → 198 pt
//
// w/h     = dimensiones del CANVAS que se envía a la impresora (debe coincidir con el papel)
// photoW/H = dimensiones de la foto dentro del canvas (si difieren de w/h)
// pw/ph   = página en PostScript points (igual que w/h pero en pt)
const PRINT_SIZES = {
  '20x15': { w: 1772, h: 2362, pw: 425, ph: 567 },
  // Papel 10×18 cm; foto 7×10 cm centrada con margen blanco
  '10x7':  { w: 1181, h: 2126, photoW: 827, photoH: 1181, pw: 284, ph: 510 },
};
// 'full': sin redimensionado — la impresora escala al tamaño del papel cargado.

const router = express.Router();

router.post('/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: 'ID inválido.' });
  }

  const job = db.getJobById(id);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Trabajo no encontrado.' });
  }

  const filePath = path.resolve(config.uploadDir, job.filename);

  let tempFile = null;
  try {
    const dims = req.body && PRINT_SIZES[req.body.size];

    let printPath = filePath;
    let lpOptions = '-o fit-to-page';  // 'full' or unknown: printer scales to loaded paper

    if (dims) {
      tempFile = path.join(os.tmpdir(), `print_${id}_${Date.now()}.jpg`);
      // -auto-orient corrige la rotación EXIF.
      // Si photoW/photoH existen, la foto se redimensiona a ese tamaño y se centra
      // sobre un canvas de dims.w×dims.h (= papel completo) con fondo blanco.
      // Si no existen, el canvas coincide con el tamaño de la foto.
      const photoW  = dims.photoW || dims.w;
      const photoH  = dims.photoH || dims.h;
      execSync(
        `convert "${filePath}" -auto-orient -resize ${photoW}x${photoH} -background white -gravity center -extent ${dims.w}x${dims.h} -units PixelsPerInch -density 300 "${tempFile}"`,
        { timeout: 30000 }
      );
      printPath = tempFile;
      lpOptions = `-o page-width=${dims.pw} -o page-height=${dims.ph} -o print-scaling=none`;
    }

    execSync(`lp -d "${config.printerName}" ${lpOptions} "${printPath}"`, { timeout: 20000 });
    db.incrementPrintCount(id);
    db.logPrint(id);

    const updatedJob = db.getJobById(id);

    broadcast('print-update', {
      id: updatedJob.id,
      print_count: updatedJob.print_count,
      status: updatedJob.status,
    });

    return res.json({
      success: true,
      message: `Enviado a imprimir: ${job.alumno} — ${job.curso}`,
      print_count: updatedJob.print_count,
    });
  } catch (err) {
    console.error(`Error al imprimir trabajo ${id}:`, err);

    if (err.message && err.message.includes('No such file')) {
      return res.status(500).json({ success: false, error: 'Archivo no encontrado en el servidor.' });
    }
    if (err.message && (err.message.includes('not found') || err.message.includes('Unknown printer'))) {
      return res.status(500).json({ success: false, error: `Impresora "${config.printerName}" no disponible. Verificar CUPS.` });
    }

    return res.status(500).json({ success: false, error: 'Error al enviar a la impresora. Verificar que CUPS esté activo.' });
  } finally {
    if (tempFile) try { fs.unlinkSync(tempFile); } catch {}
  }
});

module.exports = router;
