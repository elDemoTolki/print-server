const express = require('express');
const path = require('path');
const { execSync } = require('child_process');
const config = require('../config');
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');
const { broadcast } = require('./events');

const MEDIA_SIZES = {
  '20x15': 'Custom.200x150mm',
  '10x7':  'Custom.100x70mm',
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

  try {
    const size  = req.body && MEDIA_SIZES[req.body.size];
    const media = size || '4x6';
    execSync(`lp -d "${config.printerName}" -o media=${media} -o fit-to-page "${filePath}"`, { timeout: 20000 });
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
  }
});

module.exports = router;
