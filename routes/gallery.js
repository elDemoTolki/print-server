const express = require('express');
const path = require('path');
const db = require('../db/database');
const router = express.Router();

router.get('/gallery', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/gallery.html'));
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

module.exports = router;
