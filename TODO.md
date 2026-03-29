# Ideas futuras — Electivo de Fotografía y Multimedia

Funcionalidades pendientes de implementar, ordenadas por complejidad estimada.

---

## ~~1. Likes / Estrellas en fotos~~ ✅ Implementado

Permitir que los visitantes de la galería reaccionen a las fotos con un like o una valoración por estrellas.

**Implementado:**
- Tabla `likes` en SQLite: `id, job_id, ip, created_at` con UNIQUE(job_id, ip) (deduplicación por IP)
- Endpoint `POST /like/:id` (toggle like/unlike)
- Contador de likes en cada card de la galería con estado persistido en localStorage
- Ordenar galería por popularidad (selector "Más recientes / Más populares")
- En el panel admin, columna Likes en tabla y tarjetas móviles

---

## 2. Panel de alumno — ver y eliminar fotos propias

Que cada alumno pueda acceder a una vista personalizada con sus fotos y eliminarlas si lo desea.

**Ideas de implementación:**
- Identificación ligera del alumno: token generado al subir la primera foto, guardado en `localStorage`
- Ruta `GET /mis-fotos` → muestra solo las fotos asociadas al token del dispositivo
- Ruta `DELETE /mis-fotos/:id` → validación de que el token coincide con el dueño del job
- Alternativa más simple: al subir la foto, mostrar un enlace con token de acceso único para gestionar esa foto

---

## 3. Datos adicionales al subir imagen

Permitir que el alumno ingrese más información junto con la foto.

**Campos sugeridos:**
- **Título de la fotografía** (nombre artístico de la imagen)
- **Comentario / descripción** (técnica usada, contexto, etc.)

**Cambios requeridos:**
- Agregar columnas `titulo` y `comentario` a la tabla `jobs` en `schema.sql`
- Actualizar `routes/upload.js` para recibir y guardar los nuevos campos
- Mostrar título y comentario en el lightbox de la galería
- Mostrar en el panel admin

---

## ~~4. Filtro por mes~~ ✅ Implementado

Agregar un selector de mes en la galería y en el panel admin para filtrar las fotos por período.

**Ideas de implementación:**
- Filtro en el frontend: extraer mes/año de `uploaded_at` y agrupar
- Selector tipo `<select>` con los meses disponibles (generado dinámicamente desde los datos)
- Combinable con los filtros de alumno y curso ya existentes
- En admin, útil para revisar producción por mes

---

## 5. Log de dispositivo por imagen (trazabilidad)

Registrar información del dispositivo que subió cada imagen para poder rastrear el origen en caso de contenido inapropiado.

**Datos a registrar:**
- IP del cliente (`req.ip`)
- User-Agent del navegador (`req.headers['user-agent']`)
- Timestamp exacto

**Cambios requeridos:**
- Agregar columnas `uploader_ip` y `uploader_ua` a la tabla `jobs`
- Registrar los datos en `routes/upload.js` al crear el job
- Mostrar esta información en el panel admin (columna oculta o sección de detalle al expandir un job)
- Considerar implicancias de privacidad: informar en los términos de uso de la plataforma

---

## 6. Votación — Foto del mes

El profesor habilita una votación desde el panel admin seleccionando las fotos candidatas. Los alumnos votan desde la galería y el profesor ve el ranking final para elegir las ganadoras.

**Flujo completo:**
1. Profesor selecciona fotos candidatas desde el panel admin y activa la votación
2. En la galería aparece un banner "Votación activa — elige tus 3 favoritas"
3. Cada alumno (identificado por cookie/localStorage) puede votar hasta 3 fotos distintas
4. El profesor puede ver en tiempo real el ranking de votos en el panel admin
5. El profesor desactiva la votación y anuncia las 3 ganadoras (las marca como ganadoras)
6. Las ganadoras se destacan visualmente en la galería

**Tablas nuevas sugeridas:**
```sql
CREATE TABLE polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME
);

CREATE TABLE poll_candidates (
  poll_id INTEGER NOT NULL REFERENCES polls(id),
  job_id  INTEGER NOT NULL REFERENCES jobs(id),
  winner  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (poll_id, job_id)
);

CREATE TABLE poll_votes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id    INTEGER NOT NULL REFERENCES polls(id),
  job_id     INTEGER NOT NULL REFERENCES jobs(id),
  voter_token TEXT NOT NULL,
  voted_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

**Rutas nuevas sugeridas:**
- `POST /admin/poll` → crear votación con fotos seleccionadas
- `DELETE /admin/poll/:id` → cerrar votación
- `PATCH /admin/poll/:id/winners` → marcar ganadoras
- `GET /admin/poll/:id/results` → ranking de votos
- `POST /gallery/vote` → alumno emite su voto (valida token + máximo 3 votos)
- `GET /gallery/poll` → estado actual de la votación (activa/inactiva, candidatas)

---

*Última actualización: 2026-03-28*
