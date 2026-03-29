const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'print-server.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

function getAllJobs() {
  return db.prepare('SELECT * FROM jobs ORDER BY uploaded_at DESC').all();
}

function getJobById(id) {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
}

function getPendingJobs() {
  return db.prepare("SELECT * FROM jobs WHERE status = 'pending' ORDER BY uploaded_at ASC").all();
}

function createJob({ filename, original_name, alumno, curso }) {
  // strftime con 'now' siempre es UTC; el sufijo Z lo marca explícitamente
  // para que cualquier parser JS lo interprete como UTC y convierta a hora local correctamente.
  const stmt = db.prepare(
    "INSERT INTO jobs (filename, original_name, alumno, curso, uploaded_at) " +
    "VALUES (@filename, @original_name, @alumno, @curso, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))"
  );
  const result = stmt.run({ filename, original_name, alumno, curso });
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

function getJobsByDateRange(from, to) {
  // date() en SQLite maneja tanto "YYYY-MM-DD HH:MM:SS" como "YYYY-MM-DDTHH:MM:SSZ"
  return db.prepare(
    'SELECT id, filename, alumno, curso, uploaded_at FROM jobs ' +
    'WHERE date(uploaded_at) >= ? AND date(uploaded_at) <= ? ' +
    'ORDER BY uploaded_at ASC'
  ).all(from, to);
}

function deleteJob(id) {
  db.prepare('DELETE FROM print_log WHERE job_id = ?').run(id);
  db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
}

module.exports = {
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
  toggleLike,
};
