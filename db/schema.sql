CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  alumno TEXT NOT NULL,
  curso TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  print_count INTEGER NOT NULL DEFAULT 0,
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  owner_token TEXT,
  mes_local TEXT
);

CREATE TABLE IF NOT EXISTS alumnos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  curso TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  UNIQUE(nombre, curso)
);

CREATE TABLE IF NOT EXISTS device_tokens (
  token TEXT PRIMARY KEY,
  alumno_id INTEGER NOT NULL REFERENCES alumnos(id),
  ip_primer_uso TEXT,
  ua_primer_uso TEXT,
  vinculado_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS foto_del_mes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alumno_id INTEGER NOT NULL REFERENCES alumnos(id),
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  mes TEXT NOT NULL,
  elegida_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  elegida_por TEXT NOT NULL DEFAULT 'alumno',
  UNIQUE(alumno_id, mes)
);

CREATE TABLE IF NOT EXISTS print_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  printed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS likes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id     INTEGER NOT NULL REFERENCES jobs(id),
  ip         TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(job_id, ip)
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_uploaded_at ON jobs(uploaded_at);
CREATE INDEX IF NOT EXISTS idx_jobs_mes_local ON jobs(mes_local);
CREATE INDEX IF NOT EXISTS idx_jobs_owner_token ON jobs(owner_token);
CREATE INDEX IF NOT EXISTS idx_print_log_job_id ON print_log(job_id);
CREATE INDEX IF NOT EXISTS idx_likes_job_id ON likes(job_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_alumno_id ON device_tokens(alumno_id);
CREATE INDEX IF NOT EXISTS idx_foto_del_mes_mes ON foto_del_mes(mes);
CREATE INDEX IF NOT EXISTS idx_foto_del_mes_alumno_id ON foto_del_mes(alumno_id);
