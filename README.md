# Print Server - Taller de Fotografía (Local)

Servidor local para taller de fotografía móvil escolar.

- Node.js 20 + Express 4
- SQLite con `better-sqlite3`
- Carga desde dispositivo móvil (photo upload)
- Galería pública actualizable con SSE
- Panel administrador con impresión por CUPS
- WiFi AP local y servicio systemd para arranque automático

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
│   ├── uploads/
│   ├── index.html
│   ├── gallery.html
│   ├── admin-login.html
│   └── admin.html
├── scripts/
│   └── generate-password.js
├── package.json
└── .env.example
```

## Requisitos de configuración

- `ADMIN_PASSWORD`: hash bcrypt (usar `scripts/generate-password.js`)
- `SESSION_SECRET`: string secreto para cookies
- `PORT`: puerto HTTP (por defecto `3000`)
- `PRINTER_NAME`: nombre CUPS de la impresora (ej. `Brother-DCP-L3551CDW`)
- `UPLOAD_DIR`: `public/uploads`

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

## Instalación de dependencias

```bash
cd /ruta/del/proyecto
npm install
```

## Generar hash de contraseña

```bash
node scripts/generate-password.js
```

Copiar `ADMIN_PASSWORD` al `.env`.

## Ejecutar servidor

```bash
npm start
```

## Rutas principales

- `GET /` → portal de upload alumnos
- `POST /upload` → recibe foto + campos `alumno`, `curso`
- `GET /gallery` → galería con thumbnails
- `GET /api/jobs` → datos JSON para galería
- `GET /events` → SSE para actualizaciones en tiempo real
- `GET /admin` → panel admin (requiere sesión)
- `POST /admin/login` → login admin
- `POST /admin/logout` → cerrar sesión
- `POST /admin/print/:id` → enviar foto a imprimir
- `GET /admin/api/jobs` → historial full con `print_history`

## Base de datos (SQLite)

- `jobs`: id, filename, original_name, alumno, curso, status, print_count, uploaded_at
- `print_log`: id, job_id, printed_at

## Descripción de módulos

- `db/database.js` (mejor-sqlite3, sync)
- `routes/events.js` (SSE clients + broadcast)
- `routes/upload.js` (multer + validación + db + broadcast «new-photo»)
- `routes/gallery.js` (galería y API pública)
- `routes/admin.js` (login, logout, panel, jobs admin, print router)
- `routes/print.js` (lp + db updates + broadcast «print-update»)
- `middleware/auth.js` (requireAdmin)

## Frontend

- `public/index.html` 
  - portal de alumnos con preview imagen y feedback
  - `fetch('/upload')`
- `public/gallery.html`
  - carga de `/api/jobs`
  - SSE `/events` con `new-photo`
- `public/admin-login.html`
  - login a `/admin/login`
- `public/admin.html`
  - tabla jobs
  - botón imprimir que hace `POST /admin/print/:id`
  - escucha SSE `print-update`

## SSE (Server-Sent Events)

- `GET /events` mantiene conexión abierta
- Emite:
  - `connected` (clientId)
  - `new-photo` (payload, updates gallery
  - `print-update` (imprime/recuento)

## Mecanismo de impresión

- `routes/print.js`: `lp -d "${config.printerName}" -o media=A4 -o fit-to-page "${filePath}"`
- Post impresión:
  - `incrementPrintCount(id)` (estatus "printed")
  - `logPrint(id)`
  - `broadcast('print-update', { id, print_count, status })`

## Manejo de errores

- botones JSON 400/401/500 robustos
- middleware global 404 + 500 en `server.js`
- multer file errors en `upload.js`

## Opción deployment: service systemd + WiFi AP

### 1) Service systemd (`/etc/systemd/system/print-server.service`)

Configurar:

```ini
[Unit]
Description=Print Server - Taller de Fotografía
After=network.target cups.service
Wants=cups.service

[Service]
Type=simple
User=print-server
WorkingDirectory=/opt/print-server
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=print-server

[Install]
WantedBy=multi-user.target
```

Crear usuario:

```bash
sudo useradd -r -s /bin/false print-server
sudo mkdir -p /opt/print-server
sudo chown -R print-server:print-server /opt/print-server
sudo usermod -aG lp print-server
```

Copiar proyecto y `npm install` como user:

```bash
sudo cp -r /ruta/del/proyecto/* /opt/print-server/
sudo chown -R print-server:print-server /opt/print-server
cd /opt/print-server
sudo -u print-server npm install --production
```

Habilitar e iniciar:

```bash
sudo systemctl daemon-reload
sudo systemctl enable print-server
sudo systemctl start print-server
sudo systemctl status print-server
sudo journalctl -u print-server -f
```

### 2) WiFi AP (hostapd + dnsmasq)

Instalar:

```bash
sudo apt install hostapd dnsmasq
iw list | grep "Supported interface modes" -A 10
```

Configurar IP y netplan:

```yaml
network:
  version: 2
  ethernets:
    eth0: { dhcp4: true }
  wifis:
    wlan0:
      dhcp4: false
      addresses: [192.168.4.1/24]
      access-points: {}
```

`sudo netplan apply`

`/etc/hostapd/hostapd.conf`:

```ini
interface=wlan0
driver=nl80211
ssid=TallerFoto
hw_mode=g
channel=7
wmm_enabled=0
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=0
```

`/etc/default/hostapd`:

```ini
DAEMON_CONF="/etc/hostapd/hostapd.conf"
```

`/etc/dnsmasq.conf`:

```ini
interface=wlan0
bind-interfaces
dhcp-range=192.168.4.10,192.168.4.100,255.255.255.0,24h
address=/foto.local/192.168.4.1
address=/print.local/192.168.4.1
no-resolv
no-poll
```

Habilitar servicios:

```bash
sudo systemctl unmask hostapd
sudo systemctl enable hostapd dnsmasq
sudo systemctl start hostapd dnsmasq
sudo systemctl status hostapd dnsmasq
```

### Captive portal (opcional)

```ini
# dnsmasq.conf
address=/#/192.168.4.1
```

> Aviso: esto redirige cualquier dominio al servidor (no hay acceso real a Internet).

## Pruebas rápidas

1. Subir foto con curl:

```bash
curl -X POST http://localhost:3000/upload -F "photo=@/ruta/a/foto.jpg" -F "alumno=Juan" -F "curso=3A"
```

2. Ver trabajos:

```bash
curl http://localhost:3000/api/jobs
```

3. Ver SSE:

```bash
curl -N http://localhost:3000/events
```

4. Login admin + listar:

```bash
curl -c cookies.txt -H "Content-Type: application/json" -d '{"password":"secreto"}' http://localhost:3000/admin/login
curl -b cookies.txt http://localhost:3000/admin/api/jobs
```

5. Imprimir:

```bash
curl -b cookies.txt -X POST http://localhost:3000/admin/print/1
```

6. Ver cola CUPS:

```bash
lpq -P Brother-DCP-L3551CDW
```

## Notes

- `UPLOAD_DIR` debe estar en `public/uploads` para servir imágenes.
- Modo offline: sin Internet, no CDNs, no external JS.
- `better-sqlite3` no usa async/await (es síncrono).

---

### Problemas vistos al instalar deps en Windows

En Windows, se requiere herramienta de compilación para `better-sqlite3` (`node-gyp`, Visual Studio C++ workload). En Linux/Ubuntu, instalar `build-essential python3`.

---

## Contacto

Implementación por proyecto internal para taller de fotografía escolar. Para ajustes de perfiles o customizaciones de red, editar `config.js` y `server.js` según el proceso descrito.
