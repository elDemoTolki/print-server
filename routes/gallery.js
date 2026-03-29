const express = require('express');
const path = require('path');
const db = require('../db/database');
const router = express.Router();

router.get('/gallery', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/gallery.html'));
});

router.get('/mis-fotos', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/mis-fotos.html'));
});

router.get('/foto-del-mes', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/foto-del-mes.html'));
});

// API pública: fotos del mes (para la página pública)
router.get('/api/foto-del-mes', (req, res) => {
  const mes = (req.query.mes || '').trim();
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ success: false, error: 'Parámetro mes inválido (formato YYYY-MM).' });
  }
  const rows = db.getFotosDelMes(mes);
  return res.json(rows);
});

// API pública: meses disponibles con al menos una foto del mes
router.get('/api/foto-del-mes/meses', (req, res) => {
  const meses = db.getMesesConFotoDelMes();
  return res.json(meses);
});

// Devuelve las fotos del token + info del alumno vinculado + foto del mes por mes
router.get('/api/mis-fotos', (req, res) => {
  const token = (req.query.token || '').trim();
  if (!token) return res.status(400).json({ success: false, error: 'Token requerido.' });

  const tokenInfo = db.getTokenInfo(token);
  if (!tokenInfo) {
    return res.json({ success: true, alumno: null, jobs: [], fotoDelMes: {} });
  }

  const jobs = db.getJobsByToken(token);

  // Mapa mes → foto_del_mes elegida para este alumno
  const fotoDelMesRows = db.getAllFotoDelMesByAlumno(tokenInfo.alumno_id);
  const fotoDelMes = {};
  fotoDelMesRows.forEach(f => { fotoDelMes[f.mes] = f; });

  return res.json({
    success: true,
    alumno: { id: tokenInfo.alumno_id, nombre: tokenInfo.nombre, curso: tokenInfo.curso },
    jobs,
    fotoDelMes,
  });
});

router.get('/api/jobs', (req, res) => {
  const jobs = db.getGalleryJobs();
  res.json(jobs);
});

router.post('/like/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: 'ID inválido.' });
  }
  const ip = req.ip || req.socket.remoteAddress;
  const result = db.toggleLike(id, ip);
  return res.json({ success: true, ...result });
});

// El alumno elige su foto del mes (mes abierto)
router.post('/api/foto-del-mes', (req, res) => {
  const { token, job_id, mes } = req.body;
  if (!token || !job_id || !mes) {
    return res.status(400).json({ success: false, error: 'Faltan parámetros.' });
  }
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ success: false, error: 'Mes inválido.' });
  }

  // Solo se permite en el mes actual
  const now = new Date();
  const mesActual = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  if (mes !== mesActual) {
    return res.status(403).json({ success: false, error: 'Solo puedes elegir foto del mes actual.' });
  }

  const tokenInfo = db.getTokenInfo(token);
  if (!tokenInfo) {
    return res.status(403).json({ success: false, error: 'Token no reconocido.' });
  }

  // Verificar que la foto le pertenece al alumno
  const job = db.getJobById(Number(job_id));
  if (!job || job.owner_token !== token) {
    return res.status(403).json({ success: false, error: 'La foto no pertenece a este dispositivo.' });
  }

  // Si ya existe una foto del mes elegida por el profesor, no se puede reemplazar
  const existing = db.getFotoDelMesByAlumnoMes(tokenInfo.alumno_id, mes);
  if (existing && existing.elegida_por === 'profesor') {
    return res.status(403).json({ success: false, error: 'Tu foto del mes fue elegida por tu profesor y no puede cambiarse.' });
  }

  const fotaDelMes = db.setFotoDelMes({
    alumno_id:  tokenInfo.alumno_id,
    job_id:     Number(job_id),
    mes,
    elegida_por: 'alumno',
  });

  return res.json({ success: true, fotaDelMes });
});

module.exports = router;
