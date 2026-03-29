const path = require('path');
const express = require('express');
const session = require('express-session');
const config = require('./config');

const eventsRouter = require('./routes/events');
const uploadRouter = require('./routes/upload');
const galleryRouter = require('./routes/gallery');
const adminRouter = require('./routes/admin');
const db = require('./db/database');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

app.use(express.static(path.join(__dirname, 'public')));

app.use('/events', eventsRouter);
app.use('/upload', uploadRouter);
app.use(galleryRouter);
app.use('/admin', adminRouter);

// Lista pública de alumnos activos para el formulario de upload
app.get('/api/alumnos', (req, res) => {
  const alumnos = db.getAllAlumnos();
  res.json(alumnos.map(a => ({ id: a.id, nombre: a.nombre, curso: a.curso })));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use((err, req, res, next) => {
  console.error('Error inesperado:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Error interno de servidor' });
});

app.listen(config.port, () => {
  console.log(`Print server corriendo en http://localhost:${config.port}`);
  console.log(`Subidas en: ${config.uploadDir}`);
});
