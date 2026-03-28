#!/bin/bash
# =============================================================================
# build-deb.sh — Build the go-mcp Debian package
#
# Usage:
#   bash /opt/gocontroll/mcp-api/packaging/build-deb.sh [version]
#
# Output:
#   /opt/gocontroll/mcp-api/packaging/dist/go-mcp_<version>_arm64.deb
# =============================================================================

set -euo pipefail

VERSION="${1:-$(cat /opt/gocontroll/mcp-api/package.json | grep '"version"' | grep -oP '[\d.]+'  )}"
ARCH="arm64"
PACKAGE="go-mcp"
SRC="/opt/gocontroll/mcp-api"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/build/${PACKAGE}_${VERSION}_${ARCH}"
DIST_DIR="${SCRIPT_DIR}/dist"

echo "=== Building ${PACKAGE}_${VERSION}_${ARCH}.deb ==="

# --- Clean previous build ----------------------------------------------------
rm -rf "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}/DEBIAN"
mkdir -p "${DIST_DIR}"

# --- Copy service files -------------------------------------------------------
install -Dm644 "${SRC}/server.js"      "${BUILD_DIR}/opt/gocontroll/mcp-api/server.js"
install -Dm644 "${SRC}/package.json"   "${BUILD_DIR}/opt/gocontroll/mcp-api/package.json"

for f in "${SRC}"/lib/*.js; do
    install -Dm644 "$f" "${BUILD_DIR}/opt/gocontroll/mcp-api/lib/$(basename "$f")"
done

# --- Systemd service ---------------------------------------------------------
install -Dm644 /dev/stdin \
    "${BUILD_DIR}/lib/systemd/system/gocontroll-mcp.service" << EOF
[Unit]
Description=GOcontroll Moduline MCP API Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/gocontroll/mcp-api
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# --- Avahi mDNS --------------------------------------------------------------
install -Dm644 /dev/stdin \
    "${BUILD_DIR}/etc/avahi/services/gocontroll-mcp.service" << 'EOF'
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

# --- DEBIAN/control ----------------------------------------------------------
cat > "${BUILD_DIR}/DEBIAN/control" << EOF
Package: ${PACKAGE}
Version: ${VERSION}
Architecture: ${ARCH}
Maintainer: GOcontroll B.V. <info@gocontroll.com>
Depends: nodejs (>= 18), mosquitto, avahi-daemon
Recommends: gcc, make, binutils
Section: net
Priority: optional
Homepage: https://gocontroll.com
Description: GOcontroll Moduline MCP API Service
 HTTP API service that exposes GOcontroll Moduline IV hardware via a
 REST/JSON interface for use with the MCP (Model Context Protocol) and
 Claude AI. Provides hardware discovery, I/O monitoring, C-code
 compilation, CAN/MQTT tools, and XCP/HANtune a2l generation.
EOF

# --- DEBIAN/conffiles --------------------------------------------------------
# The Avahi service file is a conffile — users may edit the port or txt-records.
cat > "${BUILD_DIR}/DEBIAN/conffiles" << 'EOF'
/etc/avahi/services/gocontroll-mcp.service
EOF

# --- DEBIAN/postinst ---------------------------------------------------------
cat > "${BUILD_DIR}/DEBIAN/postinst" << 'EOF'
#!/bin/bash
set -e
case "$1" in
    configure)
        systemctl daemon-reload
        systemctl enable gocontroll-mcp.service
        systemctl restart gocontroll-mcp.service || true
        systemctl is-active --quiet avahi-daemon && systemctl restart avahi-daemon || true
        ;;
esac
EOF
chmod 755 "${BUILD_DIR}/DEBIAN/postinst"

# --- DEBIAN/prerm ------------------------------------------------------------
cat > "${BUILD_DIR}/DEBIAN/prerm" << 'EOF'
#!/bin/bash
set -e
case "$1" in
    remove|purge)
        systemctl stop gocontroll-mcp.service || true
        systemctl disable gocontroll-mcp.service || true
        ;;
esac
EOF
chmod 755 "${BUILD_DIR}/DEBIAN/prerm"

# --- DEBIAN/postrm -----------------------------------------------------------
cat > "${BUILD_DIR}/DEBIAN/postrm" << 'EOF'
#!/bin/bash
set -e
case "$1" in
    purge)
        systemctl daemon-reload || true
        ;;
esac
EOF
chmod 755 "${BUILD_DIR}/DEBIAN/postrm"

# --- Build -------------------------------------------------------------------
DEB="${DIST_DIR}/${PACKAGE}_${VERSION}_${ARCH}.deb"
dpkg-deb --build --root-owner-group "${BUILD_DIR}" "${DEB}"

echo ""
echo "Built: ${DEB}"
echo "Size:  $(du -h "${DEB}" | cut -f1)"
dpkg-deb --info "${DEB}" | grep -E 'Package|Version|Architecture|Depends'
