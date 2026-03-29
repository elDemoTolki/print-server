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

## ~~2. Panel de alumno — ver fotos propias~~ ✅ Implementado

Panel personal donde el alumno puede ver sus fotos filtradas por mes y elegir su foto del mes.

**Implementado:**
- Tabla `alumnos (id, nombre, curso, activo)` — lista cerrada gestionada por el profesor
- Tabla `device_tokens (token, alumno_id, ip_primer_uso, ua_primer_uso, vinculado_at, activo)` — vinculación sin login
- Formulario de upload con `<select>` de nombres filtrado por curso (sin texto libre)
- `device_token` UUID generado en `localStorage`, enviado transparente en cada upload
- IP y User-Agent guardados como auditoría al vincular el primer token
- Página `/mis-fotos`: fotos del alumno filtradas por mes, indicador mes abierto/cerrado
- El profesor puede reasignar tokens y desactivar dispositivos desde el panel admin (tab Alumnos)
- Importación de lista de alumnos desde CSV (`nombre,curso`) — sin duplicados

---

## ~~3. Datos adicionales al subir imagen~~ — Pendiente

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

**Implementado:**
- Filtro en el frontend: extrae mes/año de `uploaded_at` y agrupa
- Selector `<select>` con los meses disponibles (generado dinámicamente desde los datos)
- Combinable con los filtros de alumno y curso ya existentes
- En admin, útil para revisar producción por mes

---

## ~~5. Log de dispositivo por imagen (trazabilidad)~~ ✅ Implementado

Registrar información del dispositivo que subió cada imagen para rastrear el origen en caso de contenido inapropiado.

**Implementado:**
- `ip_primer_uso` y `ua_primer_uso` guardados en `device_tokens` al vincular el primer token
- `owner_token` en `jobs` permite trazar qué dispositivo subió cada foto
- Visible en el panel admin (tab Alumnos → tokens del alumno)

---

## ~~6. Votación — Foto del mes~~ ✅ Implementado

El alumno elige su foto del mes; el profesor puede hacer override y ver todas las selecciones.

**Implementado:**
- Tabla `foto_del_mes (id, alumno_id, job_id, mes TEXT, elegida_at, elegida_por)` con `UNIQUE(alumno_id, mes)`
- `mes_local` calculado en Node.js con hora local del servidor al insertar (evita desfase UTC)
- El alumno elige 1 foto por mes desde `/mis-fotos` mientras el mes esté abierto (mes calendario actual)
- Puede cambiar su elección antes del cierre; el mes se cierra automáticamente al cambiar el calendario
- El profesor hace override desde el panel admin: elige foto, alumno y mes (libre, sin restricción al mes actual)
- Si el profesor hizo el override, el alumno ve "Foto del mes seleccionada por tu profesor" y no puede cambiarla
- Panel admin tab "Foto del mes": grid filtrable por mes y curso, botón "Cambiar" por foto
- Página pública `/foto-del-mes`: grid de fotos elegidas filtrable por mes y curso, lightbox

---

*Última actualización: 2026-03-29*
