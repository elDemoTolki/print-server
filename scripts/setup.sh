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
askd() {                                  # askd "Pregunta" VAR_NAME
    local _t
    read -rp "  $1 [${!2}]: " _t
    [[ -n "$_t" ]] && printf -v "$2" '%s' "$_t"
}

# ── Rutas ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALL_DIR="/opt/print-server"
SERVICE_USER="print-server"
SERVICE_FILE="/etc/systemd/system/print-server.service"

# ── Valores por defecto ───────────────────────────────────────────────────────
PORT="3000"
MAX_FILE_MB="20"
PRINTER_NAME="Brother-DCP-L3551CDW"
WIFI_IFACE="wlan0"
WIFI_IP="192.168.1.10"          # IP del AP en la red local
WIFI_MASK="24"
DHCP_START="192.168.1.50"
DHCP_END="192.168.1.200"
SSID="TallerFoto"
WIFI_PASS=""                    # Se pide interactivamente; WPA2 activado por defecto
OPEN_NETWORK="no"               # "yes" = sin contraseña (debe confirmarse explícitamente)

# =============================================================================
# VERIFICACIONES
# =============================================================================

check_root()  { [[ $EUID -eq 0 ]] || err "Ejecuta con sudo: sudo bash $0"; }
check_linux() { [[ "$(uname -s)" == "Linux" ]] || err "Este script solo funciona en Linux."; }

# =============================================================================
# DEPENDENCIAS DEL SISTEMA
# =============================================================================

install_system_deps() {
    hr; info "Instalando dependencias del sistema..."

    apt-get update -qq
    apt-get install -y -qq build-essential python3 curl openssl
    ok "build-essential, python3, curl, openssl"

    # Node.js 20+
    local node_ver=0
    command -v node &>/dev/null && node_ver=$(node -v | cut -d. -f1 | tr -d v) || true
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
        [[ -n "${SUDO_USER:-}" ]] && usermod -aG lp "$SUDO_USER"
        ok "CUPS instalado — configura la impresora en http://localhost:631"
    else
        ok "CUPS ya instalado"
    fi
}

install_wifi_deps() {
    hr; info "Instalando herramientas WiFi AP y portal cautivo..."
    apt-get install -y -qq hostapd dnsmasq iptables-persistent netfilter-persistent
    ok "hostapd, dnsmasq, iptables-persistent"
}

# =============================================================================
# CONFIGURAR .ENV
# =============================================================================

configure_env() {
    hr; info "Configuración del archivo .env"
    echo

    askd "Puerto HTTP" PORT

    echo
    info "Impresoras CUPS disponibles:"
    lpstat -p 2>/dev/null | awk '{print "      "$2}' \
        || warn "      No hay impresoras configuradas todavía (configúrala en http://localhost:631)."
    echo
    askd "Nombre de la impresora CUPS" PRINTER_NAME
    askd "Tamaño máximo de foto (MB)" MAX_FILE_MB

    # Contraseña del panel admin — necesita bcrypt disponible
    echo
    info "Generando hash de contraseña para el panel admin..."
    info "Instalando dependencias npm locales (necesario para generar el hash)..."
    npm install --prefix "$PROJECT_DIR" --silent 2>/dev/null \
        || npm install --prefix "$PROJECT_DIR" 2>&1 | tail -3 \
        || true  # npm puede emitir error de logs pero aun así instalar correctamente

    local ADMIN_PASS ADMIN_PASS2
    while true; do
        read -rsp "  Contraseña del panel admin: " ADMIN_PASS; echo
        [[ -z "$ADMIN_PASS" ]] && { warn "La contraseña no puede estar vacía."; continue; }
        read -rsp "  Confirmar contraseña:        " ADMIN_PASS2; echo
        [[ "$ADMIN_PASS" == "$ADMIN_PASS2" ]] && break
        warn "Las contraseñas no coinciden. Intenta de nuevo."
    done

    # Generar hash con bcrypt — la contraseña se pasa via env var para evitar
    # problemas con caracteres especiales en el shell
    local ADMIN_HASH
    ADMIN_HASH=$(PASS="$ADMIN_PASS" node -e "
const b = require('bcrypt');
b.hash(process.env.PASS, 12).then(h => process.stdout.write(h));
")
    ok "Hash de contraseña generado"

    local SESSION_SECRET
    SESSION_SECRET=$(openssl rand -hex 32)
    ok "Session secret generado automáticamente"

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

    [[ -f "$PROJECT_DIR/.env" ]] \
        || err ".env no encontrado. Ejecuta primero la opción de configuración."

    # Usuario dedicado sin privilegios
    # -d $INSTALL_DIR: evita que useradd asigne /home/print-server como home,
    #   que no existe y causa errores en npm y otras herramientas
    # -M: no crear el directorio home (lo crea el paso siguiente)
    mkdir -p "$INSTALL_DIR"
    if ! id "$SERVICE_USER" &>/dev/null; then
        useradd -r -s /bin/false -d "$INSTALL_DIR" -M "$SERVICE_USER"
        ok "Usuario '$SERVICE_USER' creado (home: $INSTALL_DIR)"
    else
        # Corregir home si apunta a /home/print-server
        usermod -d "$INSTALL_DIR" "$SERVICE_USER"
        ok "Usuario '$SERVICE_USER' ya existe — home actualizado a $INSTALL_DIR"
    fi
    if command -v rsync &>/dev/null; then
        rsync -a --delete \
            --exclude=node_modules --exclude='.git' --exclude='*.log' \
            --exclude='.npm' \
            --exclude='public/uploads' \
            --exclude='db/*.db' \
            --exclude='db/*.db-shm' \
            --exclude='db/*.db-wal' \
            "$PROJECT_DIR/" "$INSTALL_DIR/"
    else
        find "$PROJECT_DIR" -mindepth 1 -maxdepth 1 \
            ! -name node_modules ! -name '.git' \
            -exec cp -r {} "$INSTALL_DIR/" \;
        # Sin rsync: preservar manualmente uploads y DB
        warn "rsync no disponible — uploads y DB no se sobreescriben pero verificar manualmente."
    fi
    chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
    usermod -aG lp "$SERVICE_USER"
    ok "Archivos copiados a $INSTALL_DIR"

    info "Instalando dependencias npm (producción)..."
    # Limpiar node_modules previo para evitar errores ENOTEMPTY
    rm -rf "$INSTALL_DIR/node_modules"
    # Asegurar que el directorio .npm existe y tiene permisos correctos
    mkdir -p "$INSTALL_DIR/.npm"
    chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/.npm"
    # Usar 'env' para garantizar que HOME llega correctamente al proceso npm
    sudo -u "$SERVICE_USER" env HOME="$INSTALL_DIR" \
        npm install --production --prefix "$INSTALL_DIR" --silent \
        || sudo -u "$SERVICE_USER" env HOME="$INSTALL_DIR" \
        npm install --production --prefix "$INSTALL_DIR" 2>&1 | tail -5
    ok "npm install completado"

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
        ok "Servicio print-server activo y habilitado al inicio"
    else
        warn "El servicio no arrancó. Revisa: sudo journalctl -u print-server -n 40"
    fi
}

# =============================================================================
# WIFI ACCESS POINT + PORTAL CAUTIVO
# =============================================================================

detect_wifi_iface() {
    local detected
    # iw dev es más confiable que asumir wlan0; en muchos sistemas es wlp2s0, wlp3s0, etc.
    detected=$(iw dev 2>/dev/null | awk '$1=="Interface"{print $2}' | head -1) || true

    if [[ -n "$detected" ]]; then
        WIFI_IFACE="$detected"
        info "Interfaz WiFi detectada: ${BOLD}$WIFI_IFACE${NC}"
        local confirm
        read -rp "  ¿Usar esta interfaz? [S/n]: " confirm
        [[ "$confirm" =~ ^[Nn]$ ]] && read -rp "  Interfaz WiFi: " WIFI_IFACE
    else
        # Fallback: listar todas las interfaces inalámbricas disponibles
        local ifaces
        ifaces=$(ls /sys/class/net/ | xargs -I{} sh -c 'test -d /sys/class/net/{}/wireless && echo {}' 2>/dev/null) || true
        if [[ -n "$ifaces" ]]; then
            warn "iw no detectó la interfaz. Interfaces inalámbricas encontradas:"
            echo "$ifaces" | nl -ba -nrz -w2
            read -rp "  Ingresa la interfaz WiFi: " WIFI_IFACE
        else
            warn "No se detectó interfaz WiFi automáticamente."
            read -rp "  Ingresa la interfaz WiFi (ej. wlp2s0): " WIFI_IFACE
        fi
    fi

    iw list 2>/dev/null | grep -q "AP" \
        || warn "No se pudo confirmar soporte de modo AP — continúa si estás seguro."
}

ask_wifi_password() {
    echo
    info "Seguridad WiFi — WPA2 activado por defecto"
    echo
    echo "  Ingresa la contraseña WPA2 (mín. 8 caracteres)."
    echo "  Para crear una red ABIERTA (sin contraseña), deja el campo vacío"
    echo -e "  y escribe ${BOLD}ABIERTA${NC} cuando se te pida confirmar."
    echo

    while true; do
        read -rsp "  Contraseña WPA2: " WIFI_PASS; echo

        if [[ -z "$WIFI_PASS" ]]; then
            local confirm_open
            read -rp "  ¿Confirmas red ABIERTA sin contraseña? [escribe ABIERTA para confirmar]: " confirm_open
            if [[ "$confirm_open" == "ABIERTA" ]]; then
                OPEN_NETWORK="yes"
                warn "Red configurada SIN contraseña (red abierta)."
                break
            else
                warn "Cancelado. Ingresa una contraseña WPA2 o escribe ABIERTA para red abierta."
            fi
        elif (( ${#WIFI_PASS} < 8 )); then
            warn "La contraseña WPA2 debe tener al menos 8 caracteres."
        else
            OPEN_NETWORK="no"
            ok "Contraseña WPA2 aceptada."
            break
        fi
    done
}

setup_captive_portal() {
    hr; info "Configurando portal cautivo (iptables)..."

    # Redirigir TODO el tráfico HTTP (puerto 80) entrante por la interfaz WiFi
    # al puerto del servidor Node.js. Así cualquier request HTTP del dispositivo
    # llega al servidor aunque el usuario escriba cualquier URL.
    #
    # El dispositivo detecta respuesta inesperada en sus URLs de "connectivity check"
    # y muestra automáticamente el popup/notificación de portal cautivo.

    # Limpiar regla previa si existe (idempotente)
    iptables -t nat -D PREROUTING \
        -i "$WIFI_IFACE" -p tcp --dport 80 -j REDIRECT --to-port "$PORT" 2>/dev/null || true

    # Agregar regla
    iptables -t nat -A PREROUTING \
        -i "$WIFI_IFACE" -p tcp --dport 80 -j REDIRECT --to-port "$PORT"
    ok "iptables: puerto 80 → $PORT en $WIFI_IFACE"

    # Guardar reglas para que persistan tras reinicio
    netfilter-persistent save >/dev/null 2>&1
    ok "Reglas iptables guardadas (persisten al reiniciar)"

    # Habilitar el servicio de restauración al inicio
    systemctl enable netfilter-persistent --quiet
    ok "netfilter-persistent habilitado al inicio"
}

setup_wifi_ap() {
    hr; info "Configurando WiFi Access Point..."
    echo

    detect_wifi_iface
    askd "SSID (nombre de la red WiFi)" SSID
    ask_wifi_password

    # ── Netplan: IP estática en la interfaz WiFi ──────────────────────────────
    local NETPLAN_FILE="/etc/netplan/99-print-server-ap.yaml"
    # Usar 'ethernets' en vez de 'wifis': en modo AP hostapd controla
    # la interfaz WiFi directamente, netplan solo asigna la IP estática.
    # La sección 'wifis' requiere access-points definidos (modo cliente).
    cat > "$NETPLAN_FILE" <<NPEOF
network:
  version: 2
  ethernets:
    ${WIFI_IFACE}:
      dhcp4: false
      addresses:
        - ${WIFI_IP}/${WIFI_MASK}
NPEOF
    chmod 600 "$NETPLAN_FILE"
    netplan apply 2>/dev/null || netplan apply
    ok "Netplan: $WIFI_IFACE → $WIFI_IP/$WIFI_MASK"

    # ── hostapd ───────────────────────────────────────────────────────────────
    cat > /etc/hostapd/hostapd.conf <<HEOF
interface=${WIFI_IFACE}
driver=nl80211
ssid=${SSID}
hw_mode=g
channel=7
wmm_enabled=0
macaddr_acl=0
ignore_broadcast_ssid=0
HEOF

    if [[ "$OPEN_NETWORK" == "yes" ]]; then
        # Red abierta: auth_algs=1 sin bloque WPA
        echo "auth_algs=1" >> /etc/hostapd/hostapd.conf
        ok "hostapd: red abierta (sin contraseña)"
    else
        # WPA2 Personal
        cat >> /etc/hostapd/hostapd.conf <<HEOF2
auth_algs=1
wpa=2
wpa_passphrase=${WIFI_PASS}
wpa_key_mgmt=WPA-PSK
wpa_pairwise=CCMP
rsn_pairwise=CCMP
HEOF2
        ok "hostapd: WPA2 activado"
    fi

    # Apuntar hostapd a su conf
    if [[ -f /etc/default/hostapd ]]; then
        sed -i 's|^#\?DAEMON_CONF=.*|DAEMON_CONF="/etc/hostapd/hostapd.conf"|' \
            /etc/default/hostapd
    else
        echo 'DAEMON_CONF="/etc/hostapd/hostapd.conf"' > /etc/default/hostapd
    fi

    # ── dnsmasq: DHCP + DNS cautivo ───────────────────────────────────────────
    # address=/#/IP  →  TODOS los dominios resuelven a nuestro servidor.
    # Esto activa la detección de portal cautivo en Android, iOS, macOS y Windows.
    [[ -f /etc/dnsmasq.conf ]] && mv /etc/dnsmasq.conf /etc/dnsmasq.conf.backup
    cat > /etc/dnsmasq.conf <<DMEOF
# Print Server — dnsmasq (DHCP + portal cautivo)
interface=${WIFI_IFACE}
# bind-dynamic: enlaza a la interfaz cuando esté disponible, en vez de fallar
# si dnsmasq arranca antes de que hostapd levante la interfaz WiFi.
bind-dynamic

# DHCP: asigna IPs a los dispositivos conectados
dhcp-range=${DHCP_START},${DHCP_END},255.255.255.0,8h

# Portal cautivo: todos los dominios resuelven al servidor
# El sistema operativo detecta respuesta inesperada y abre el browser
address=/#/${WIFI_IP}

# Dominios amigables directos
address=/foto.local/${WIFI_IP}
address=/print.local/${WIFI_IP}

# Sin reenvío DNS al exterior (red offline)
no-resolv
no-poll
DMEOF
    ok "dnsmasq: DHCP $DHCP_START–$DHCP_END + DNS cautivo (address=/#/)"

    # ── Habilitar e iniciar servicios ─────────────────────────────────────────
    systemctl unmask hostapd --quiet 2>/dev/null || true
    systemctl enable hostapd dnsmasq --quiet
    # Matar cualquier proceso dnsmasq suelto antes de iniciar el servicio
    pkill -x dnsmasq 2>/dev/null || true
    sleep 1
    systemctl restart hostapd dnsmasq
    sleep 2

    systemctl is-active --quiet hostapd \
        && ok "hostapd activo — WiFi '${BOLD}${SSID}${NC}' disponible" \
        || warn "hostapd no arrancó: sudo systemctl status hostapd"

    systemctl is-active --quiet dnsmasq \
        && ok "dnsmasq activo" \
        || warn "dnsmasq no arrancó: sudo systemctl status dnsmasq"

    # Configurar portal cautivo (iptables)
    setup_captive_portal
}

# =============================================================================
# CONFIGURAR IMPRESORA
# =============================================================================

configure_printer() {
    hr; info "Configurando impresora en CUPS..."
    echo

    # ── Impresoras ya registradas ─────────────────────────────────────────────
    info "Impresoras registradas actualmente:"
    lpstat -p 2>/dev/null || warn "  Ninguna impresora registrada todavía."
    echo

    # ── Detectar URIs disponibles por USB ────────────────────────────────────
    info "Detectando impresoras conectadas por USB..."
    local raw_uris
    raw_uris=$(lpinfo -v 2>/dev/null | grep -i "ipp\|usb" | grep -iv "socket\|lpd\|dnssd") || true

    if [[ -z "$raw_uris" ]]; then
        err "No se detectó ninguna impresora USB. Verifica que esté conectada y encendida."
    fi

    # Mostrar lista numerada
    local uris=()
    while IFS= read -r line; do
        [[ -n "$line" ]] && uris+=("$(echo "$line" | awk '{print $2}')")
    done <<< "$raw_uris"

    echo "  URIs disponibles:"
    for i in "${!uris[@]}"; do
        printf "  [%d]  %s\n" "$((i+1))" "${uris[$i]}"
    done
    echo

    # ── Seleccionar URI ──────────────────────────────────────────────────────
    local CUPS_URI=""
    if (( ${#uris[@]} == 1 )); then
        CUPS_URI="${uris[0]}"
        info "URI detectado automáticamente: ${BOLD}$CUPS_URI${NC}"
        local confirm
        read -rp "  ¿Usar este URI? [S/n]: " confirm
        [[ "$confirm" =~ ^[Nn]$ ]] && read -rp "  URI manual: " CUPS_URI
    else
        local pick
        read -rp "  Elige el número de la impresora: " pick
        CUPS_URI="${uris[$((pick-1))]:-}"
        [[ -z "$CUPS_URI" ]] && err "Selección inválida."
    fi

    # ── Nombre CUPS ──────────────────────────────────────────────────────────
    # Sugerir un nombre limpio basado en la URI
    local suggested
    suggested=$(echo "$CUPS_URI" | grep -oP '(?<=://)[^/_%?]+' | tr ' ' '_' | head -1) || suggested="Impresora"
    local CUPS_NAME="$suggested"
    askd "Nombre para la impresora en CUPS (sin espacios)" CUPS_NAME
    CUPS_NAME="${CUPS_NAME// /_}"   # reemplazar espacios por _ por si acaso

    # ── Registrar en CUPS ────────────────────────────────────────────────────
    lpadmin -p "$CUPS_NAME" -v "$CUPS_URI" -m everywhere -E -o printer-is-shared=false
    sleep 1
    lpstat -p "$CUPS_NAME" &>/dev/null \
        && ok "Impresora '${BOLD}${CUPS_NAME}${NC}' registrada y activa en CUPS" \
        || warn "La impresora fue registrada pero no responde aún — puede demorar unos segundos."

    # ── Actualizar PRINTER_NAME en .env ──────────────────────────────────────
    for envfile in "$INSTALL_DIR/.env" "$PROJECT_DIR/.env"; do
        if [[ -f "$envfile" ]]; then
            sed -i "s/^PRINTER_NAME=.*/PRINTER_NAME=${CUPS_NAME}/" "$envfile"
            ok "PRINTER_NAME=$CUPS_NAME → $envfile"
        fi
    done

    # ── Reiniciar servidor ────────────────────────────────────────────────────
    if systemctl is-active --quiet print-server; then
        systemctl restart print-server
        sleep 2
        systemctl is-active --quiet print-server \
            && ok "Servidor reiniciado con la nueva impresora" \
            || warn "Revisar: sudo journalctl -u print-server -n 20"
    fi

    hr
    echo -e "  Impresora configurada: ${BOLD}${CUPS_NAME}${NC}"
    echo -e "  Prueba:  ${BOLD}echo 'Test' | lp -d ${CUPS_NAME}${NC}"
    hr
}

# =============================================================================
# RESUMEN FINAL + VERIFICACIÓN DE ARRANQUE AUTOMÁTICO
# =============================================================================

show_summary() {
    hr
    echo -e "${BOLD}${GREEN}  Instalación completada${NC}"
    hr
    printf "  %-20s ${BOLD}http://%s${NC}  (o http://%s:%s)\n" \
        "Portal alumnos:" "foto.local" "$WIFI_IP" "$PORT"
    printf "  %-20s ${BOLD}http://%s/gallery${NC}\n"  "Galería:"    "foto.local"
    printf "  %-20s ${BOLD}http://%s/admin${NC}\n"    "Panel admin:" "foto.local"
    printf "  %-20s ${BOLD}http://%s:631${NC}\n"      "CUPS:"        "$WIFI_IP"
    echo
    hr
    echo -e "  ${BOLD}Servicios habilitados al inicio (arranque automático):${NC}"
    echo
    for svc in print-server hostapd dnsmasq cups netfilter-persistent; do
        if systemctl is-enabled --quiet "$svc" 2>/dev/null; then
            printf "  ${GREEN}✔${NC}  %-24s habilitado\n" "$svc"
        else
            printf "  ${YELLOW}⚠${NC}  %-24s NO habilitado\n" "$svc"
        fi
    done
    echo
    echo "  Al reiniciar el servidor:"
    echo "   • El WiFi AP arranca automáticamente (hostapd + dnsmasq)"
    echo "   • Las reglas iptables del portal cautivo se restauran (netfilter-persistent)"
    echo "   • El servidor Node.js arranca automáticamente (print-server.service)"
    echo "   • Todo listo sin intervención manual."
    echo
    echo -e "  Logs:   ${BOLD}sudo journalctl -u print-server -f${NC}"
    echo -e "  Estado: ${BOLD}sudo systemctl status print-server hostapd dnsmasq${NC}"
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
    echo -e "  ${BOLD}Print Server — Script de instalación${NC}"
    echo -e "  Electivo de Fotografía y Multimedia"
    hr
    echo "  [1]  Instalación completa     (deps + servidor + WiFi AP + portal cautivo)"
    echo "  [2]  Solo servidor            (sin WiFi AP)"
    echo "  [3]  Solo WiFi AP + portal    (asume servidor ya desplegado)"
    echo "  [4]  Solo dependencias        (Node.js, CUPS, build tools)"
    echo "  [5]  Actualizar servidor      (recopia archivos y reinicia)"
    echo "  [6]  Reconfigurar .env        (nueva contraseña / impresora)"
    echo "  [7]  Configurar impresora    (detectar USB, registrar en CUPS y actualizar .env)"
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
            warn "WiFi AP no configurado — conéctate por la red local."
            ;;
        3)
            install_wifi_deps
            setup_wifi_ap
            show_summary
            ;;
        4)
            install_system_deps
            ok "Dependencias instaladas. Ejecuta el script de nuevo para continuar."
            ;;
        5)
            deploy_server
            setup_systemd
            ok "Servidor actualizado y reiniciado."
            ;;
        6)
            configure_env
            cp "$PROJECT_DIR/.env" "$INSTALL_DIR/.env"
            chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/.env"
            systemctl restart print-server
            ok ".env actualizado y servidor reiniciado."
            ;;
        7)
            configure_printer
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
