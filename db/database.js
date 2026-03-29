const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'print-server.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Migraciones incrementales — ALTER TABLE es idempotente via try/catch
// porque SQLite no soporta IF NOT EXISTS en ALTER TABLE.
const migrations = [
  "ALTER TABLE jobs ADD COLUMN owner_token TEXT",
  "ALTER TABLE jobs ADD COLUMN mes_local TEXT",
];
for (const sql of migrations) {
  try { db.exec(sql); } catch (_) { /* columna ya existe */ }
}

function getAllJobs() {
  return db.prepare('SELECT * FROM jobs ORDER BY uploaded_at DESC').all();
}

function getJobById(id) {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
}

function getPendingJobs() {
  return db.prepare("SELECT * FROM jobs WHERE status = 'pending' ORDER BY uploaded_at ASC").all();
}

function createJob({ filename, original_name, alumno, curso, owner_token = null }) {
  // uploaded_at se guarda como ISO UTC; mes_local se calcula en Node con hora local
  // del servidor para evitar que el offset UTC-3/UTC-4 desplace la foto al mes siguiente.
  const now = new Date();
  const mes_local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const uploaded_at = now.toISOString();
  const stmt = db.prepare(
    "INSERT INTO jobs (filename, original_name, alumno, curso, uploaded_at, owner_token, mes_local) " +
    "VALUES (@filename, @original_name, @alumno, @curso, @uploaded_at, @owner_token, @mes_local)"
  );
  const result = stmt.run({ filename, original_name, alumno, curso, uploaded_at, owner_token, mes_local });
  return getJobById(result.lastInsertRowid);
}

function incrementPrintCount(id) {
  db.prepare("UPDATE jobs SET print_count = print_count + 1, status = 'printed' WHERE id = ?").run(id);
}

function logPrint(jobId) {
  db.prepare('INSERT INTO print_log (job_id) VALUES (?)').run(jobId);
}

function getPrintHistory(jobId) {
  return db.prepare('SELECT printed_at FROM print_log WHERE job_id = ? ORDER BY printed_at DESC').all(jobId);
}

function getGalleryJobs() {
  return db.prepare(`
    SELECT j.id, j.filename, j.alumno, j.curso, j.uploaded_at,
           COUNT(l.id) AS like_count
    FROM jobs j
    LEFT JOIN likes l ON l.job_id = j.id
    GROUP BY j.id
    ORDER BY j.uploaded_at DESC
  `).all();
}

function getAdminJobs() {
  const jobs = db.prepare(`
    SELECT j.*, COUNT(l.id) AS like_count
    FROM jobs j
    LEFT JOIN likes l ON l.job_id = j.id
    GROUP BY j.id
    ORDER BY j.uploaded_at DESC
  `).all();
  const historyStmt = db.prepare('SELECT printed_at FROM print_log WHERE job_id = ? ORDER BY printed_at DESC');
  return jobs.map(job => ({
    ...job,
    print_history: historyStmt.all(job.id).map(r => r.printed_at),
  }));
}

function toggleLike(jobId, ip) {
  const existing = db.prepare('SELECT id FROM likes WHERE job_id = ? AND ip = ?').get(jobId, ip);
  if (existing) {
    db.prepare('DELETE FROM likes WHERE job_id = ? AND ip = ?').run(jobId, ip);
  } else {
    db.prepare('INSERT INTO likes (job_id, ip) VALUES (?, ?)').run(jobId, ip);
  }
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM likes WHERE job_id = ?').get(jobId);
  return { liked: !existing, count };
}

// ── Alumnos ──────────────────────────────────────────────────────────────────

function getAllAlumnos() {
  return db.prepare('SELECT * FROM alumnos WHERE activo = 1 ORDER BY curso, nombre').all();
}

function getAlumnoById(id) {
  return db.prepare('SELECT * FROM alumnos WHERE id = ?').get(id);
}

function createAlumno({ nombre, curso }) {
  const stmt = db.prepare('INSERT OR IGNORE INTO alumnos (nombre, curso) VALUES (@nombre, @curso)');
  const result = stmt.run({ nombre, curso });
  if (result.changes === 0) {
    return db.prepare('SELECT * FROM alumnos WHERE nombre = ? AND curso = ?').get(nombre, curso);
  }
  return getAlumnoById(result.lastInsertRowid);
}

function importAlumnos(lista) {
  // lista: [{ nombre, curso }, ...]
  const stmt = db.prepare('INSERT OR IGNORE INTO alumnos (nombre, curso) VALUES (@nombre, @curso)');
  const insertMany = db.transaction((alumnos) => {
    for (const a of alumnos) stmt.run(a);
  });
  insertMany(lista);
}

function setAlumnoActivo(id, activo) {
  db.prepare('UPDATE alumnos SET activo = ? WHERE id = ?').run(activo ? 1 : 0, id);
}

// ── Device tokens ─────────────────────────────────────────────────────────────

function getTokenInfo(token) {
  return db.prepare(`
    SELECT dt.*, a.nombre, a.curso
    FROM device_tokens dt
    JOIN alumnos a ON a.id = dt.alumno_id
    WHERE dt.token = ?
  `).get(token);
}

function vincularToken({ token, alumno_id, ip, ua }) {
  db.prepare(`
    INSERT OR IGNORE INTO device_tokens (token, alumno_id, ip_primer_uso, ua_primer_uso)
    VALUES (@token, @alumno_id, @ip, @ua)
  `).run({ token, alumno_id, ip: ip || null, ua: ua || null });
  return getTokenInfo(token);
}

function getTokensByAlumno(alumno_id) {
  return db.prepare('SELECT * FROM device_tokens WHERE alumno_id = ?').all(alumno_id);
}

function reasignarTokens(token_viejo, alumno_id_nuevo) {
  db.prepare('UPDATE device_tokens SET alumno_id = ? WHERE token = ?').run(alumno_id_nuevo, token_viejo);
}

function desactivarToken(token) {
  db.prepare('UPDATE device_tokens SET activo = 0 WHERE token = ?').run(token);
}

// ── Foto del mes ──────────────────────────────────────────────────────────────

function getFotoDelMesByAlumnoMes(alumno_id, mes) {
  return db.prepare(`
    SELECT f.*, j.filename, j.alumno, j.curso
    FROM foto_del_mes f
    JOIN jobs j ON j.id = f.job_id
    WHERE f.alumno_id = ? AND f.mes = ?
  `).get(alumno_id, mes);
}

function setFotoDelMes({ alumno_id, job_id, mes, elegida_por }) {
  const elegida_at = new Date().toISOString();
  db.prepare(`
    INSERT INTO foto_del_mes (alumno_id, job_id, mes, elegida_at, elegida_por)
    VALUES (@alumno_id, @job_id, @mes, @elegida_at, @elegida_por)
    ON CONFLICT(alumno_id, mes) DO UPDATE SET
      job_id = excluded.job_id,
      elegida_at = excluded.elegida_at,
      elegida_por = excluded.elegida_por
  `).run({ alumno_id, job_id, mes, elegida_at, elegida_por });
  return getFotoDelMesByAlumnoMes(alumno_id, mes);
}

function getAllFotoDelMesByAlumno(alumno_id) {
  return db.prepare(`
    SELECT f.*, j.filename
    FROM foto_del_mes f
    JOIN jobs j ON j.id = f.job_id
    WHERE f.alumno_id = ?
    ORDER BY f.mes DESC
  `).all(alumno_id);
}

function getFotosDelMes(mes) {
  return db.prepare(`
    SELECT f.*, j.filename, j.alumno, j.curso, a.nombre AS alumno_nombre, a.curso AS alumno_curso
    FROM foto_del_mes f
    JOIN jobs j ON j.id = f.job_id
    JOIN alumnos a ON a.id = f.alumno_id
    WHERE f.mes = ?
    ORDER BY a.curso, a.nombre
  `).all(mes);
}

function getMesesConFotoDelMes() {
  return db.prepare(`
    SELECT DISTINCT mes FROM foto_del_mes ORDER BY mes DESC
  `).all().map(r => r.mes);
}

// ── Jobs por token ────────────────────────────────────────────────────────────

function getJobsByToken(token) {
  return db.prepare(`
    SELECT j.id, j.filename, j.alumno, j.curso, j.uploaded_at, j.mes_local,
           COUNT(l.id) AS like_count
    FROM jobs j
    LEFT JOIN likes l ON l.job_id = j.id
    WHERE j.owner_token = ?
    GROUP BY j.id
    ORDER BY j.uploaded_at DESC
  `).all(token);
}

function getJobsByDateRange(fromUtc, toUtc) {
  // fromUtc y toUtc son ISO strings UTC (ej. "2026-03-28T03:00:00.000Z")
  // que representan el inicio y fin del día en hora Santiago.
  // La comparación directa funciona porque uploaded_at también es ISO UTC.
  return db.prepare(
    'SELECT id, filename, alumno, curso, uploaded_at FROM jobs ' +
    'WHERE uploaded_at >= ? AND uploaded_at <= ? ' +
    'ORDER BY uploaded_at ASC'
  ).all(fromUtc, toUtc);
}

function deleteJob(id) {
  db.prepare('DELETE FROM print_log WHERE job_id = ?').run(id);
  db.prepare('DELETE FROM likes WHERE job_id = ?').run(id);
  db.prepare('DELETE FROM foto_del_mes WHERE job_id = ?').run(id);
  db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
}

module.exports = {
  // jobs
  getAllJobs,
  getJobById,
  getPendingJobs,
  createJob,
  incrementPrintCount,
  logPrint,
  getPrintHistory,
  getGalleryJobs,
  getAdminJobs,
  deleteJob,
  getJobsByDateRange,
  getJobsByToken,
  toggleLike,
  // alumnos
  getAllAlumnos,
  getAlumnoById,
  createAlumno,
  importAlumnos,
  setAlumnoActivo,
  // device tokens
  getTokenInfo,
  vincularToken,
  getTokensByAlumno,
  reasignarTokens,
  desactivarToken,
  // foto del mes
  getFotoDelMesByAlumnoMes,
  getAllFotoDelMesByAlumno,
  setFotoDelMes,
  getFotosDelMes,
  getMesesConFotoDelMes,
};
