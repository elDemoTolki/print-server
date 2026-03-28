# 11 — Systemd Service + WiFi Access Point

## Objetivo
Configurar el servidor Node.js para iniciarse automáticamente al encender la máquina, y configurar la tarjeta WiFi como Access Point para que alumnos y profesor puedan conectarse.

---

## Parte A — Servicio systemd para Node.js

### 1. Crear el archivo de servicio

```bash
sudo nano /etc/systemd/system/print-server.service
```

Contenido:

```ini
[Unit]
Description=Print Server - Electivo de Fotografía y Multimedia
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

# Variables de entorno (alternativa al .env file)
# EnvironmentFile=/opt/print-server/.env

[Install]
WantedBy=multi-user.target
```

### 2. Crear usuario dedicado (sin privilegios de root)

```bash
sudo useradd -r -s /bin/false print-server
sudo mkdir -p /opt/print-server
sudo chown -R print-server:print-server /opt/print-server

# Agregar al grupo lp para acceso a impresora
sudo usermod -aG lp print-server
```

### 3. Copiar el proyecto

```bash
# Copiar archivos del proyecto a /opt/print-server
sudo cp -r /ruta/del/proyecto/* /opt/print-server/
sudo chown -R print-server:print-server /opt/print-server

# Instalar dependencias como el usuario correcto
cd /opt/print-server
sudo -u print-server npm install --production
```

### 4. Habilitar e iniciar

```bash
sudo systemctl daemon-reload
sudo systemctl enable print-server
sudo systemctl start print-server

# Verificar estado
sudo systemctl status print-server

# Ver logs en tiempo real
sudo journalctl -u print-server -f
```

---

## Parte B — WiFi Access Point con hostapd + dnsmasq

### Prerrequisitos

```bash
sudo apt install hostapd dnsmasq

# Verificar que la tarjeta WiFi soporta modo AP
iw list | grep "Supported interface modes" -A 10
# Debe incluir "AP"
```

### 1. Identificar la interfaz WiFi

```bash
ip link show
# Buscar wlan0, wlp2s0, etc.
# En este ejemplo usamos: wlan0
```

### 2. Asignar IP estática a la interfaz WiFi

Editar `/etc/netplan/01-netcfg.yaml` (Ubuntu 24.04 usa netplan):

```yaml
network:
  version: 2
  ethernets:
    eth0:
      dhcp4: true  # si hay cable de red para mgmt
  wifis:
    wlan0:
      dhcp4: false
      addresses:
        - 192.168.4.1/24
      access-points: {}  # vacío = modo AP (gestionado por hostapd)
```

```bash
sudo netplan apply
```

### 3. Configurar hostapd

```bash
sudo nano /etc/hostapd/hostapd.conf
```

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

# Sin contraseña (red abierta — red local escolar)
# Para agregar contraseña WPA2:
# wpa=2
# wpa_passphrase=contraseña_aqui
# wpa_key_mgmt=WPA-PSK
# wpa_pairwise=CCMP
```

Indicar a hostapd el archivo de configuración:

```bash
sudo nano /etc/default/hostapd
# Agregar:
DAEMON_CONF="/etc/hostapd/hostapd.conf"
```

### 4. Configurar dnsmasq (DHCP)

Hacer backup y reemplazar `/etc/dnsmasq.conf`:

```bash
sudo mv /etc/dnsmasq.conf /etc/dnsmasq.conf.backup
sudo nano /etc/dnsmasq.conf
```

```ini
# Interfaz WiFi del AP
interface=wlan0
bind-interfaces

# Rango DHCP: asigna IPs del .10 al .100
dhcp-range=192.168.4.10,192.168.4.100,255.255.255.0,24h

# DNS — apuntar dominio local al servidor
# Los alumnos pueden escribir "foto.local" en el browser
address=/foto.local/192.168.4.1
address=/print.local/192.168.4.1

# Deshabilitar DNS forwarding (sin Internet)
no-resolv
no-poll
```

### 5. Habilitar hostapd y dnsmasq

```bash
sudo systemctl unmask hostapd
sudo systemctl enable hostapd dnsmasq
sudo systemctl start hostapd dnsmasq

# Verificar
sudo systemctl status hostapd
sudo systemctl status dnsmasq
```

### 6. (Opcional) Captive portal redirect

Para que al conectarse al WiFi el browser abra automáticamente el portal, agregar redirect en dnsmasq:

```ini
# En dnsmasq.conf — resolver TODOS los dominios al servidor
address=/#/192.168.4.1
```

> ⚠️ Esto hace que CUALQUIER dominio resuelva al servidor. Útil si no hay Internet, pero deshabilita DNS real. Solo usar si el servidor definitivamente no tiene acceso a Internet.

---

## Resumen: URLs de acceso

Una vez configurado:

| URL | Vista |
|-----|-------|
| `http://192.168.4.1` o `http://foto.local` | Portal alumnos |
| `http://192.168.4.1/gallery` | Galería pública |
| `http://192.168.4.1/admin` | Panel profesor |
| `http://192.168.4.1:631` | Panel CUPS (técnico) |

## Verificación final

```bash
# Ver dispositivos conectados al AP
arp -a

# Ver logs del servicio Node
sudo journalctl -u print-server -f

# Ver cola de impresión
lpq -P Brother-DCP-L3551CDW

# Test desde teléfono:
# 1. Conectar al WiFi "TallerFoto"
# 2. Abrir browser → http://192.168.4.1
# 3. Debe aparecer el portal de upload
```
