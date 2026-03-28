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

module.exports = router;
