#!/bin/bash
# =============================================================================
# install.sh — GOcontroll MCP API service installer
#
# Run this script on the target controller after copying the mcp-api directory:
#
#   On the source controller:
#     scp -r /opt/gocontroll/mcp-api root@<new-controller-ip>:/opt/gocontroll/
#
#   On the new controller:
#     bash /opt/gocontroll/mcp-api/install.sh
#
# =============================================================================

set -euo pipefail

INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_NAME="gocontroll-mcp"

echo "=== GOcontroll MCP API installer ==="
echo "Install directory: $INSTALL_DIR"
echo ""

# --- System packages ---------------------------------------------------------

echo "[1/4] Checking system packages..."

PACKAGES=()

if ! command -v node &>/dev/null || ! node -e "process.exit(parseInt(process.version.slice(1)) >= 18 ? 0 : 1)" 2>/dev/null; then
    PACKAGES+=(nodejs npm)
fi

for pkg in mosquitto avahi-daemon gcc make binutils; do
    if ! dpkg -l "$pkg" 2>/dev/null | grep -q '^ii'; then
        PACKAGES+=("$pkg")
    fi
done

if [[ ${#PACKAGES[@]} -gt 0 ]]; then
    echo "  Installing: ${PACKAGES[*]}"
    apt-get update -qq
    apt-get install -y "${PACKAGES[@]}"
else
    echo "  All packages present."
fi

# Mosquitto broker: make sure it is enabled and running
if ! systemctl is-enabled mosquitto &>/dev/null; then
    systemctl enable mosquitto
fi
if ! systemctl is-active mosquitto &>/dev/null; then
    systemctl start mosquitto
fi

# --- Systemd service ---------------------------------------------------------

echo "[2/4] Installing systemd service..."

cat > /etc/systemd/system/${SERVICE_NAME}.service << EOF
[Unit]
Description=GOcontroll Moduline MCP API Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"
echo "  Service enabled and started."

# --- Avahi / mDNS ------------------------------------------------------------

echo "[3/4] Registering mDNS service..."

mkdir -p /etc/avahi/services
cat > /etc/avahi/services/${SERVICE_NAME}.service << 'EOF'
<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">GOcontroll %h</name>
  <service>
    <type>_gocontroll-mcp._tcp</type>
    <port>8080</port>
    <txt-record>model=Moduline IV</txt-record>
    <txt-record>api=v1</txt-record>
  </service>
</service-group>
EOF

if systemctl is-active avahi-daemon &>/dev/null; then
    systemctl restart avahi-daemon
    echo "  Avahi restarted."
else
    systemctl enable avahi-daemon
    systemctl start avahi-daemon
    echo "  Avahi enabled and started."
fi

# --- Verify ------------------------------------------------------------------

echo "[4/4] Verifying..."

sleep 2

if systemctl is-active --quiet "${SERVICE_NAME}"; then
    STATUS=$(curl -s --max-time 3 http://localhost:8080/api/info 2>/dev/null | \
             grep -o '"hostname":"[^"]*"' | head -1 || echo "no response yet")
    echo "  Service running. $STATUS"
else
    echo "  WARNING: service not active. Check: journalctl -u ${SERVICE_NAME} -n 30"
    exit 1
fi

echo ""
echo "=== Done ==="
echo "API:  http://$(hostname -I | awk '{print $1}'):8080/api/info"
echo "Logs: journalctl -u ${SERVICE_NAME} -f"
