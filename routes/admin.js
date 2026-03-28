const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const config = require('../config');
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');
const printRouter = require('./print');
const { broadcast } = require('./events');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.redirect('/admin');
  }
  return res.sendFile(path.join(__dirname, '../public/admin-login.html'));
});

router.post('/login', async (req, res) => {
  const password = (req.body.password || '').toString();
  if (!password) {
    return res.status(400).json({ success: false, error: 'Contraseña requerida.' });
  }

  try {
    const valid = await bcrypt.compare(password, config.adminPassword);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Contraseña incorrecta.' });
    }

    req.session.isAdmin = true;
    return res.json({ success: true, redirect: '/admin' });
  } catch (err) {
    console.error('Error login admin:', err);
    return res.status(500).json({ success: false, error: 'Error interno.' });
  }
});

router.post('/logout', requireAdmin, (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

router.get('/', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

router.get('/api/jobs', requireAdmin, (req, res) => {
  const jobs = db.getAdminJobs();
  res.json(jobs);
});

router.delete('/jobs/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const job = db.getJobById(id);
  if (!job) return res.status(404).json({ success: false, error: 'Trabajo no encontrado.' });

  const filePath = path.join(config.uploadDir, job.filename);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.error('Error eliminando archivo:', err);
  }

  db.deleteJob(id);
  broadcast('delete-photo', { id });
  return res.json({ success: true });
});

router.use('/print', printRouter);

module.exports = router;
