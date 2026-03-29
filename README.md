# Print Server - Electivo de Fotografía y Multimedia (Local)

Servidor local para el electivo de fotografía y multimedia escolar. Permite a los alumnos subir fotos desde sus teléfonos, visualizarlas en una galería en tiempo real, y al profesor imprimirlas desde un panel de administración.

- Node.js 20 + Express 4
- SQLite con `better-sqlite3`
- Carga de fotos desde dispositivo móvil (alumnos) y desde el panel admin (profesora)
- Galería pública en tiempo real con SSE
- **Likes en fotos**: botón ♥ por IP (toggle), contador en tiempo real, ordenación por popularidad
- Panel administrador: impresión, eliminación, exportación de reportes y subida de fotos
- Selección de tamaño de impresión al momento de imprimir (20×15 cm / 10×7 cm)
- Impresión driverless vía **IPP Everywhere** (sin drivers específicos por modelo)
- WiFi AP local con **WPA2**, **portal cautivo** y servicio systemd para arranque automático
- Diseño responsive (mobile-first), dark theme / tema Sakura

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
│   ├── uploads/
│   ├── index.html
│   ├── gallery.html
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
- `POST /upload` → recibe foto + campos `alumno`, `curso`
- `GET /gallery` → galería en tiempo real
- `GET /api/jobs` → datos JSON de la galería (incluye `like_count`)
- `POST /like/:id` → toggle like/unlike (deduplicado por IP)
- `GET /events` → SSE para actualizaciones en tiempo real

### Administración (requiere sesión)
- `GET /admin/login` → formulario de login
- `POST /admin/login` → autenticación
- `POST /admin/logout` → cerrar sesión
- `GET /admin` → panel de impresión
- `GET /admin/api/jobs` → historial completo con `print_history`
- `POST /admin/print/:id` → enviar foto a imprimir
- `DELETE /admin/jobs/:id` → eliminar foto y registro (borra archivo del disco)
- `GET /admin/report` → exportar reporte HTML con rango de fechas y filtros aplicados

## Base de datos (SQLite)

- `jobs`: id, filename, original_name, alumno, curso, status, print_count, uploaded_at
- `print_log`: id, job_id, printed_at
- `likes`: id, job_id, ip, created_at — con restricción `UNIQUE(job_id, ip)` para deduplicar por IP

> Al eliminar un job se borran primero sus registros en `print_log` y luego el job, más el archivo físico en `UPLOAD_DIR`.

## Descripción de módulos

- `db/database.js` — better-sqlite3 (síncrono). Funciones: `createJob`, `getJobById`, `getAdminJobs`, `getGalleryJobs`, `incrementPrintCount`, `logPrint`, `deleteJob`, `toggleLike`
- `routes/events.js` — SSE: mantiene conexiones abiertas, expone `broadcast(eventName, data)`
- `routes/upload.js` — multer + validación + inserción en DB + broadcast `new-photo`
- `routes/gallery.js` — galería pública, API JSON y toggle de likes (`POST /like/:id`)
- `routes/admin.js` — login, logout, panel, jobs admin, print router, delete job, generación de reporte HTML
- `routes/print.js` — `lp` + actualizaciones DB + broadcast `print-update`
- `middleware/auth.js` — `requireAdmin` (verifica sesión)
- `public/js/theme.js` — toggle tema oscuro / Sakura (guarda preferencia en `localStorage`)

## Frontend

### `public/index.html` — Portal de alumnos
- Zona de upload con drag & drop y preview de imagen
- Selector de curso (lista desplegable: 3 Medio A – F)
- Validación de campos antes de enviar
- Toast animado tras subida exitosa; el formulario se resetea automáticamente
- Links a galería y panel admin

### `public/gallery.html` — Galería pública
- Grid responsive de fotos con overlay (nombre y curso del alumno)
- Filtros: búsqueda por alumno, por curso (incluye Profesora), por mes y por popularidad
- Selector de orden: **Más recientes** / **Más populares** (ordena por `like_count`)
- **Botón ♥ (like)** en cada card: toggle con animación; contador actualizado en tiempo real; estado persistido en `localStorage` (set de IDs likeados)
- Contador de fotos con indicador de filtro activo
- Lightbox al hacer clic en una foto:
  - Navegación con flechas ← → y teclas de teclado
  - Swipe táctil para avanzar/retroceder
  - Contador de posición (ej. "3 / 12")
  - Se cierra con clic fuera, botón ✕ o tecla Escape
- Badge "NUEVO" en fotos recién subidas (SSE `new-photo`)
- Elimina fotos en tiempo real al recibir SSE `delete-photo`

### `public/admin-login.html` — Login admin
- Formulario de contraseña con feedback de error inline

### `public/admin.html` — Panel de administración
- Saludo personalizado al profesor
- **Sección "Subir foto de la profesora"** → sube imagen registrada automáticamente como `Nicol Valencia / Profesora`
- Filtro por nombre de alumno, por curso y por mes (se aplica en tiempo real)
- Rango de fechas y botón **Exportar reporte** → descarga tabla HTML con todos los filtros aplicados, apta para Excel
- Contador de trabajos con indicador de filtro activo
- Toggle de tema oscuro / Sakura (persiste en `localStorage`)
- Vista adaptativa:
  - **Desktop**: tabla con miniatura, nombre, curso, fecha, estado, impresiones, likes y acciones
  - **Mobile**: tarjetas con miniatura, estado, impresiones, likes y acciones
- Botón **Imprimir** → abre modal de selección de tamaño (20×15 cm / 10×7 cm) antes de enviar a CUPS
- Botón **Eliminar** → pide confirmación, borra archivo y registro, actualiza sin recargar
- Indicador de conexión SSE (punto verde/amarillo)
- Se actualiza automáticamente ante eventos: `new-photo`, `print-update`, `delete-photo`

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

`routes/print.js` mapea el tamaño a la media CUPS y ejecuta:

```bash
lp -d "<PRINTER_NAME>" -o media=<MEDIA> -o fit-to-page "<filePath>"
```

| `size` | Media CUPS | Dimensiones |
|--------|-----------|-------------|
| `20x15` | `Custom.200x150mm` | 20×15 cm |
| `10x7`  | `Custom.100x70mm`  | 10×7 cm |
| _(sin body)_ | `4x6` | 10×15 cm (fallback) |

Post impresión:
- `incrementPrintCount(id)` → `status = 'printed'`
- `logPrint(id)`
- `broadcast('print-update', { id, print_count, status })`

## Cursos disponibles

Los cursos están definidos como lista fija en `index.html` y en los filtros de `gallery.html` / `admin.html`:

- 3 Medio A · 3 Medio B · 3 Medio C · 3 Medio D · 3 Medio E · 3 Medio F · Profesora

Para agregar o cambiar cursos, editar los `<option>` en los tres archivos HTML.

## Manejo de errores

- Respuestas JSON con `{ success, error }` en rutas API (400/401/404/500)
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

## Pruebas rápidas

1. Subir foto:

```bash
curl -X POST http://localhost:3000/upload \
  -F "photo=@/ruta/a/foto.jpg" \
  -F "alumno=Juan Pérez" \
  -F "curso=3 Medio A"
```

2. Ver trabajos (galería):

```bash
curl http://localhost:3000/api/jobs
```

3. Ver SSE:

```bash
curl -N http://localhost:3000/events
```

4. Login admin + listar:

```bash
curl -c cookies.txt -H "Content-Type: application/json" \
  -d '{"password":"secreto"}' http://localhost:3000/admin/login
curl -b cookies.txt http://localhost:3000/admin/api/jobs
```

5. Imprimir (con selección de tamaño):

```bash
curl -b cookies.txt -X POST http://localhost:3000/admin/print/1 \
  -H "Content-Type: application/json" \
  -d '{"size":"20x15"}'
```

6. Toggle like en foto:

```bash
curl -X POST http://localhost:3000/like/1
# → { "success": true, "liked": true, "count": 1 }
```

7. Eliminar foto:

```bash
curl -b cookies.txt -X DELETE http://localhost:3000/admin/jobs/1
```

8. Exportar reporte:

```bash
curl -b cookies.txt "http://localhost:3000/admin/report?from=2025-01-01&to=2025-12-31" -o reporte.html
```

9. Ver cola CUPS:

```bash
lpq -P Brother-DCP-L3551CDW
```

## Cambiar de impresora

El servidor usa **IPP Everywhere (driverless)**, por lo que cualquier impresora Brother moderna funciona sin instalar drivers adicionales.

La opción `[7]` del script automatiza todo el proceso:

```bash
sudo bash scripts/setup.sh  # → [7] Configurar impresora
```

El script:
1. Muestra las impresoras ya registradas en CUPS
2. Detecta automáticamente los dispositivos USB conectados con `lpinfo -v`
3. Si hay una sola impresora, la autoselecciona (pide confirmación)
4. Si hay varias, muestra lista numerada para elegir
5. Registra la impresora en CUPS con `lpadmin -m everywhere`
6. Actualiza `PRINTER_NAME` en `/opt/print-server/.env`
7. Reinicia el servidor

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
- Al eliminar un job, el archivo físico se borra del disco y los registros de `print_log` se eliminan en cascada manual antes de borrar el job.

---

## Contacto

Implementación para el Electivo de Fotografía y Multimedia escolar. Para ajustes de cursos, impresora o red, editar `config.js`, los archivos HTML y `server.js` según lo descrito.
