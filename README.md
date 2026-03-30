# Print Server - Electivo de Fotografía y Multimedia (Local)

Servidor local para el electivo de fotografía y multimedia escolar. Permite a los alumnos subir fotos desde sus teléfonos, visualizarlas en una galería en tiempo real, y al profesor imprimirlas desde un panel de administración.

- Node.js 20 + Express 4
- SQLite con `better-sqlite3`
- Carga de fotos desde dispositivo móvil (alumnos) y desde el panel admin (profesora)
- Galería pública en tiempo real con SSE
- **Likes en fotos**: botón ♥ por IP (toggle), contador en tiempo real, ordenación por popularidad
- **Perfiles de alumno**: lista cerrada de alumnos por curso, vinculación por `device_token` sin login
- **Mis fotos**: panel personal del alumno, filtro por mes, selección de foto del mes
- **Foto del mes**: página pública con la foto elegida por cada alumno por mes; override del profesor
- Panel administrador: impresión, eliminación, exportación de reportes, gestión de alumnos y foto del mes
- **Tamaños de impresión**: tamaño completo / 20×15 cm / 7×10 cm con redimensionado automático vía ImageMagick
- **Backup ZIP**: descarga todas las fotos organizadas por `curso/alumno/` desde el panel admin
- **Auditoría de tokens**: tabla que cruza foto → alumno del job → alumno vinculado al token, con flags de discrepancia y detección de múltiples dispositivos
- Impresión vía CUPS con `lp` (custom page-width/page-height en puntos PostScript)
- WiFi AP local con **WPA2**, **portal cautivo** y servicio systemd para arranque automático
- Diseño responsive (mobile-first), dark theme / **tema Sakura por defecto**

## Estructura de carpetas

```
print-server/
├── server.js
├── config.js
├── db/
│   ├── database.js
│   └── schema.sql
├── routes/
│   ├── upload.js
│   ├── gallery.js
│   ├── admin.js
│   ├── print.js
│   └── events.js
├── middleware/
│   └── auth.js
├── public/
│   ├── css/
│   │   ├── tailwind.min.css
│   │   └── app.css
│   ├── js/
│   │   └── theme.js
│   ├── uploads/          ← excluido del rsync en actualizaciones
│   ├── index.html
│   ├── gallery.html
│   ├── mis-fotos.html
│   ├── foto-del-mes.html
│   ├── admin-login.html
│   └── admin.html
├── scripts/
│   ├── generate-password.js
│   └── setup.sh
├── package.json
└── .env.example
```

## Requisitos de configuración

- `ADMIN_PASSWORD`: hash bcrypt (usar `scripts/generate-password.js`)
- `SESSION_SECRET`: string secreto para cookies
- `PORT`: puerto HTTP (por defecto `3000`)
- `PRINTER_NAME`: nombre CUPS de la impresora (ej. `Brother-DCP-L3551CDW`)
- `UPLOAD_DIR`: `public/uploads`
- `MAX_FILE_SIZE_MB`: tamaño máximo de archivo (por defecto `20`)

## .env (ejemplo)

```ini
PORT=3000
ADMIN_PASSWORD=$2b$12$...HASH...
SESSION_SECRET=algo-muy-secreto
PRINTER_NAME=Brother-DCP-L3551CDW
UPLOAD_DIR=public/uploads
MAX_FILE_SIZE_MB=20
```

## Prerrequisitos

Antes de instalar el proyecto, asegúrate de tener lo siguiente:

### Node.js 20+

**Ubuntu/Debian:**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # debe mostrar v20.x.x
```

**Windows:**

Descarga el instalador LTS desde https://nodejs.org e instálalo. Verifica con:

```cmd
node --version
npm --version
```

---

### ImageMagick (necesario para redimensionar fotos al imprimir)

```bash
sudo apt install -y imagemagick
```

Verifica que `convert` esté disponible:

```bash
convert --version
```

---

### CUPS (sistema de impresión) — solo Linux

```bash
sudo apt install -y cups
sudo systemctl enable cups
sudo systemctl start cups
```

Añade tu usuario al grupo `lp` para poder imprimir sin root:

```bash
sudo usermod -aG lp $USER
```

Configura tu impresora en http://localhost:631 y anota el nombre CUPS (lo necesitarás en `.env`).

---

### Herramientas de compilación (necesarias para `better-sqlite3`)

**Ubuntu/Debian:**

```bash
sudo apt update && sudo apt install -y build-essential python3
```

**Windows:**

Instala el workload **"Desarrollo para escritorio con C++"** de Visual Studio Build Tools:

```cmd
winget install Microsoft.VisualStudio.2022.BuildTools
```

O descárgalo desde https://visualstudio.microsoft.com/visual-cpp-build-tools/

---

### Git (opcional, para clonar el repositorio)

**Ubuntu/Debian:**

```bash
sudo apt install -y git
```

**Windows:**

```cmd
winget install Git.Git
```

---

## Instalación automatizada (recomendado)

El script `scripts/setup.sh` automatiza toda la instalación en Linux:

```bash
sudo bash scripts/setup.sh
```

Opciones del menú:

| Opción | Descripción |
|--------|-------------|
| `[1]` | Instalación completa (deps + servidor + WiFi AP + portal cautivo) |
| `[2]` | Solo servidor (sin WiFi AP) |
| `[3]` | Solo WiFi AP + portal cautivo |
| `[4]` | Solo dependencias del sistema |
| `[5]` | Actualizar servidor (recopia archivos y reinicia) |
| `[6]` | Reconfigurar `.env` (nueva contraseña / impresora) |
| `[7]` | Configurar impresora (detectar USB, registrar en CUPS y actualizar `.env`) |

El script se encarga de:
- Instalar Node.js 20, CUPS y herramientas de compilación
- Generar el hash bcrypt de la contraseña de forma interactiva
- Crear el archivo `.env` con todos los valores
- Crear el usuario `print-server` y copiar el proyecto a `/opt/print-server`
- Configurar el servicio systemd con arranque automático
- Configurar el WiFi AP (hostapd + dnsmasq + netplan) con IP `192.168.1.10`
- Activar **WPA2 por defecto** (con opción explícita a red abierta)
- Configurar **portal cautivo**: DNS wildcard + iptables redirige puerto 80 → 3000, para que al conectar al WiFi el dispositivo abra automáticamente el portal
- Guardar reglas iptables con `netfilter-persistent` para que persistan tras reinicios

Todo queda habilitado al inicio: `print-server`, `hostapd`, `dnsmasq`, `cups` y `netfilter-persistent` se inician automáticamente sin intervención manual.

> **Importante**: la opción `[5]` (actualizar) preserva automáticamente las fotos subidas (`public/uploads/`) y la base de datos (`db/*.db`) — no se borran al hacer `git pull` + actualizar.

---

## Instalación manual

### Instalar dependencias npm

```bash
cd /ruta/del/proyecto
npm install
```

### Generar hash de contraseña

```bash
node scripts/generate-password.js
```

Copiar `ADMIN_PASSWORD` al `.env`.

## Ejecutar servidor

```bash
npm start
```

## Rutas principales

### Alumnos (público)
- `GET /` → portal de upload de alumnos
- `POST /upload` → recibe foto; acepta `alumno_id` + `device_token` (modo alumno) o `alumno` + `curso` (modo legado)
- `GET /gallery` → galería en tiempo real
- `GET /mis-fotos` → panel personal del alumno (fotos propias + foto del mes)
- `GET /foto-del-mes` → página pública con la foto del mes de cada alumno
- `GET /api/jobs` → datos JSON de la galería (incluye `like_count`)
- `GET /api/alumnos` → lista de alumnos activos (id, nombre, curso) para el formulario de upload
- `GET /api/mis-fotos?token=...` → fotos del token + mapa de fotos del mes
- `POST /api/foto-del-mes` → el alumno elige su foto del mes (solo mes actual, foto propia)
- `GET /api/foto-del-mes?mes=YYYY-MM` → fotos del mes elegidas (público)
- `GET /api/foto-del-mes/meses` → meses con al menos una foto elegida (público)
- `POST /like/:id` → toggle like/unlike (deduplicado por IP)
- `GET /events` → SSE para actualizaciones en tiempo real

### Administración (requiere sesión)
- `GET /admin/login` → formulario de login
- `POST /admin/login` → autenticación
- `POST /admin/logout` → cerrar sesión
- `GET /admin` → panel (tabs: Fotos / Alumnos / Foto del mes / Auditoría)
- `GET /admin/api/jobs` → historial completo con `print_history`, `fdm_mes` y `fdm_elegida_por`
- `GET /admin/api/audit` → tabla de auditoría: foto → alumno del job → alumno del token
- `GET /admin/api/backup` → descarga ZIP de todas las fotos organizadas por `curso/alumno/`
- `POST /admin/print/:id` → enviar foto a imprimir (acepta `size`: `full` | `20x15` | `10x7`)
- `DELETE /admin/jobs/:id` → eliminar foto y registro (borra archivo del disco)
- `GET /admin/report` → exportar reporte HTML con rango de fechas
- `GET /admin/api/alumnos` → lista de alumnos con sus tokens (incluye `ip_primer_uso`)
- `POST /admin/api/alumnos` → crear alumno individual
- `POST /admin/api/alumnos/import` → importar CSV (`nombre,curso`)
- `PATCH /admin/api/alumnos/:id/activo` → activar/desactivar alumno
- `PATCH /admin/api/tokens/:token/desactivar` → desactivar un dispositivo
- `PATCH /admin/api/tokens/:token/reasignar` → mover token a otro alumno
- `GET /admin/api/foto-del-mes?mes=YYYY-MM` → fotos del mes (con datos de alumno)
- `GET /admin/api/foto-del-mes/meses` → meses disponibles
- `POST /admin/api/foto-del-mes/override` → el profesor marca foto del mes para un alumno

## Base de datos (SQLite)

- `jobs`: id, filename, original_name, alumno, curso, status, print_count, uploaded_at, **owner_token**, **mes_local**
- `print_log`: id, job_id, printed_at
- `likes`: id, job_id, ip, created_at — con restricción `UNIQUE(job_id, ip)` para deduplicar por IP
- `alumnos`: id, nombre, curso, activo — lista cerrada de alumnos del electivo
- `device_tokens`: token, alumno_id, ip_primer_uso, ua_primer_uso, vinculado_at, activo — un alumno puede tener múltiples tokens
- `foto_del_mes`: id, alumno_id, job_id, mes (YYYY-MM), elegida_at, elegida_por ('alumno'|'profesor') — con `UNIQUE(alumno_id, mes)`

> Al eliminar un job se borran en cascada los registros de `print_log`, `likes` y `foto_del_mes` antes de borrar el job y el archivo físico.

> `mes_local` se calcula en Node.js con hora local del servidor al momento del INSERT, evitando que el offset UTC desplace una foto al mes siguiente.

## Descripción de módulos

- `db/database.js` — better-sqlite3 (síncrono). Funciones para jobs, alumnos, device_tokens y foto_del_mes. Incluye migración `ALTER TABLE` idempotente para DBs existentes. `getAdminJobs()` retorna `fdm_mes`/`fdm_elegida_por` vía JOIN. `getAuditJobs()` cruza jobs con device_tokens y alumnos para auditoría.
- `routes/events.js` — SSE: mantiene conexiones abiertas, expone `broadcast(eventName, data)`
- `routes/upload.js` — multer + validación + inserción en DB + vinculación de device_token + broadcast `new-photo`
- `routes/gallery.js` — galería pública, mis-fotos, foto-del-mes, API JSON y toggle de likes
- `routes/admin.js` — login, panel, jobs, print router, gestión de alumnos, tokens, foto del mes, auditoría y backup ZIP
- `routes/print.js` — ImageMagick + `lp` + actualizaciones DB + broadcast `print-update`
- `middleware/auth.js` — `requireAdmin` (verifica sesión)
- `public/js/theme.js` — toggle tema oscuro / Sakura (guarda preferencia en `localStorage`; **Sakura es el tema por defecto**)

## Frontend

### `public/index.html` — Portal de alumnos
- Selector de curso dinámico (cargado desde `/api/alumnos`)
- Selector de nombre filtrado por curso (lista cerrada, sin texto libre)
- `device_token` generado en `localStorage` automáticamente; se reenvía en cada upload
- Si el alumno ya usó el formulario, su nombre queda preseleccionado
- Zona de upload con drag & drop y preview de imagen
- Toast animado tras subida exitosa; el formulario se resetea automáticamente
- Links a galería, mis fotos, foto del mes y panel admin

### `public/gallery.html` — Galería pública
- Grid responsive de fotos con overlay (nombre y curso del alumno)
- Filtros: búsqueda por alumno, por curso, por mes y por popularidad
- Selector de orden: **Más recientes** / **Más populares**
- Botón ♥ (like) en cada card con animación y estado en `localStorage`
- Lightbox con navegación por flechas, teclado y swipe táctil
- Badge "NUEVO" en fotos recién subidas (SSE)
- Link a "Foto del mes"

### `public/mis-fotos.html` — Panel personal del alumno
- Identificación automática por `device_token` en `localStorage`
- Si el dispositivo no tiene token registrado → mensaje con link a subir foto
- Selector de mes (solo meses donde el alumno tiene fotos)
- Indicador mes abierto (actual) / cerrado (pasados)
- Banner con la foto del mes elegida; nota especial si fue seleccionada por el profesor
- Grid de fotos: tap en mes abierto = seleccionar para foto del mes; doble tap = lightbox
- Barra inferior con "Elegir como foto del mes" / Cancelar
- El alumno puede cambiar su elección mientras el mes esté abierto

### `public/foto-del-mes.html` — Galería pública de foto del mes
- Selector de mes (solo meses con fotos elegidas)
- Filtro por curso
- Grid de cards con foto, nombre y curso del alumno
- Lightbox con navegación
- Se preselecciona el mes actual si tiene fotos

### `public/admin-login.html` — Login admin
- Formulario de contraseña con feedback de error inline

### `public/admin.html` — Panel de administración
- **Tab Fotos**: tabla/cards de jobs con filtros, impresión, eliminación, botón ⭐ que muestra el mes si la foto está marcada como foto del mes
- **Tab Alumnos**: importación CSV (`nombre,curso`), alta manual, lista con tokens completos por alumno (clic para copiar), IP del primer uso, badge ⚠ si el token tiene fotos de otro alumno; activar/desactivar alumnos y dispositivos
- **Tab Foto del mes**: grid por mes y curso con las fotos elegidas; lightbox usando las fotos del mes (no del tab Fotos); botón "Cambiar" abre modal de override
- **Tab Auditoría**: tabla foto → alumno del job → token → alumno vinculado al token; flags `⚠ nombre distinto` (naranja) y `⚠ 2+ dispositivos` (violeta); filtro por texto y checkbox "Solo discrepancias"
- **Modal override**: preview de la foto, selector de alumno y de mes (últimos 12); pide confirmación si ya hay selección; registra `elegida_por = 'profesor'`
- **Backup ZIP**: botón "📦 Backup ZIP" descarga todas las fotos organizadas por `curso/alumno/archivo`
- Exportación de reportes HTML por rango de fechas
- Indicador de conexión SSE (punto verde/amarillo)

## Sistema de perfiles de alumno

Los alumnos se identifican sin login mediante un `device_token` (UUID) generado en `localStorage`:

1. El profesor carga la lista de alumnos desde el panel admin (CSV o alta manual)
2. El alumno selecciona su nombre de un `<select>` filtrado por curso al subir la primera foto
3. El `device_token` queda vinculado al `alumno_id` elegido; se guarda la IP y User-Agent como auditoría
4. En visitas posteriores el mismo dispositivo se reconoce automáticamente
5. Si un alumno cambia de dispositivo, el profesor puede reasignar el token viejo al nuevo desde el panel admin (tab Alumnos)
6. Un alumno puede tener múltiples tokens activos (varios dispositivos)

## Foto del mes

- Cada alumno puede elegir **una foto** como su "foto del mes" mientras el mes esté abierto (mes calendario actual)
- El mes se determina por `mes_local`, calculado en Node.js con hora local del servidor al insertar la foto
- El alumno puede cambiar su elección antes del cierre del mes (fin del mes calendario)
- El profesor puede hacer override desde el panel admin: elige la foto, el alumno y el mes (libre, sin restricción)
- Si el profesor hizo el override, el alumno ve "Foto del mes seleccionada por tu profesor" y no puede cambiarla
- La página pública `/foto-del-mes` muestra las fotos elegidas filtradas por mes y curso

## Auditoría de tokens

El tab **Auditoría** del panel admin permite detectar irregularidades:

| Flag | Descripción |
|------|-------------|
| `⚠ nombre distinto` | El alumno registrado en el job difiere del alumno vinculado al token que subió la foto |
| `⚠ 2+ dispositivos` | El alumno vinculado al token tiene fotos subidas desde más de un token distinto |

La fila se resalta en naranja tenue cuando hay algún flag. El filtro "Solo discrepancias" muestra únicamente las filas problemáticas.

## SSE (Server-Sent Events)

`GET /events` mantiene una conexión abierta por cliente.

| Evento | Payload | Efecto en clientes |
|---|---|---|
| `connected` | `{ clientId }` | Confirmación de conexión |
| `new-photo` | datos del job | Galería agrega foto; admin recarga lista |
| `print-update` | `{ id, print_count, status }` | Admin actualiza estado del job |
| `delete-photo` | `{ id }` | Galería elimina la card; admin recarga lista |

## Mecanismo de impresión

`POST /admin/print/:id` acepta un body JSON con el campo `size`:

```json
{ "size": "20x15" }
```

`routes/print.js` redimensiona la foto con ImageMagick y ejecuta `lp`:

| `size` | Foto (px @ 300dpi) | Canvas enviado a la impresora | Papel |
|--------|-------------------|-------------------------------|-------|
| `full` | sin cambio | sin cambio | papel cargado (escala automática) |
| `20x15` | 1772×2362 | 1772×2362 | 15×20 cm (425×567 pt) |
| `10x7` | 827×1181 centrada | 1181×2126 | 10×18 cm (284×510 pt) |

Para `10x7`: la foto de 7×10 cm queda centrada sobre un canvas blanco del tamaño exacto del papel (10×18 cm), evitando que la impresora escale o recorte.

Post impresión:
- `incrementPrintCount(id)` → `status = 'printed'`
- `logPrint(id)`
- `broadcast('print-update', { id, print_count, status })`

## Backup de fotos

`GET /admin/api/backup` genera y descarga un ZIP en streaming con todas las fotos organizadas:

```
backup-2026-03-29.zip
  Sin Curso/
    David Ubilla Torres/
      foto.jpg
      foto_2.jpg      ← numerado si hay nombre duplicado
  1ro A/
    Ana García/
      captura.jpg
```

El nombre de cada archivo es el `original_name` almacenado al subir la foto. El botón "📦 Backup ZIP" en el panel admin dispara la descarga directamente desde el navegador.

## Manejo de errores

- Respuestas JSON con `{ success, error }` en rutas API (400/401/403/404/500)
- Middleware global 404 + 500 en `server.js`
- Errores de multer manejados en `upload.js` (tamaño, tipo de archivo)

## Deployment: arranque automático

Todo el deployment se configura con el script `[1]` o `[2]`. Los servicios que quedan habilitados al inicio:

| Servicio | Función |
|---|---|
| `print-server` | Servidor Node.js (systemd) |
| `hostapd` | WiFi Access Point |
| `dnsmasq` | DHCP + DNS del portal cautivo |
| `cups` | Sistema de impresión |
| `netfilter-persistent` | Restaura reglas iptables (portal cautivo) |

Verificar estado de todos los servicios:

```bash
for svc in print-server hostapd dnsmasq cups netfilter-persistent; do
    printf "%-24s %s\n" "$svc" "$(systemctl is-active $svc)"
done
```

Ver logs del servidor:

```bash
sudo journalctl -u print-server -f
```

## Actualizar el servidor (git pull)

```bash
# En la máquina de desarrollo
git pull
# Luego en el servidor Linux
sudo bash scripts/setup.sh  # → [5] Actualizar servidor
```

La opción `[5]` usa `rsync --delete` excluyendo:
- `public/uploads/` — fotos subidas por los alumnos
- `db/*.db`, `db/*.db-shm`, `db/*.db-wal` — base de datos SQLite

Las fotos y la base de datos **no se borran** en ninguna actualización.

## Pruebas rápidas

1. Subir foto (modo alumno):

```bash
curl -X POST http://localhost:3000/upload \
  -F "photo=@/ruta/a/foto.jpg" \
  -F "alumno_id=1" \
  -F "device_token=mi-uuid-aqui"
```

2. Subir foto (modo legado):

```bash
curl -X POST http://localhost:3000/upload \
  -F "photo=@/ruta/a/foto.jpg" \
  -F "alumno=Juan Pérez" \
  -F "curso=3 Medio A"
```

3. Ver trabajos (galería):

```bash
curl http://localhost:3000/api/jobs
```

4. Ver lista de alumnos:

```bash
curl http://localhost:3000/api/alumnos
```

5. Ver fotos del mes:

```bash
curl "http://localhost:3000/api/foto-del-mes?mes=2026-03"
```

6. Login admin + listar:

```bash
curl -c cookies.txt -H "Content-Type: application/json" \
  -d '{"password":"secreto"}' http://localhost:3000/admin/login
curl -b cookies.txt http://localhost:3000/admin/api/jobs
```

7. Importar alumnos CSV (admin):

```bash
curl -b cookies.txt -X POST http://localhost:3000/admin/api/alumnos/import \
  --data-binary @alumnos.csv \
  -H "Content-Type: text/plain"
```

8. Override foto del mes (admin):

```bash
curl -b cookies.txt -X POST http://localhost:3000/admin/api/foto-del-mes/override \
  -H "Content-Type: application/json" \
  -d '{"alumno_id":1,"job_id":5,"mes":"2026-03"}'
```

9. Imprimir (con selección de tamaño):

```bash
curl -b cookies.txt -X POST http://localhost:3000/admin/print/1 \
  -H "Content-Type: application/json" \
  -d '{"size":"20x15"}'
```

10. Toggle like en foto:

```bash
curl -X POST http://localhost:3000/like/1
# → { "success": true, "liked": true, "count": 1 }
```

11. Ver SSE:

```bash
curl -N http://localhost:3000/events
```

12. Descargar backup ZIP:

```bash
curl -b cookies.txt -o backup.zip http://localhost:3000/admin/api/backup
```

## Cambiar de impresora

La opción `[7]` del script automatiza todo el proceso:

```bash
sudo bash scripts/setup.sh  # → [7] Configurar impresora
```

**Proceso manual** (si se prefiere):

```bash
# 1. Conectar la nueva impresora y obtener su URI
sudo lpinfo -v | grep -i usb

# 2. Registrar en CUPS
sudo lpadmin -p NUEVAIMPRESORA \
    -v "ipp://Brother%20NombreModelo%20series%20(USB)._ipp._tcp.local/" \
    -m everywhere -E

# 3. Actualizar .env y reiniciar
sudo sed -i 's/^PRINTER_NAME=.*/PRINTER_NAME=NUEVAIMPRESORA/' /opt/print-server/.env
sudo systemctl restart print-server
```

---

## Notas

- `UPLOAD_DIR` debe apuntar a `public/uploads` para que las imágenes sean servidas por Express.
- Modo offline: sin Internet. No se usan CDNs ni scripts externos.
- `better-sqlite3` es síncrono (no usa async/await).
- Al eliminar un job, el archivo físico se borra del disco y los registros de `print_log`, `likes` y `foto_del_mes` se eliminan antes de borrar el job.
- La migración de columnas (`owner_token`, `mes_local`) se aplica automáticamente al arrancar si la DB ya existía.
- Los cursos ya no son lista fija en el HTML: se gestionan desde el panel admin al cargar alumnos.
- ImageMagick (`convert`) debe estar instalado en el servidor para los formatos 20×15 y 7×10. El formato "completo" no lo requiere.
- El tema Sakura es el predeterminado para todos los usuarios que no hayan guardado preferencia. Se puede cambiar con el botón 🌸/🌙 en cualquier página.

---

## Contacto

Implementación para el Electivo de Fotografía y Multimedia escolar. Para ajustes de impresora o red, editar `config.js` y `server.js` según lo descrito.
