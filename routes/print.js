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
// 15×20 cm → ancho: (150/25.4)×300 = 1772 px  alto: (200/25.4)×300 = 2362 px
//  7×10 cm → ancho: ( 70/25.4)×300 =  827 px  alto: (100/25.4)×300 = 1181 px
// El media CUPS debe coincidir exactamente con el papel cargado en la impresora.
const PRINT_SIZES = {
  '20x15': { w: 1772, h: 2362, media: 'Custom.150x200mm' },
  '10x7':  { w:  827, h: 1181, media: 'Custom.70x100mm'  },
};

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
    let media = 'Custom.150x200mm';  // fallback si no viene size

    if (dims) {
      media    = dims.media;
      tempFile = path.join(os.tmpdir(), `print_${id}_${Date.now()}.jpg`);
      // Redimensiona manteniendo proporción, rellena con blanco hasta el tamaño exacto.
      // -auto-orient corrige la rotación EXIF antes de procesar.
      execSync(
        `convert "${filePath}" -auto-orient -resize ${dims.w}x${dims.h} -background white -gravity center -extent ${dims.w}x${dims.h} -units PixelsPerInch -density 300 "${tempFile}"`,
        { timeout: 30000 }
      );
      printPath = tempFile;
    }

    execSync(`lp -d "${config.printerName}" -o media=${media} -o print-scaling=none "${printPath}"`, { timeout: 20000 });
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
