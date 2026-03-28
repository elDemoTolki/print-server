#!/usr/bin/env bash
# =============================================================================
# setup.sh — Script de instalación del Print Server
# Electivo de Fotografía y Multimedia
#
# Uso: sudo bash scripts/setup.sh
# =============================================================================
set -euo pipefail

# ── Colores y helpers ─────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "${GREEN}✔${NC}  $*"; }
info() { echo -e "${BLUE}→${NC}  $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
err()  { echo -e "${RED}✖${NC}  $*" >&2; exit 1; }
hr()   { echo -e "${BLUE}────────────────────────────────────────────────────${NC}"; }
ask()  { read -rp "  $1" "$2"; }         # ask "Pregunta: " VAR
askd() { read -rp "  $1 [${!2}]: " _t;  # ask with default
         [[ -n "$_t" ]] && printf -v "$2" '%s' "$_t"; }

# ── Rutas ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALL_DIR="/opt/print-server"
SERVICE_USER="print-server"
SERVICE_FILE="/etc/systemd/system/print-server.service"

# ── Valores por defecto (editables) ──────────────────────────────────────────
PORT="3000"
MAX_FILE_MB="20"
PRINTER_NAME="Brother-DCP-L3551CDW"
WIFI_IFACE="wlan0"
WIFI_IP="192.168.4.1"
SSID="TallerFoto"
WIFI_PASS=""

# =============================================================================
# VERIFICACIONES
# =============================================================================

check_root() {
    [[ $EUID -eq 0 ]] || err "Ejecuta con sudo: sudo bash $0"
}

check_linux() {
    [[ "$(uname -s)" == "Linux" ]] || err "Este script solo funciona en Linux."
}

# =============================================================================
# INSTALAR DEPENDENCIAS
# =============================================================================

install_system_deps() {
    hr; info "Instalando dependencias del sistema..."

    apt-get update -qq

    # Herramientas de compilación (requeridas por better-sqlite3 y bcrypt)
    apt-get install -y -qq build-essential python3 curl openssl
    ok "build-essential, python3, curl, openssl"

    # Node.js 20
    local node_ver=0
    command -v node &>/dev/null && node_ver=$(node -v | cut -d. -f1 | tr -d v)
    if (( node_ver < 20 )); then
        info "Instalando Node.js 20..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
        apt-get install -y -qq nodejs
        ok "Node.js $(node -v)"
    else
        ok "Node.js ya instalado: $(node -v)"
    fi

    # CUPS
    if ! command -v lp &>/dev/null; then
        apt-get install -y -qq cups
        systemctl enable cups --quiet
        systemctl start cups
        # Añadir usuario actual al grupo lp (para imprimir sin root)
        [[ -n "${SUDO_USER:-}" ]] && usermod -aG lp "$SUDO_USER"
        ok "CUPS instalado — configura la impresora en http://localhost:631"
    else
        ok "CUPS ya instalado"
    fi
}

install_wifi_deps() {
    hr; info "Instalando herramientas WiFi AP..."
    if ! command -v hostapd &>/dev/null; then
        apt-get install -y -qq hostapd dnsmasq
        ok "hostapd, dnsmasq"
    else
        ok "hostapd/dnsmasq ya instalados"
    fi
}

# =============================================================================
# CONFIGURAR .ENV
# =============================================================================

configure_env() {
    hr; info "Configuración del archivo .env"
    echo

    # Puerto
    askd "Puerto HTTP" PORT

    # Impresora
    echo
    info "Impresoras CUPS disponibles:"
    lpstat -p 2>/dev/null | awk '{print "      "$2}' || warn "      No hay impresoras configuradas todavía."
    echo
    askd "Nombre de la impresora CUPS" PRINTER_NAME

    # Tamaño máximo de foto
    askd "Tamaño máximo de foto (MB)" MAX_FILE_MB

    # Contraseña del panel admin
    echo
    info "Generando hash de contraseña para el panel admin..."
    # Asegurar que bcrypt esté disponible instalando npm deps en el proyecto fuente
    info "Instalando dependencias npm locales (necesario para generar el hash)..."
    npm install --prefix "$PROJECT_DIR" --silent 2>/dev/null \
        || npm install --prefix "$PROJECT_DIR" 2>&1 | tail -3

    local ADMIN_PASS ADMIN_PASS2
    while true; do
        read -rsp "  Contraseña del panel admin: " ADMIN_PASS; echo
        read -rsp "  Confirmar contraseña:        " ADMIN_PASS2; echo
        [[ "$ADMIN_PASS" == "$ADMIN_PASS2" ]] && break
        warn "Las contraseñas no coinciden. Intenta de nuevo."
    done

    local ADMIN_HASH
    ADMIN_HASH=$(node --input-type=module <<EOF
import bcrypt from 'bcrypt';
const h = await bcrypt.hash('${ADMIN_PASS//\'/\\\'}', 12);
process.stdout.write(h);
EOF
    ) || ADMIN_HASH=$(node -e "
const b = require('bcrypt');
b.hash('${ADMIN_PASS//\'/\\\'}', 12).then(h => process.stdout.write(h));
")
    ok "Hash de contraseña generado"

    # Session secret aleatorio
    local SESSION_SECRET
    SESSION_SECRET=$(openssl rand -hex 32)
    ok "Session secret generado automáticamente"

    # Escribir .env
    cat > "$PROJECT_DIR/.env" <<ENVEOF
PORT=${PORT}
ADMIN_PASSWORD=${ADMIN_HASH}
SESSION_SECRET=${SESSION_SECRET}
PRINTER_NAME=${PRINTER_NAME}
UPLOAD_DIR=public/uploads
MAX_FILE_SIZE_MB=${MAX_FILE_MB}
ENVEOF
    ok ".env creado en $PROJECT_DIR/.env"
}

# =============================================================================
# DESPLEGAR SERVIDOR
# =============================================================================

deploy_server() {
    hr; info "Desplegando servidor en $INSTALL_DIR..."

    # Verificar que .env existe
    [[ -f "$PROJECT_DIR/.env" ]] \
        || err ".env no encontrado. Ejecuta la opción de configuración primero."

    # Crear usuario dedicado
    if ! id "$SERVICE_USER" &>/dev/null; then
        useradd -r -s /bin/false "$SERVICE_USER"
        ok "Usuario '$SERVICE_USER' creado"
    else
        ok "Usuario '$SERVICE_USER' ya existe"
    fi

    # Copiar archivos (sin node_modules ni .git)
    mkdir -p "$INSTALL_DIR"
    if command -v rsync &>/dev/null; then
        rsync -a --delete \
            --exclude=node_modules --exclude='.git' --exclude='*.log' \
            "$PROJECT_DIR/" "$INSTALL_DIR/"
    else
        find "$PROJECT_DIR" -mindepth 1 -maxdepth 1 \
            ! -name node_modules ! -name '.git' \
            -exec cp -r {} "$INSTALL_DIR/" \;
    fi
    chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
    usermod -aG lp "$SERVICE_USER"
    ok "Archivos copiados a $INSTALL_DIR"

    # Dependencias de producción
    info "Instalando npm --production..."
    sudo -u "$SERVICE_USER" npm install --production --prefix "$INSTALL_DIR" --silent \
        || sudo -u "$SERVICE_USER" npm install --production --prefix "$INSTALL_DIR" 2>&1 | tail -5
    ok "npm install completado"

    # Directorio uploads
    mkdir -p "$INSTALL_DIR/public/uploads"
    chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/public/uploads"
    ok "Directorio uploads listo"
}

# =============================================================================
# SERVICIO SYSTEMD
# =============================================================================

setup_systemd() {
    hr; info "Configurando servicio systemd..."

    cat > "$SERVICE_FILE" <<SVCEOF
[Unit]
Description=Print Server - Electivo de Fotografía y Multimedia
After=network.target cups.service
Wants=cups.service

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=print-server

[Install]
WantedBy=multi-user.target
SVCEOF

    systemctl daemon-reload
    systemctl enable print-server --quiet
    systemctl restart print-server
    sleep 2

    if systemctl is-active --quiet print-server; then
        ok "Servicio print-server activo y habilitado"
    else
        warn "El servicio no arrancó correctamente."
        warn "Revisa los logs: sudo journalctl -u print-server -n 40"
    fi
}

# =============================================================================
# WIFI ACCESS POINT
# =============================================================================

detect_wifi_iface() {
    local detected
    detected=$(iw dev 2>/dev/null | awk '$1=="Interface"{print $2}' | head -1)
    if [[ -n "$detected" ]]; then
        WIFI_IFACE="$detected"
        info "Interfaz WiFi detectada: ${BOLD}$WIFI_IFACE${NC}"
        local confirm
        read -rp "  ¿Usar esta interfaz? [S/n]: " confirm
        if [[ "$confirm" =~ ^[Nn]$ ]]; then
            ask "Interfaz WiFi: " WIFI_IFACE
        fi
    else
        warn "No se detectó interfaz WiFi automáticamente."
        askd "Interfaz WiFi" WIFI_IFACE
    fi

    # Verificar soporte para modo AP
    if ! iw list 2>/dev/null | grep -q "AP"; then
        warn "No se pudo confirmar soporte de modo AP en la tarjeta."
        warn "Continúa si estás seguro de que la tarjeta lo soporta."
    fi
}

setup_wifi_ap() {
    hr; info "Configurando WiFi Access Point..."
    echo

    detect_wifi_iface
    askd "SSID (nombre de la red)" SSID
    read -rsp "  Contraseña WiFi (Enter = red abierta): " WIFI_PASS; echo

    # ── Netplan ──────────────────────────────────────────────────────────────
    local NETPLAN_FILE="/etc/netplan/99-print-server-ap.yaml"
    cat > "$NETPLAN_FILE" <<NPEOF
network:
  version: 2
  wifis:
    ${WIFI_IFACE}:
      dhcp4: false
      addresses:
        - ${WIFI_IP}/24
      access-points: {}
NPEOF
    chmod 600 "$NETPLAN_FILE"
    netplan apply 2>/dev/null || netplan apply
    ok "Netplan aplicado — $WIFI_IFACE → $WIFI_IP"

    # ── hostapd ──────────────────────────────────────────────────────────────
    cat > /etc/hostapd/hostapd.conf <<HEOF
interface=${WIFI_IFACE}
driver=nl80211
ssid=${SSID}
hw_mode=g
channel=7
wmm_enabled=0
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=0
HEOF

    if [[ -n "$WIFI_PASS" ]]; then
        cat >> /etc/hostapd/hostapd.conf <<HEOF2

wpa=2
wpa_passphrase=${WIFI_PASS}
wpa_key_mgmt=WPA-PSK
wpa_pairwise=CCMP
HEOF2
        ok "hostapd configurado con WPA2"
    else
        ok "hostapd configurado (red abierta)"
    fi

    # Apuntar hostapd a su conf
    if [[ -f /etc/default/hostapd ]]; then
        sed -i 's|^#\?DAEMON_CONF=.*|DAEMON_CONF="/etc/hostapd/hostapd.conf"|' /etc/default/hostapd
    else
        echo 'DAEMON_CONF="/etc/hostapd/hostapd.conf"' > /etc/default/hostapd
    fi

    # ── dnsmasq ───────────────────────────────────────────────────────────────
    [[ -f /etc/dnsmasq.conf ]] && mv /etc/dnsmasq.conf /etc/dnsmasq.conf.backup
    cat > /etc/dnsmasq.conf <<DMEOF
# Print Server — dnsmasq config
interface=${WIFI_IFACE}
bind-interfaces
dhcp-range=192.168.4.10,192.168.4.100,255.255.255.0,24h
address=/foto.local/${WIFI_IP}
address=/print.local/${WIFI_IP}
no-resolv
no-poll
DMEOF
    ok "dnsmasq configurado (DHCP + DNS local)"

    # Habilitar e iniciar
    systemctl unmask hostapd --quiet 2>/dev/null || true
    systemctl enable hostapd dnsmasq --quiet
    systemctl restart hostapd dnsmasq
    sleep 2

    systemctl is-active --quiet hostapd \
        && ok "hostapd activo — WiFi '${BOLD}${SSID}${NC}' disponible" \
        || warn "hostapd no arrancó: sudo systemctl status hostapd"

    systemctl is-active --quiet dnsmasq \
        && ok "dnsmasq activo" \
        || warn "dnsmasq no arrancó: sudo systemctl status dnsmasq"
}

# =============================================================================
# RESUMEN FINAL
# =============================================================================

show_summary() {
    hr
    echo -e "${BOLD}${GREEN}  Instalación completada${NC}"
    hr
    printf "  %-18s ${BOLD}http://%s:%s${NC}\n"      "Portal alumnos:" "$WIFI_IP" "$PORT"
    printf "  %-18s ${BOLD}http://%s:%s/gallery${NC}\n" "Galería:"        "$WIFI_IP" "$PORT"
    printf "  %-18s ${BOLD}http://%s:%s/admin${NC}\n"   "Panel admin:"    "$WIFI_IP" "$PORT"
    printf "  %-18s ${BOLD}http://foto.local${NC}  (con AP activo)\n" "Dominio local:"
    printf "  %-18s ${BOLD}http://%s:631${NC}\n"        "CUPS:"           "$WIFI_IP"
    echo
    echo -e "  Logs:   ${BOLD}sudo journalctl -u print-server -f${NC}"
    echo -e "  Estado: ${BOLD}sudo systemctl status print-server${NC}"
    hr
}

# =============================================================================
# MENÚ PRINCIPAL
# =============================================================================

main() {
    check_root
    check_linux

    clear
    echo
    echo -e "  ${BOLD}Print Server — Instalación${NC}"
    echo -e "  Electivo de Fotografía y Multimedia"
    hr
    echo "  [1]  Instalación completa     (deps + servidor + WiFi AP)"
    echo "  [2]  Solo servidor            (sin WiFi AP)"
    echo "  [3]  Solo WiFi AP             (asume servidor ya desplegado)"
    echo "  [4]  Solo dependencias        (Node.js, CUPS, build tools)"
    echo "  [5]  Actualizar servidor      (recopia archivos y reinicia)"
    echo "  [6]  Reconfigurar .env        (nueva contraseña / impresora)"
    echo "  [q]  Salir"
    hr
    echo
    read -rp "  Elige una opción: " OPT
    echo

    case "$OPT" in
        1)
            install_system_deps
            install_wifi_deps
            configure_env
            deploy_server
            setup_systemd
            setup_wifi_ap
            show_summary
            ;;
        2)
            install_system_deps
            configure_env
            deploy_server
            setup_systemd
            hr
            ok "Servidor listo en http://localhost:${PORT}"
            warn "WiFi AP no configurado. Conectarse por la red local."
            ;;
        3)
            install_wifi_deps
            setup_wifi_ap
            ;;
        4)
            install_system_deps
            ok "Dependencias instaladas. Ejecuta el script de nuevo para continuar."
            ;;
        5)
            deploy_server
            systemctl restart print-server
            ok "Servidor actualizado y reiniciado."
            ;;
        6)
            configure_env
            # Copiar solo el .env actualizado
            cp "$PROJECT_DIR/.env" "$INSTALL_DIR/.env"
            chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/.env"
            systemctl restart print-server
            ok ".env actualizado y servidor reiniciado."
            ;;
        q|Q)
            echo "Saliendo."
            exit 0
            ;;
        *)
            err "Opción inválida: '$OPT'"
            ;;
    esac
}

main "$@"
