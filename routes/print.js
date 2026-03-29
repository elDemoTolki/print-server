const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');
const config = require('../config');
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');
const { broadcast } = require('./events');

// Dimensiones en píxeles a 300 DPI para cada tamaño de impresión.
// 20×15 cm → (200/25.4)×300 = 2362 × (150/25.4)×300 = 1772 px
// 10×7  cm → (100/25.4)×300 = 1181 × ( 70/25.4)×300 =  827 px
const PRINT_SIZES = {
  '20x15': { w: 2362, h: 1772 },
  '10x7':  { w: 1181, h:  827 },
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
    if (dims) {
      tempFile  = path.join(os.tmpdir(), `print_${id}_${Date.now()}.jpg`);
      // Redimensiona manteniendo proporción, rellena con blanco hasta el tamaño exacto
      execSync(
        `convert "${filePath}" -resize ${dims.w}x${dims.h} -background white -gravity center -extent ${dims.w}x${dims.h} -units PixelsPerInch -density 300 "${tempFile}"`,
        { timeout: 30000 }
      );
      printPath = tempFile;
    }

    execSync(`lp -d "${config.printerName}" -o media=iso_a4_210x297mm -o print-scaling=none "${printPath}"`, { timeout: 20000 });
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
