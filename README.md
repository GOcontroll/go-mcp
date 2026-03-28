# GOcontroll Moduline MCP — Overzicht

## Architectuur

```
Claude Desktop  ──HTTP :8080──►  gocontroll-mcp.service  (Node.js, /opt/gocontroll/mcp-api/)
     │                                                              │
     └──mDNS _gocontroll-mcp._tcp──────────────────────────────────┘
```

Twee componenten:
- **Controller API** — Node.js HTTP server op de Moduline (`/opt/gocontroll/mcp-api/`)
- **MCPB bundle** — MCP server op de PC van de gebruiker (`/opt/gocontroll/mcpb-bundle/`)

---

## Controller API — Endpoints

| Endpoint | Methode | Functie |
|----------|---------|---------|
| `/api/info` | GET | Hostname, serienummer, model, uptime, kernel, Node-RED status, IP/MAC |
| `/api/modules` | GET | 8 module-slots: naam, hw/sw versie (via `go-modules scan`) |
| `/api/modules/firmware` | GET | Beschikbare firmware bestanden in `/usr/lib/firmware/gocontroll/` |
| `/api/modules/update` | POST | Module firmware updaten — `{ slot: "all" \| 1-8 }` |
| `/api/modules/overwrite` | POST | Module firmware overschrijven — `{ slot, firmware }` |
| `/api/mem-sim` | GET | Live signaalwaarden uit `/usr/mem-sim/` (Simulink/Node-RED) |
| `/api/mem-diag` | GET | Actieve J1939 DTC foutcodes uit `/usr/mem-diag/` |
| `/api/power` | GET | K30 (accu) en K15-A/B/C (contact) in mV en V (via IIO/MCP3004) |
| `/api/can` | GET | CAN interfaces can0–can6 + can-mbm1–3: bitrate, up/down |
| `/api/updates` | GET | Vergelijkt geïnstalleerde bestanden met laatste GitHub release (GOcontroll-Moduline) |
| `/api/test/leds` | GET | LED hardware test via `go-test-leds` |
| `/api/test/can` | GET | CAN hardware test via `go-test-can` (vereist fysieke koppeling) |
| `/api/network/connections` | GET | Ethernet, WiFi, GSM verbindingen via NetworkManager |
| `/api/network/wifi` | GET | Beschikbare WiFi-netwerken (SSID, signaal, beveiliging) |
| `/api/network/wifi/connect` | POST | Verbinden met WiFi — `{ ssid, password }` |
| `/api/network/connection/up` | POST | Verbinding activeren — `{ name }` |
| `/api/network/connection/down` | POST | Verbinding deactiveren — `{ name }` |

Foutformat: `{ "error": "...", "code": 404 }`

---

## MCP Tools — MCPB bundle

| Tool | Parameters | Roept aan |
|------|-----------|-----------|
| `discover_controllers` | — | mDNS scan, fallback naar bekende adressen |
| `get_controller_info` | `host` | `/api/info` |
| `get_modules` | `host` | `/api/modules` |
| `list_module_firmware` | `host` | `/api/modules/firmware` |
| `update_modules` | `host`, `slot` | `/api/modules/update` |
| `overwrite_module` | `host`, `slot`, `firmware` | `/api/modules/overwrite` |
| `get_mem_sim` | `host` | `/api/mem-sim` |
| `get_dtc_codes` | `host` | `/api/mem-diag` |
| `get_power_supply` | `host` | `/api/power` |
| `get_can_interfaces` | `host` | `/api/can` |
| `check_for_updates` | `host` | `/api/updates` — vergelijkt met GitHub releases |
| `test_leds` | `host` | `/api/test/leds` |
| `test_can` | `host` | `/api/test/can` — vereist fysieke CAN-koppeling |
| `get_network_connections` | `host` | `/api/network/connections` |
| `scan_wifi` | `host` | `/api/network/wifi` |
| `connect_wifi` | `host`, `ssid`, `password?` | `/api/network/wifi/connect` |
| `set_network_connection` | `host`, `name`, `action` | `/api/network/connection/up|down` |

---

## Infrastructuur

| Component | Locatie | Status |
|-----------|---------|--------|
| systemd service | `/etc/systemd/system/gocontroll-mcp.service` | `enabled`, `Restart=always` |
| Avahi mDNS | `/etc/avahi/services/gocontroll-mcp.service` | `_gocontroll-mcp._tcp:8080` |
| MCPB bundle | `/opt/gocontroll/mcpb-bundle/gocontroll-moduline-0.1.0.mcpb` | Klaar voor installatie |

```bash
systemctl status gocontroll-mcp
journalctl -u gocontroll-mcp -f
```

---

## Uitbreidingen toevoegen

**1. API endpoint** — maak `lib/feature.js`, voeg route toe in `server.js`, herstart service.

**2. MCP tool** — voeg `server.tool(...)` toe in `mcpb-bundle/server/index.js`, herbouw bundle:
```bash
cd /opt/gocontroll/mcpb-bundle && mcpb pack && cp mcpb-bundle.mcpb gocontroll-moduline-0.1.0.mcpb
```

---

## Project / build / run API

Project staat op: `/home/project/GOcontroll-Project`

| Endpoint | Methode | Functie |
|----------|---------|---------|
| `/api/project/status` | GET | Git commit, app.elf aanwezig, app draait/gestopt |
| `/api/project/setup` | POST | Git clone of pull + submodule update |
| `/api/project/files` | GET | Bestanden in `application/` en `examples/` |
| `/api/project/file?path=...` | GET | Inhoud van een projectbestand lezen |
| `/api/project/file` | POST | Bestand schrijven naar `application/` — `{ path, content }` |
| `/api/project/build` | POST | `make clean && make [target]` — retourneert volledige output |
| `/api/project/run` | POST | Start `build/app.elf` als achtergrondproces |
| `/api/project/stop` | POST | Stop draaiende app met SIGTERM |
| `/api/project/run/output?lines=N` | GET | Laatste N regels stdout/stderr van de app |

### MCP tools — project/build/run

| Tool | Parameters | Beschrijving |
|------|-----------|--------------|
| `get_project_status` | `host` | Status overzicht: git, build, running |
| `setup_project` | `host` | Clone of update het project |
| `list_project_files` | `host` | Bestanden in application/ en examples/ |
| `read_project_file` | `host`, `path` | Lees bronbestand (ook voorbeelden) |
| `write_project_file` | `host`, `path`, `content` | Schrijf C-code naar application/ |
| `build_project` | `host`, `target?` | Compileer met make, retourneert compiler-output |
| `run_app` | `host` | Start build/app.elf op de achtergrond |
| `stop_app` | `host` | Stop de draaiende applicatie |
| `get_app_output` | `host`, `lines?` | Lees recente stdout/stderr van de app |

### Typische workflow

1. `get_project_status` — check of project klaar is
2. `list_project_files` + `read_project_file` — bekijk voorbeelden
3. `write_project_file` — schrijf `application/main.c`
4. `build_project` — compileer, check output op fouten
5. `run_app` — start de app
6. `get_app_output` — bekijk output / debug

---

## Geplande uitbreidingen

| Feature | Endpoint | Tool |
|---------|----------|------|
| Input kanaal lezen | `GET /api/input/:slot/:channel` | `read_input` |
| Output module aansturen | `POST /api/output` | `set_output` |
| CAN bericht lezen | `GET /api/can/:iface/recv` | `read_can` |
| CAN bericht sturen | `POST /api/can/:iface/send` | `send_can` |
| Logbestand uitlezen | `GET /api/log` | `tail_log` |
| Controller temperatuur | `GET /api/temperature` | `get_temperature` |
| CAN bitrate wijzigen | `POST /api/can/:iface/bitrate` | `set_can_bitrate` |
