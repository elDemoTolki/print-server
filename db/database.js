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
  db.prepare('UPDATE jobs SET print_count = print_count + 1, status = "printed" WHERE id = ?').run(id);
}

function logPrint(jobId) {
  db.prepare('INSERT INTO print_log (job_id) VALUES (?)').run(jobId);
}

function getPrintHistory(jobId) {
  return db.prepare('SELECT printed_at FROM print_log WHERE job_id = ? ORDER BY printed_at DESC').all(jobId);
}

function getGalleryJobs() {
  return db.prepare('SELECT id, filename, alumno, curso, uploaded_at FROM jobs ORDER BY uploaded_at DESC').all();
}

function getAdminJobs() {
  const jobs = db.prepare('SELECT * FROM jobs ORDER BY uploaded_at DESC').all();
  const historyStmt = db.prepare('SELECT printed_at FROM print_log WHERE job_id = ? ORDER BY printed_at DESC');
  return jobs.map(job => ({
    ...job,
    print_history: historyStmt.all(job.id).map(r => r.printed_at),
  }));
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
};
