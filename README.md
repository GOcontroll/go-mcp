# GOcontroll Moduline MCP — Overview

## Architecture

```
Claude Desktop  ──HTTP :8080──►  gocontroll-mcp.service  (Node.js, /opt/gocontroll/go-mcp/)
     │                                                              │
     └──mDNS _gocontroll-mcp._tcp──────────────────────────────────┘
```

Two components:
- **Controller API** — Node.js HTTP server on the Moduline (`/opt/gocontroll/go-mcp/`)
- **MCPB bundle** — MCP server on the user's PC, installed via `.mcpb` file

---

## Controller API — Endpoints

| Endpoint | Method | Function |
|----------|--------|----------|
| `/api/info` | GET | Hostname, serial number, model, uptime, kernel, Node-RED status, IP/MAC |
| `/api/modules` | GET | 8 module slots: name, hw/sw version (via `go-modules scan`) |
| `/api/modules/firmware` | GET | Available firmware files in `/usr/lib/firmware/gocontroll/` |
| `/api/modules/update` | POST | Update module firmware — `{ slot: "all" \| 1-8 }` |
| `/api/modules/overwrite` | POST | Overwrite module firmware — `{ slot, firmware }` |
| `/api/mem-sim` | GET | Live signal values from `/usr/mem-sim/` (Simulink/Node-RED) |
| `/api/mem-diag` | GET | Active J1939 DTC fault codes from `/usr/mem-diag/` |
| `/api/power` | GET | K30 (battery) and K15-A/B/C (ignition) in mV and V (via IIO/MCP3004) |
| `/api/can` | GET | CAN interfaces can0–can6 + can-mbm1–3: bitrate, up/down state |
| `/api/updates` | GET | Compare installed files against latest GitHub release (GOcontroll-Moduline) |
| `/api/test/leds` | GET | LED hardware test via `go-test-leds` |
| `/api/test/can` | GET | CAN hardware test via `go-test-can` (requires physical loopback) |
| `/api/network/connections` | GET | Ethernet, WiFi, GSM connections via NetworkManager |
| `/api/network/wifi` | GET | Available WiFi networks (SSID, signal, security) |
| `/api/network/wifi/connect` | POST | Connect to WiFi — `{ ssid, password }` |
| `/api/network/connection/up` | POST | Activate a connection — `{ name }` |
| `/api/network/connection/down` | POST | Deactivate a connection — `{ name }` |

Error format: `{ "error": "...", "code": 404 }`

---

## MCP Tools — MCPB bundle

| Tool | Parameters | Calls |
|------|-----------|-------|
| `discover_controllers` | — | mDNS scan, fallback to known addresses |
| `get_controller_info` | `host` | `/api/info` |
| `get_modules` | `host` | `/api/modules` |
| `list_module_firmware` | `host` | `/api/modules/firmware` |
| `update_modules` | `host`, `slot` | `/api/modules/update` |
| `overwrite_module` | `host`, `slot`, `firmware` | `/api/modules/overwrite` |
| `get_mem_sim` | `host` | `/api/mem-sim` |
| `get_dtc_codes` | `host` | `/api/mem-diag` |
| `get_power_supply` | `host` | `/api/power` |
| `get_can_interfaces` | `host` | `/api/can` |
| `check_for_updates` | `host` | `/api/updates` — compare against GitHub releases |
| `test_leds` | `host` | `/api/test/leds` |
| `test_can` | `host` | `/api/test/can` — requires physical CAN loopback |
| `get_network_connections` | `host` | `/api/network/connections` |
| `scan_wifi` | `host` | `/api/network/wifi` |
| `connect_wifi` | `host`, `ssid`, `password?` | `/api/network/wifi/connect` |
| `set_network_connection` | `host`, `name`, `action` | `/api/network/connection/up\|down` |

---

## Infrastructure

| Component | Location | Status |
|-----------|----------|--------|
| systemd service | `/etc/systemd/system/gocontroll-mcp.service` | `enabled`, `Restart=always` |
| Avahi mDNS | `/etc/avahi/services/gocontroll-mcp.service` | `_gocontroll-mcp._tcp:8080` |

```bash
systemctl status gocontroll-mcp
journalctl -u gocontroll-mcp -f
```

---

## Adding Extensions

**1. API endpoint** — create `lib/feature.js`, add route in `server.js`, restart service.

**2. MCP tool** — add `server.tool(...)` in `mcpb/server/index.js`, rebuild bundle via GitHub Actions.

---

## Project / Build / Run API

Project path: `/home/project/GOcontroll-Project`

| Endpoint | Method | Function |
|----------|--------|----------|
| `/api/project/status` | GET | Git commit, app.elf present, app running/stopped |
| `/api/project/setup` | POST | Git clone or pull + submodule update |
| `/api/project/files` | GET | Files in `application/` and `examples/` |
| `/api/project/file?path=...` | GET | Read a project file's content |
| `/api/project/file` | POST | Write file to `application/` — `{ path, content }` |
| `/api/project/build` | POST | `make clean && make [target]` — returns full compiler output |
| `/api/project/run` | POST | Start `build/app.elf` as a background process |
| `/api/project/stop` | POST | Stop running app with SIGTERM |
| `/api/project/run/output?lines=N` | GET | Last N lines of stdout/stderr from the app |

### MCP tools — project/build/run

| Tool | Parameters | Description |
|------|-----------|-------------|
| `get_project_status` | `host` | Status overview: git, build, running |
| `setup_project` | `host` | Clone or update the project |
| `list_project_files` | `host` | Files in application/ and examples/ |
| `read_project_file` | `host`, `path` | Read source file (including examples) |
| `write_project_file` | `host`, `path`, `content` | Write C code to application/ |
| `build_project` | `host`, `target?` | Compile with make, returns compiler output |
| `run_app` | `host` | Start build/app.elf in the background |
| `stop_app` | `host` | Stop the running application |
| `get_app_output` | `host`, `lines?` | Read recent stdout/stderr from the app |

### Typical workflow

1. `get_project_status` — check if project is ready
2. `list_project_files` + `read_project_file` — review examples
3. `write_project_file` — write `application/main.c`
4. `build_project` — compile, check output for errors
5. `run_app` — start the app
6. `get_app_output` — view output / debug

---

## Planned Extensions

| Feature | Endpoint | Tool |
|---------|----------|------|
| Read input channel | `GET /api/input/:slot/:channel` | `read_input` |
| Control output module | `POST /api/output` | `set_output` |
| Read CAN message | `GET /api/can/:iface/recv` | `read_can` |
| Send CAN message | `POST /api/can/:iface/send` | `send_can` |
| Read log file | `GET /api/log` | `tail_log` |
| Controller temperature | `GET /api/temperature` | `get_temperature` |
| Change CAN bitrate | `POST /api/can/:iface/bitrate` | `set_can_bitrate` |
