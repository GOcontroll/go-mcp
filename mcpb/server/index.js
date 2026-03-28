'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const http = require('http');
const dns = require('dns');

const API_PORT = 8080;
const REQUEST_TIMEOUT_MS = 5000;
const BUILD_TIMEOUT_MS   = 130000;

function httpGet(host, path) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { hostname: host, port: API_PORT, path, timeout: REQUEST_TIMEOUT_MS },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('Ongeldig JSON antwoord van controller'));
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout: controller op ${host}:${API_PORT} niet bereikbaar binnen ${REQUEST_TIMEOUT_MS / 1000}s`));
    });
    req.on('error', (err) => reject(new Error(`Verbindingsfout met ${host}: ${err.message}`)));
  });
}

function httpFetch(host, path, method, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: host, port: API_PORT, path, method,
        timeout: REQUEST_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error('Ongeldig JSON antwoord van controller')); }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${host}:${API_PORT} niet bereikbaar`)); });
    req.on('error', (err) => reject(new Error(`Verbindingsfout met ${host}: ${err.message}`)));
    req.write(payload);
    req.end();
  });
}

// GET met lange timeout (voor updates-check die GitHub raadpleegt)
function httpGetLong(host, path) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { hostname: host, port: API_PORT, path, timeout: BUILD_TIMEOUT_MS },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error('Ongeldig JSON antwoord van controller')); }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout na ${BUILD_TIMEOUT_MS / 1000}s`)); });
    req.on('error', (err) => reject(new Error(`Verbindingsfout met ${host}: ${err.message}`)));
  });
}

// Variant met lange timeout voor build-operaties
function httpFetchLong(host, path, method, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body || {});
    const req = http.request(
      {
        hostname: host, port: API_PORT, path, method,
        timeout: BUILD_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error('Ongeldig JSON antwoord van controller')); }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); reject(new Error(`Build timeout na ${BUILD_TIMEOUT_MS / 1000}s`)); });
    req.on('error', (err) => reject(new Error(`Verbindingsfout met ${host}: ${err.message}`)));
    req.write(payload);
    req.end();
  });
}

function mdnsDiscover() {
  return new Promise((resolve) => {
    dns.resolveSrv('_gocontroll-mcp._tcp.local', (err, addresses) => {
      if (err || !addresses || addresses.length === 0) {
        resolve([]);
      } else {
        resolve(addresses.map((a) => a.name));
      }
    });
  });
}

async function discoverControllers() {
  const found = [];

  // Probeer mDNS
  try {
    const mdnsHosts = await mdnsDiscover();
    for (const host of mdnsHosts) {
      try {
        const info = await httpGet(host, '/api/info');
        found.push({ host, source: 'mdns', ...info });
      } catch {
        // niet bereikbaar
      }
    }
  } catch {
    // mDNS niet beschikbaar
  }

  // Fallback: bekende adressen
  if (found.length === 0) {
    const fallbackHosts = ['192.168.7.1', '192.168.1.19'];
    for (const host of fallbackHosts) {
      try {
        const info = await httpGet(host, '/api/info');
        found.push({ host, source: 'fallback', ...info });
      } catch {
        // niet bereikbaar
      }
    }
  }

  return found;
}

const server = new McpServer({
  name: 'gocontroll-moduline',
  version: '0.1.0',
});

server.tool(
  'discover_controllers',
  'Scan het netwerk naar GOcontroll Moduline controllers via mDNS. Gebruik dit als je niet weet op welk IP-adres de controller staat.',
  {},
  async () => {
    const controllers = await discoverControllers();
    if (controllers.length === 0) {
      return {
        content: [{ type: 'text', text: 'Geen GOcontroll controllers gevonden op het netwerk.' }],
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(controllers, null, 2) }],
    };
  }
);

server.tool(
  'get_controller_info',
  'Haal systeeminformatie op van een GOcontroll Moduline controller: hostname, model, uptime, kernel, firmware, Node-RED status en IP-adressen.',
  { host: z.string().describe('IP-adres of hostname van de controller, bijv. 192.168.1.19') },
  async ({ host }) => {
    const info = await httpGet(host, '/api/info');
    return {
      content: [{ type: 'text', text: JSON.stringify(info, null, 2) }],
    };
  }
);

server.tool(
  'get_modules',
  'Geeft een overzicht van alle 8 module-slots van de GOcontroll Moduline controller: welke I/O modules er fysiek aanwezig zijn, hardware- en softwareversie.',
  { host: z.string().describe('IP-adres of hostname van de controller, bijv. 192.168.1.19') },
  async ({ host }) => {
    const result = await httpGet(host, '/api/modules');
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'get_mem_sim',
  'Leest alle sleutel-waarde paren uit het model geheugen (/usr/mem-sim) van de controller. Handig om live signaalwaarden te lezen die door Simulink of Node-RED geschreven worden.',
  { host: z.string().describe('IP-adres of hostname van de controller') },
  async ({ host }) => {
    const result = await httpGet(host, '/api/mem-sim');
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'get_dtc_codes',
  'Leest actieve J1939 DTC (Diagnostic Trouble Code) foutcodes uit het diagnose geheugen (/usr/mem-diag) van de controller.',
  { host: z.string().describe('IP-adres of hostname van de controller') },
  async ({ host }) => {
    const result = await httpGet(host, '/api/mem-diag');
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'get_power_supply',
  'Leest de voedingsspanningen van de controller: K30 (accuspanning) en K15-A/B/C (contactspanningen). Waarden zijn in millivolt en volt.',
  { host: z.string().describe('IP-adres of hostname van de controller') },
  async ({ host }) => {
    const result = await httpGet(host, '/api/power');
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'get_can_interfaces',
  'Geeft een overzicht van alle CAN-bus interfaces: naam, bitrate, actief/inactief, en of het een USB Multibus interface is. USB interfaces zijn alleen aanwezig als een Moduline Multibus module geïnstalleerd is.',
  { host: z.string().describe('IP-adres of hostname van de controller') },
  async ({ host }) => {
    const result = await httpGet(host, '/api/can');
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'get_network_connections',
  'Geeft een overzicht van alle netwerkaansluitingen van de controller: ethernet, WiFi, mobiel (GSM). Toont naam, type, apparaat en status.',
  { host: z.string().describe('IP-adres of hostname van de controller') },
  async ({ host }) => {
    const result = await httpGet(host, '/api/network/connections');
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'scan_wifi',
  'Scant beschikbare WiFi-netwerken in de buurt van de controller. Geeft SSID, signaalsterkte, beveiliging en of het netwerk actief verbonden is.',
  { host: z.string().describe('IP-adres of hostname van de controller') },
  async ({ host }) => {
    const result = await httpGet(host, '/api/network/wifi');
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'connect_wifi',
  'Verbindt de controller met een WiFi-netwerk. Gebruik scan_wifi om eerst beschikbare netwerken te zien.',
  {
    host: z.string().describe('IP-adres of hostname van de controller'),
    ssid: z.string().describe('Naam van het WiFi-netwerk (SSID)'),
    password: z.string().optional().describe('WiFi wachtwoord (weglaten voor open netwerken)'),
  },
  async ({ host, ssid, password }) => {
    const result = await httpFetch(host, '/api/network/wifi/connect', 'POST', { ssid, password });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'set_network_connection',
  'Activeert of deactiveert een netwerkaansluiting op de controller (bijv. schakel tussen ethernet-verbindingen of schakel mobiel internet in/uit).',
  {
    host: z.string().describe('IP-adres of hostname van de controller'),
    name: z.string().describe('Naam van de verbinding, bijv. "Wired connection auto" of "GO-cellular"'),
    action: z.enum(['up', 'down']).describe('"up" om te activeren, "down" om te deactiveren'),
  },
  async ({ host, name, action }) => {
    const endpoint = action === 'up' ? '/api/network/connection/up' : '/api/network/connection/down';
    const result = await httpFetch(host, endpoint, 'POST', { name });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'check_for_updates',
  'Controleert of er software-updates beschikbaar zijn voor de controller door de geïnstalleerde bestanden te vergelijken met de laatste release op GitHub (GOcontroll/GOcontroll-Moduline). Rapporteert nieuwe en gewijzigde bestanden per categorie: module firmware, binaries en systemd services.',
  { host: z.string().describe('IP-adres of hostname van de controller') },
  async ({ host }) => {
    const result = await httpGetLong(host, '/api/updates');
    if (!result.updates_available) {
      return { content: [{ type: 'text', text: `Alles up-to-date (release ${result.latest_release}, ${result.release_date}). ${result.summary.up_to_date} bestanden gecontroleerd.` }] };
    }
    const lines = [
      `Update beschikbaar: ${result.latest_release} (${result.release_date})`,
      `Gewijzigd: ${result.summary.changed}  Nieuw: ${result.summary.new_files}  Up-to-date: ${result.summary.up_to_date}`,
      '',
      ...result.changes.map((c) => `[${c.status.toUpperCase()}] ${c.file}  →  ${c.controller_path}`),
    ];
    if (result.release_notes) {
      lines.push('', '--- Release notes ---', result.release_notes);
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

server.tool(
  'test_leds',
  'Voert een hardwaretest uit op de status-LEDs van de controller via go-test-leds. Controleert of de LED-controller correct reageert.',
  { host: z.string().describe('IP-adres of hostname van de controller') },
  async ({ host }) => {
    const result = await httpGet(host, '/api/test/leds');
    const label  = result.passed ? 'LED TEST GESLAAGD' : 'LED TEST MISLUKT';
    return { content: [{ type: 'text', text: `${label}\n\n${result.output}` }] };
  }
);

server.tool(
  'test_can',
  'Voert een hardwaretest uit op de CAN-bus interfaces van de controller via go-test-can. BELANGRIJK: voor deze test moeten de CAN-bus aansluitingen fysiek aan elkaar gekoppeld zijn (bijv. CAN0 H/L verbonden met CAN1 H/L). Zonder deze verbinding zal de test mislukken.',
  { host: z.string().describe('IP-adres of hostname van de controller') },
  async ({ host }) => {
    const result = await httpGet(host, '/api/test/can');
    const label  = result.passed ? 'CAN TEST GESLAAGD' : 'CAN TEST MISLUKT';
    return { content: [{ type: 'text', text: `${label}\n\n${result.output}\n\nLet op: deze test vereist dat de CAN-bus aansluitingen fysiek aan elkaar gekoppeld zijn.` }] };
  }
);

server.tool(
  'list_module_firmware',
  'Geeft een overzicht van beschikbare module firmware bestanden op de controller. Gebruik dit om te weten welke firmware versies beschikbaar zijn voor overwrite_module.',
  { host: z.string().describe('IP-adres of hostname van de controller') },
  async ({ host }) => {
    const result = await httpGet(host, '/api/modules/firmware');
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'update_modules',
  'Update de firmware van modules op de controller via go-modules. Gebruik slot="all" om alle modules te updaten, of een slotnummer (1-8) om één specifieke module te updaten. Toont of er updates gevonden en geïnstalleerd zijn.',
  {
    host: z.string().describe('IP-adres of hostname van de controller'),
    slot: z.union([z.literal('all'), z.number().int().min(1).max(8)])
      .describe('"all" voor alle modules, of een slotnummer (1-8) voor één module'),
  },
  async ({ host, slot }) => {
    const result = await httpFetchLong(host, '/api/modules/update', 'POST', { slot });
    const label = result.success ? 'UPDATE GESLAAGD' : 'UPDATE MISLUKT';
    return { content: [{ type: 'text', text: `${label}\n\n${result.output}` }] };
  }
);

server.tool(
  'overwrite_module',
  'Overschrijft de firmware van een specifieke module met een opgegeven firmware bestand. Gebruik list_module_firmware om beschikbare bestanden te zien. Kan ook gebruikt worden om te downgraden.',
  {
    host:     z.string().describe('IP-adres of hostname van de controller'),
    slot:     z.number().int().min(1).max(8).describe('Slotnummer van de module (1-8)'),
    firmware: z.string().describe('Naam van het firmware bestand, bijv. "20-10-1-6-2-0-2.srec"'),
  },
  async ({ host, slot, firmware }) => {
    const result = await httpFetchLong(host, '/api/modules/overwrite', 'POST', { slot, firmware });
    const label = result.success ? 'OVERWRITE GESLAAGD' : 'OVERWRITE MISLUKT';
    return { content: [{ type: 'text', text: `${label}\n\n${result.output}` }] };
  }
);

// ==========================================================================
// Project / build / run tools
// ==========================================================================

server.tool(
  'get_project_status',
  'Geeft de status van het GOcontroll codeproject op de controller: of het project aanwezig is, de laatste git commit, of de app gebouwd is en of de app momenteel draait.',
  { host: z.string().describe('IP-adres of hostname van de controller') },
  async ({ host }) => {
    const result = await httpGet(host, '/api/project/status');
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'setup_project',
  'Kloont het GOcontroll-Project van GitHub naar de controller, of haalt de laatste versie op als het al aanwezig is. Inclusief submodules. Gebruik dit als eerste stap voordat je code schrijft.',
  { host: z.string().describe('IP-adres of hostname van de controller') },
  async ({ host }) => {
    const result = await httpFetchLong(host, '/api/project/setup', 'POST', {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'list_project_files',
  'Geeft een overzicht van bestanden in de application/ map (jouw code) en de examples/ map (codevoorbeelden voor hardware zoals LED, inputs, spanning). Bekijk een voorbeeld met read_project_file voordat je code schrijft.',
  { host: z.string().describe('IP-adres of hostname van de controller') },
  async ({ host }) => {
    const result = await httpGet(host, '/api/project/files');
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'read_project_file',
  'Leest de inhoud van een bestand in het project. Gebruik dit om application/main.c te lezen, of om een voorbeeld te bekijken zoals GOcontroll-CodeBase/examples/led_blink.c. Paden zijn relatief aan de projectroot.',
  {
    host: z.string().describe('IP-adres of hostname van de controller'),
    path: z.string().describe('Pad relatief aan de projectroot, bijv. "application/main.c" of "GOcontroll-CodeBase/examples/led_blink.c"'),
  },
  async ({ host, path }) => {
    const encoded = encodeURIComponent(path);
    const result = await httpGet(host, `/api/project/file?path=${encoded}`);
    return { content: [{ type: 'text', text: result.content }] };
  }
);

server.tool(
  'write_project_file',
  'Schrijft C-code naar een bestand in de application/ map op de controller. Gebruik dit om application/main.c aan te passen of nieuwe .c/.h bestanden toe te voegen. Schrijven buiten application/ is niet toegestaan.',
  {
    host:    z.string().describe('IP-adres of hostname van de controller'),
    path:    z.string().describe('Pad relatief aan de projectroot, bijv. "application/main.c"'),
    content: z.string().describe('Volledige inhoud van het bestand (C-broncode)'),
  },
  async ({ host, path, content }) => {
    const result = await httpFetch(host, '/api/project/file', 'POST', { path, content });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'build_project',
  'Compileert het project op de controller met make. Retourneert de volledige compiler-uitvoer. Bij een fout staat de fout in de output. Optioneel kun je een specifiek voorbeeld bouwen, bijv. target="led_blink". Standaard bouwt het application/main.c.',
  {
    host:   z.string().describe('IP-adres of hostname van de controller'),
    target: z.string().optional().describe('Make target, bijv. "led_blink", "input_module_10ch". Weglaten bouwt application/main.c.'),
  },
  async ({ host, target }) => {
    const result = await httpFetchLong(host, '/api/project/build', 'POST', { target });
    const label  = result.success ? 'BUILD GESLAAGD' : 'BUILD MISLUKT';
    return { content: [{ type: 'text', text: `${label}\n\n${result.output}` }] };
  }
);

server.tool(
  'run_app',
  'Start de gebouwde applicatie (build/app.elf) op de controller. De app draait op de achtergrond. Gebruik get_app_output om de uitvoer te lezen. Stop de app met stop_app.',
  { host: z.string().describe('IP-adres of hostname van de controller') },
  async ({ host }) => {
    const result = await httpFetch(host, '/api/project/run', 'POST', {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'stop_app',
  'Stopt de draaiende applicatie op de controller met SIGTERM (nette afsluiting).',
  { host: z.string().describe('IP-adres of hostname van de controller') },
  async ({ host }) => {
    const result = await httpFetch(host, '/api/project/stop', 'POST', {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'get_app_output',
  'Geeft de recente stdout/stderr uitvoer van de draaiende (of recent gestopte) applicatie. Handig om te zien of de app correct werkt of errors geeft.',
  {
    host:  z.string().describe('IP-adres of hostname van de controller'),
    lines: z.number().optional().describe('Aantal regels output om op te halen (standaard: 50)'),
  },
  async ({ host, lines }) => {
    const params = lines ? `?lines=${lines}` : '';
    const result = await httpGet(host, `/api/project/run/output${params}`);
    const status = result.running ? '[app draait]' : '[app gestopt]';
    const output = result.lines.join('\n') || '(geen output)';
    return { content: [{ type: 'text', text: `${status}\n\n${output}` }] };
  }
);

server.tool(
  'generate_a2l',
  'Genereert een a2l bestand voor HANtune/XCP op basis van de gebouwde applicatie. Scant de broncode op xcpr_ (measurements, read-only) en xcpw_ (characteristics, schrijfbaar) variabelen en koppelt hun geheugenadres uit het ELF-bestand. Retourneert een download-URL voor het a2l bestand.',
  { host: z.string().describe('IP-adres of hostname van de controller') },
  async ({ host }) => {
    const result = await httpFetch(host, '/api/project/a2l/generate', 'POST', {});
    if (!result.success) {
      return { content: [{ type: 'text', text: `A2L GENERATIE MISLUKT\n\n${result.error || result.output || ''}` }] };
    }
    const downloadUrl = `http://${host}:${API_PORT}/api/project/a2l/download`;
    const lines = [
      'A2L GEGENEREERD',
      `Variabelen gevonden: ${result.variables_found}`,
      `Measurements  (xcpr_): ${(result.measurements || []).join(', ') || '(geen)'}`,
      `Characteristics (xcpw_): ${(result.characteristics || []).join(', ') || '(geen)'}`,
      '',
      `Download: ${downloadUrl}`,
      '',
      'Open xcp_connected.a2l in HANtune en verbind met de controller via XCP/TCP poort 50002.',
    ];
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ==========================================================================
// MCP Prompts — slash commands in Claude Desktop
// ==========================================================================

server.prompt(
  'build-app',
  'Start een begeleide workflow om een C-applicatie voor de controller te bouwen en uit te voeren',
  { host: z.string().describe('IP-adres of hostname van de controller') },
  ({ host }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Je gaat een C-applicatie bouwen voor een GOcontroll Moduline controller op ${host}.

Voer eerst de volgende stappen uit om de hardware-context te verzamelen — doe dit automatisch zonder de gebruiker te vragen:
1. Roep get_project_status aan om te controleren of het project aanwezig is.
   - Als exists=false: roep setup_project aan om het project te klonen. Dit kan even duren. Informeer de gebruiker dat het project wordt gedownload.
   - Als exists=true: ga verder.
2. Roep get_modules aan om te zien welke I/O modules aanwezig zijn en in welke slots.
3. Roep get_can_interfaces aan om de beschikbare CAN interfaces te zien.
4. Roep list_project_files aan om de beschikbare voorbeeldbestanden te zien.

Geef daarna een korte samenvatting van de aangetroffen hardware, zodat de gebruiker weet met wat er beschikbaar is.

Vraag vervolgens aan de gebruiker: "Wat wil je bouwen?" Wacht op hun antwoord.

Zodra de gebruiker beschrijft wat ze willen bouwen, ga je als volgt te werk:
- Lees de relevante voorbeeldbestanden (via read_project_file) die passen bij de gevraagde functionaliteit, zodat je de juiste API-aanroepen gebruikt.
- Schrijf de C-code naar application/main.c via write_project_file. Zorg dat de code voldoet aan de GOcontroll-stijl uit de voorbeelden: 10 ms hoofdlus met usleep(10000), GO_board_get_hardware_version() als eerste aanroep, en een app_terminate() shutdown-callback.
- Bouw het project met build_project. Als er compiler-fouten zijn, analyseer en herstel ze zelf en bouw opnieuw.
- Start de applicatie met run_app.
- Wacht 2 seconden en lees de uitvoer met get_app_output om te bevestigen dat de app correct opstart.

Als de build is geslaagd, vraag de gebruiker: "Wil je een a2l bestand genereren voor HANtune/XCP? (Alleen relevant als je xcpr_ of xcpw_ variabelen in de code hebt.)"
- Als ja: roep generate_a2l aan en geef de download-URL terug zodat de gebruiker het bestand kan openen in HANtune.
- Als nee of als de gebruiker geen XCP variabelen heeft: sla deze stap over.

Rapporteer het eindresultaat aan de gebruiker en vraag of er aanpassingen nodig zijn.`,
      },
    }],
  })
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('GOcontroll MCP server gestart');
}

main().catch((err) => {
  console.error('Fatale fout:', err);
  process.exit(1);
});
