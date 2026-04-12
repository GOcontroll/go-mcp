'use strict';

const http = require('http');
const { getSystemInfo }  = require('./lib/system-info');
const { getModules, updateModules, overwriteModule, listFirmware } = require('./lib/module-detect');
const { getMemSim }      = require('./lib/mem-sim');
const { getMemDiag }     = require('./lib/mem-diag');
const {
  getConnections, getWifiList,
  connectWifi, activateConnection, deactivateConnection,
} = require('./lib/network');
const { getPowerSupply }  = require('./lib/power');
const { getCanInterfaces } = require('./lib/can-info');
const { checkUpdates, listAptUpdates, upgradePackages } = require('./lib/updates');
const { testLeds, testCan } = require('./lib/diagnostics');
const {
  getSubmoduleStatus, getProjectStatus, setupProject, listFiles,
  readFile, writeFile, buildProject,
  runApp, stopApp, getAppOutput,
  generateA2l, getA2lPath,
} = require('./lib/project');

const PORT = 8080;

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('Invalid JSON body')); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;
  console.error(`[${new Date().toISOString()}] ${method} ${url}`);

  try {
    if (method === 'GET' && url === '/api/info') {
      return sendJson(res, 200, getSystemInfo());
    }

    if (method === 'GET' && url === '/api/modules') {
      return sendJson(res, 200, getModules());
    }

    if (method === 'GET' && url === '/api/modules/firmware') {
      return sendJson(res, 200, listFirmware());
    }

    if (method === 'POST' && url === '/api/modules/update') {
      const body = await readBody(req);
      return sendJson(res, 200, updateModules(body.slot));
    }

    if (method === 'POST' && url === '/api/modules/overwrite') {
      const body = await readBody(req);
      if (body.slot === undefined || !body.firmware)
        return sendJson(res, 400, { error: 'slot en firmware zijn vereist', code: 400 });
      return sendJson(res, 200, overwriteModule(body.slot, body.firmware));
    }

    if (method === 'GET' && url === '/api/mem-sim') {
      return sendJson(res, 200, getMemSim());
    }

    if (method === 'GET' && url === '/api/mem-diag') {
      return sendJson(res, 200, getMemDiag());
    }

    if (method === 'GET' && url === '/api/power') {
      return sendJson(res, 200, getPowerSupply());
    }

    if (method === 'GET' && url === '/api/updates') {
      return sendJson(res, 200, await checkUpdates());
    }

    if (method === 'GET' && url === '/api/apt/upgradable') {
      return sendJson(res, 200, listAptUpdates());
    }

    if (method === 'POST' && url === '/api/apt/upgrade') {
      return sendJson(res, 200, upgradePackages());
    }

    if (method === 'GET' && url === '/api/test/leds') {
      return sendJson(res, 200, testLeds());
    }

    if (method === 'GET' && url === '/api/test/can') {
      return sendJson(res, 200, testCan());
    }

    if (method === 'GET' && url === '/api/can') {
      return sendJson(res, 200, getCanInterfaces());
    }

    if (method === 'GET' && url === '/api/network/connections') {
      return sendJson(res, 200, { connections: getConnections() });
    }

    if (method === 'GET' && url === '/api/network/wifi') {
      return sendJson(res, 200, { networks: getWifiList() });
    }

    // POST /api/network/wifi/connect  { "ssid": "...", "password": "..." }
    if (method === 'POST' && url === '/api/network/wifi/connect') {
      const body = await readBody(req);
      if (!body.ssid) return sendJson(res, 400, { error: 'ssid is required', code: 400 });
      return sendJson(res, 200, connectWifi(body.ssid, body.password));
    }

    // POST /api/network/connection/up   { "name": "..." }
    if (method === 'POST' && url === '/api/network/connection/up') {
      const body = await readBody(req);
      if (!body.name) return sendJson(res, 400, { error: 'name is required', code: 400 });
      return sendJson(res, 200, activateConnection(body.name));
    }

    // POST /api/network/connection/down  { "name": "..." }
    if (method === 'POST' && url === '/api/network/connection/down') {
      const body = await readBody(req);
      if (!body.name) return sendJson(res, 400, { error: 'name is required', code: 400 });
      return sendJson(res, 200, deactivateConnection(body.name));
    }

    // --- Project / build / run -------------------------------------------

    if (method === 'GET' && url === '/api/project/status') {
      return sendJson(res, 200, getProjectStatus());
    }

    if (method === 'GET' && url === '/api/project/submodules') {
      return sendJson(res, 200, getSubmoduleStatus());
    }

    if (method === 'POST' && url === '/api/project/setup') {
      return sendJson(res, 200, setupProject());
    }

    if (method === 'GET' && url === '/api/project/files') {
      return sendJson(res, 200, listFiles());
    }

    if (method === 'GET' && url.startsWith('/api/project/file?')) {
      const filePath = new URL(url, 'http://localhost').searchParams.get('path');
      if (!filePath) return sendJson(res, 400, { error: 'path parameter vereist', code: 400 });
      try {
        return sendJson(res, 200, { path: filePath, content: readFile(filePath) });
      } catch (err) {
        return sendJson(res, 400, { error: err.message, code: 400 });
      }
    }

    if (method === 'POST' && url === '/api/project/file') {
      const body = await readBody(req);
      if (!body.path || body.content === undefined)
        return sendJson(res, 400, { error: 'path en content zijn vereist', code: 400 });
      try {
        return sendJson(res, 200, writeFile(body.path, body.content));
      } catch (err) {
        return sendJson(res, 400, { error: err.message, code: 400 });
      }
    }

    if (method === 'POST' && url === '/api/project/build') {
      const body = await readBody(req);
      return sendJson(res, 200, buildProject(body.target));
    }

    if (method === 'POST' && url === '/api/project/run') {
      return sendJson(res, 200, runApp());
    }

    if (method === 'POST' && url === '/api/project/stop') {
      return sendJson(res, 200, stopApp());
    }

    if (method === 'GET' && url.startsWith('/api/project/run/output')) {
      const lines = parseInt(new URL(url, 'http://localhost').searchParams.get('lines') || '50', 10);
      return sendJson(res, 200, getAppOutput(lines));
    }

    if (method === 'POST' && url === '/api/project/a2l/generate') {
      return sendJson(res, 200, generateA2l());
    }

    if (method === 'GET' && url === '/api/project/a2l/download') {
      const a2lPath = getA2lPath();
      if (!a2lPath) return sendJson(res, 404, { error: 'Geen a2l bestand gevonden — genereer eerst een a2l', code: 404 });
      const content = readFile('build/xcp_connected.a2l');
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="xcp_connected.a2l"',
        'Content-Length': Buffer.byteLength(content),
      });
      res.end(content);
      return;
    }

    sendJson(res, 404, { error: 'Not found', code: 404 });
  } catch (err) {
    console.error('Unhandled error:', err);
    sendJson(res, 500, { error: 'Internal server error', code: 500 });
  }
});

server.listen(PORT, () => {
  console.error(`GOcontroll MCP API luistert op poort ${PORT}`);
});
