const express = require('express');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const bcrypt = require('bcrypt');
const sharp = require('sharp');
const config = require('../config');
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');
const printRouter = require('./print');
const { broadcast } = require('./events');

// ── Report helpers ────────────────────────────────────────────────────────────

const MESES_ES = ['enero','febrero','marzo','abril','mayo','junio',
                  'julio','agosto','septiembre','octubre','noviembre','diciembre'];

function escHtmlReport(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDateLabel(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${parseInt(d)} de ${MESES_ES[parseInt(m,10)-1]} de ${y}`;
}

function fmtDateTimeChile(str) {
  const utc = str.includes('Z') || str.includes('+')
    ? str : str.replace(' ', 'T') + 'Z';
  return new Date(utc).toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function buildReportHtml(jobs, from, to) {
  const dateLabel = from === to
    ? fmtDateLabel(from)
    : `${fmtDateLabel(from)} al ${fmtDateLabel(to)}`;

  const generatedAt = new Date().toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const cards = jobs.map(job => `
    <div class="card">
      ${job.base64
        ? `<img src="${job.base64}" alt="${escHtmlReport(job.alumno)}" />`
        : `<div class="no-img">Imagen no disponible</div>`}
      <div class="card-info">
        <p class="card-name">${escHtmlReport(job.alumno)}</p>
        <p class="card-course">${escHtmlReport(job.curso)}</p>
        <p class="card-date">${fmtDateTimeChile(job.uploaded_at)}</p>
      </div>
    </div>`).join('\n');

  const emptyState = jobs.length === 0
    ? `<div class="empty">No hay fotos en este período.</div>` : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Informe — ${escHtmlReport(dateLabel)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: #f2f2f2;
      color: #1a1a1a;
      -webkit-font-smoothing: antialiased;
    }
    .report-header {
      background: #111;
      color: #fff;
      padding: 36px 24px 32px;
      text-align: center;
    }
    .report-header .eyebrow {
      font-size: 0.7rem;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #777;
      margin-bottom: 10px;
    }
    .report-header h1 {
      font-size: clamp(1.4rem, 3vw, 2.2rem);
      font-weight: 800;
      letter-spacing: -0.02em;
      margin-bottom: 8px;
    }
    .report-header .date-label {
      color: #f0c040;
      font-size: 1.05rem;
      font-weight: 600;
      margin-bottom: 10px;
    }
    .report-header .total {
      display: inline-block;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.12);
      color: #aaa;
      font-size: 0.82rem;
      padding: 4px 14px;
      border-radius: 100px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 20px;
      padding: 28px 20px;
      max-width: 1280px;
      margin: 0 auto;
    }
    .card {
      background: #fff;
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 2px 16px rgba(0,0,0,0.07);
    }
    .card img {
      width: 100%;
      display: block;
      max-height: 380px;
      object-fit: contain;
      background: #f6f6f6;
    }
    .no-img {
      width: 100%;
      height: 200px;
      background: #eee;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #bbb;
      font-size: 0.85rem;
    }
    .card-info {
      padding: 14px 16px 16px;
      border-top: 1px solid #f0f0f0;
    }
    .card-name {
      font-size: 1rem;
      font-weight: 700;
      margin-bottom: 3px;
    }
    .card-course {
      font-size: 0.82rem;
      color: #888;
      margin-bottom: 6px;
    }
    .card-date {
      font-size: 0.76rem;
      color: #bbb;
    }
    .empty {
      text-align: center;
      padding: 60px 20px;
      color: #aaa;
      font-size: 1rem;
    }
    .report-footer {
      text-align: center;
      padding: 28px;
      color: #ccc;
      font-size: 0.76rem;
      border-top: 1px solid #e4e4e4;
      margin-top: 8px;
    }
    @media (max-width: 480px) {
      .grid { grid-template-columns: 1fr; gap: 14px; padding: 16px; }
    }
    @media print {
      body { background: #fff; }
      .report-header {
        background: #111 !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .report-header .date-label { color: #f0c040 !important; }
      .grid { gap: 14px; padding: 12px; }
      .card { break-inside: avoid; box-shadow: none; border: 1px solid #ddd; }
    }
  </style>
</head>
<body>
  <div class="report-header">
    <p class="eyebrow">Electivo de Fotografía y Multimedia</p>
    <h1>Informe Fotográfico</h1>
    <p class="date-label">${escHtmlReport(dateLabel)}</p>
    <span class="total">${jobs.length} ${jobs.length === 1 ? 'foto' : 'fotos'}</span>
  </div>

  <div class="grid">${cards}</div>
  ${emptyState}

  <div class="report-footer">
    Generado el ${escHtmlReport(generatedAt)}
  </div>
</body>
</html>`;
}

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

router.get('/api/audit', requireAdmin, (_req, res) => {
  res.json(db.getAuditJobs());
});

// ── Backup: descarga ZIP de todas las fotos organizadas por curso/alumno ──────
router.get('/api/backup', requireAdmin, (_req, res) => {
  const jobs = db.getAllJobs();
  const date = new Date().toISOString().slice(0, 10);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="backup-${date}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', err => {
    if (!res.headersSent) res.status(500).end();
    else res.end();
    console.error('Error generando backup:', err);
  });
  archive.pipe(res);

  // Sanitizar nombre de carpeta (eliminar caracteres inválidos en paths)
  const safe = s => String(s || 'Sin datos').replace(/[/\\:*?"<>|]/g, '_').trim() || '_';

  // Contar archivos por ruta para detectar duplicados y numerar
  const seen = new Map();
  for (const job of jobs) {
    const filePath = path.join(config.uploadDir, job.filename);
    if (!fs.existsSync(filePath)) continue;

    const curso  = safe(job.curso  || 'Sin Curso');
    const alumno = safe(job.alumno || 'Sin Nombre');
    const ext    = path.extname(job.original_name || job.filename) || '.jpg';
    const base   = path.basename(job.original_name || job.filename, ext);
    const key    = `${curso}/${alumno}/${base}${ext}`;
    const count  = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    const entryName = count === 1 ? key : `${curso}/${alumno}/${base}_${count}${ext}`;

    archive.file(filePath, { name: entryName });
  }

  archive.finalize();
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

// Convierte "YYYY-MM-DD HH:MM:SS" hora Santiago a UTC ISO string,
// manejando correctamente el horario de verano/invierno de Chile.
function santiagoToUtc(dateStr, timeStr) {
  const probe = new Date(`${dateStr}T${timeStr}Z`);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(probe).reduce((a, p) => p.type !== 'literal' ? { ...a, [p.type]: p.value } : a, {});
  const localAsUtc = new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
  return new Date(probe.getTime() + (probe - localAsUtc)).toISOString();
}

router.get('/report', requireAdmin, async (req, res) => {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const from = req.query.from || today;
  const to   = req.query.to   || today;

  if (!from.match(/^\d{4}-\d{2}-\d{2}$/) || !to.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return res.status(400).send('Fechas inválidas.');
  }

  const fromUtc = santiagoToUtc(from, '00:00:00');
  const toUtc   = santiagoToUtc(to,   '23:59:59');
  const jobs = db.getJobsByDateRange(fromUtc, toUtc);

  const jobsWithImages = await Promise.all(jobs.map(async (job) => {
    const filePath = path.join(config.uploadDir, job.filename);
    try {
      const buf = await sharp(filePath)
        .resize({ width: 800, withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
      return { ...job, base64: `data:image/jpeg;base64,${buf.toString('base64')}` };
    } catch {
      return { ...job, base64: null };
    }
  }));

  const html = buildReportHtml(jobsWithImages, from, to);
  const filename = from === to
    ? `informe-${from}.html`
    : `informe-${from}-al-${to}.html`;

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

router.use('/print', printRouter);

// ── Alumnos ───────────────────────────────────────────────────────────────────

router.get('/api/alumnos', requireAdmin, (req, res) => {
  const alumnos = db.getAllAlumnos();
  // Adjuntar tokens activos a cada alumno
  const result = alumnos.map(a => ({
    ...a,
    tokens: db.getTokensByAlumno(a.id),
  }));
  res.json(result);
});

router.post('/api/alumnos', requireAdmin, (req, res) => {
  const nombre = (req.body.nombre || '').trim();
  const curso  = (req.body.curso  || '').trim();
  if (!nombre || !curso) {
    return res.status(400).json({ success: false, error: 'Nombre y curso son obligatorios.' });
  }
  const alumno = db.createAlumno({ nombre, curso });
  return res.json({ success: true, alumno });
});

// Recibe el CSV como texto plano (Content-Type: text/plain) — sin multer
router.post('/api/alumnos/import', requireAdmin, express.text({ type: 'text/plain', limit: '1mb' }), (req, res) => {
  if (!req.body || !req.body.trim()) {
    return res.status(400).json({ success: false, error: 'No se recibió contenido CSV.' });
  }

  const text = req.body;
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Saltar encabezado si la primera línea contiene "nombre"
  const start = lines[0].toLowerCase().startsWith('nombre') ? 1 : 0;

  const lista = [];
  const errores = [];

  for (let i = start; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 2) { errores.push(`Línea ${i + 1}: formato inválido`); continue; }
    const nombre = parts[0].trim();
    const curso  = parts[1].trim();
    if (!nombre || !curso) { errores.push(`Línea ${i + 1}: nombre o curso vacío`); continue; }
    lista.push({ nombre, curso });
  }

  if (lista.length === 0) {
    return res.status(400).json({ success: false, error: 'El CSV no contiene filas válidas.', errores });
  }

  db.importAlumnos(lista);
  return res.json({ success: true, importados: lista.length, errores });
});

router.patch('/api/alumnos/:id/activo', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { activo } = req.body;
  if (activo === undefined) {
    return res.status(400).json({ success: false, error: 'Campo activo requerido.' });
  }
  db.setAlumnoActivo(id, activo);
  return res.json({ success: true });
});

// ── Device tokens ─────────────────────────────────────────────────────────────

router.patch('/api/tokens/:token/desactivar', requireAdmin, (req, res) => {
  db.desactivarToken(req.params.token);
  return res.json({ success: true });
});

router.patch('/api/tokens/:token/reasignar', requireAdmin, (req, res) => {
  const alumno_id = Number(req.body.alumno_id);
  if (!alumno_id) {
    return res.status(400).json({ success: false, error: 'alumno_id requerido.' });
  }
  db.reasignarTokens(req.params.token, alumno_id);
  return res.json({ success: true });
});

// ── Foto del mes (admin) ──────────────────────────────────────────────────────

// Listado por mes con filtro de curso
router.get('/api/foto-del-mes', requireAdmin, (req, res) => {
  const mes = (req.query.mes || '').trim();
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ success: false, error: 'Parámetro mes inválido (formato YYYY-MM).' });
  }
  const rows = db.getFotosDelMes(mes);
  return res.json(rows);
});

// Meses disponibles (con al menos una foto del mes elegida)
router.get('/api/foto-del-mes/meses', requireAdmin, (req, res) => {
  const meses = db.getMesesConFotoDelMes();
  return res.json(meses);
});

// Override del profesor: marcar foto del mes para un alumno
router.post('/api/foto-del-mes/override', requireAdmin, (req, res) => {
  const { alumno_id, job_id, mes } = req.body;
  if (!alumno_id || !job_id || !mes) {
    return res.status(400).json({ success: false, error: 'Faltan parámetros: alumno_id, job_id, mes.' });
  }
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ success: false, error: 'Formato de mes inválido (YYYY-MM).' });
  }

  const alumno = db.getAlumnoById(Number(alumno_id));
  if (!alumno) return res.status(404).json({ success: false, error: 'Alumno no encontrado.' });

  const job = db.getJobById(Number(job_id));
  if (!job) return res.status(404).json({ success: false, error: 'Foto no encontrada.' });

  const resultado = db.setFotoDelMes({
    alumno_id: Number(alumno_id),
    job_id:    Number(job_id),
    mes,
    elegida_por: 'profesor',
  });

  return res.json({ success: true, fotaDelMes: resultado });
});

module.exports = router;
