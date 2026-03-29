const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const db = require('../db/database');
const { broadcast } = require('./events');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadDir),
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${timestamp}-${random}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (config.allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de archivo no permitido. Solo JPG, PNG o WEBP.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.maxFileSizeMB * 1024 * 1024 }
});

router.post('/', upload.single('photo'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No se recibió ninguna imagen.' });
  }

  // Soporte para dos modos:
  // - Modo alumno (nuevo): envía alumno_id + device_token
  // - Modo legado / profesor: envía alumno + curso como texto libre
  const alumno_id   = req.body.alumno_id ? Number(req.body.alumno_id) : null;
  const device_token = (req.body.device_token || '').trim() || null;

  let alumno, curso;

  if (alumno_id) {
    const alumnoRow = db.getAlumnoById(alumno_id);
    if (!alumnoRow) {
      return res.status(400).json({ success: false, error: 'Alumno no encontrado.' });
    }
    alumno = alumnoRow.nombre;
    curso  = alumnoRow.curso;

    // Vincular token si viene y no está registrado aún
    if (device_token) {
      const existing = db.getTokenInfo(device_token);
      if (!existing) {
        db.vincularToken({
          token: device_token,
          alumno_id,
          ip: req.ip,
          ua: req.headers['user-agent'] || null,
        });
      }
    }
  } else {
    alumno = (req.body.alumno || '').trim();
    curso  = (req.body.curso  || '').trim();
    if (!alumno) return res.status(400).json({ success: false, error: 'El nombre del alumno es obligatorio.' });
    if (!curso)  return res.status(400).json({ success: false, error: 'El curso es obligatorio.' });
  }

  const job = db.createJob({
    filename: req.file.filename,
    original_name: req.file.originalname,
    alumno,
    curso,
    owner_token: device_token,
  });

  broadcast('new-photo', {
    id: job.id,
    filename: job.filename,
    alumno: job.alumno,
    curso: job.curso,
    uploaded_at: job.uploaded_at,
  });

  return res.json({
    success: true,
    message: '¡Foto subida exitosamente!',
    job: {
      id: job.id,
      alumno: job.alumno,
      curso: job.curso,
    }
  });
});

router.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, error: `El archivo supera el límite de ${config.maxFileSizeMB}MB.` });
  }
  return res.status(400).json({ success: false, error: err.message || 'Error al procesar el archivo.' });
});

module.exports = router;
