'use strict';

const { execSync, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const TOTAL_SLOTS   = 8;
const FIRMWARE_DIR  = '/usr/lib/firmware/gocontroll';
const MODULES_FILE  = '/lib/firmware/gocontroll/modules';

const MODULE_NAMES = {
  '20-10-1': '6 channel input',
  '20-10-2': '10 channel input',
  '20-10-3': '4-20mA input',
  '20-20-1': '2 channel power bridge',
  '20-20-2': '6 channel output',
  '20-30-3': 'IR communication',
};

// Parses: "slot 1: 10 Channel Input module version 6 sw: 1.0.0"
function parseModuleLine(line) {
  const match = line.match(/slot\s+(\d+):\s+(.+?)\s+version\s+(\d+)\s+sw:\s+([\d.]+)/i);
  if (!match) return null;
  return {
    slot: parseInt(match[1]),
    module: match[2].trim(),
    hw_version: parseInt(match[3]),
    sw_version: match[4].trim(),
  };
}

// Reads /lib/firmware/gocontroll/modules and returns per-slot metadata
// Format (8 colon-separated entries per line):
//   line 1: type strings  e.g. "20-10-2-6-1-0-0"
//   line 2: manufacturer IDs
//   line 3: QR codes front
//   line 4: QR codes back
function readModulesFile() {
  try {
    const lines = fs.readFileSync(MODULES_FILE, 'utf8').split('\n');
    const layouts      = (lines[0] || '').split(':');
    const manufacturers = (lines[1] || '').split(':');
    const qrFront      = (lines[2] || '').split(':');
    const qrBack       = (lines[3] || '').split(':');

    const result = {};
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const layout = layouts[i] || '';
      if (!layout) continue;

      const parts     = layout.split('-');
      const type_code = parts.slice(0, 3).join('-');
      result[i + 1] = {
        type_code,
        type_name:    MODULE_NAMES[type_code] || null,
        manufacturer: manufacturers[i] || null,
        qr_front:     qrFront[i] || null,
        qr_back:      qrBack[i] || null,
      };
    }
    return result;
  } catch {
    return {};
  }
}

function getModules() {
  const slots = Array.from({ length: TOTAL_SLOTS }, (_, i) => ({
    slot: i + 1,
    module: null,
    hw_version: null,
    sw_version: null,
    type_code: null,
    manufacturer: null,
    qr_front: null,
    qr_back: null,
  }));

  // Enrich with cached metadata from modules file (QR codes, manufacturer)
  const fileData = readModulesFile();
  for (const entry of slots) {
    const fd = fileData[entry.slot];
    if (fd) {
      entry.type_code   = fd.type_code;
      entry.manufacturer = fd.manufacturer;
      entry.qr_front    = fd.qr_front;
      entry.qr_back     = fd.qr_back;
    }
  }

  let output;
  try {
    output = execSync('go-modules scan', { timeout: 10000 }).toString();
  } catch (err) {
    return { slots, source: 'modules-file', error: 'go-modules scan failed: ' + err.message };
  }

  for (const line of output.split('\n')) {
    const parsed = parseModuleLine(line);
    if (!parsed) continue;
    const entry = slots.find((s) => s.slot === parsed.slot);
    if (entry) {
      entry.module     = parsed.module;
      entry.hw_version = parsed.hw_version;
      entry.sw_version = parsed.sw_version;
    }
  }

  return { slots, source: 'go-modules' };
}

function updateModules(slot) {
  const target = slot !== undefined ? String(slot) : 'all';
  const r = spawnSync('go-modules', ['update', target], { timeout: 60000, encoding: 'utf8' });
  return {
    success: r.status === 0,
    target,
    output: (r.stdout || '') + (r.stderr || ''),
  };
}

function overwriteModule(slot, firmware) {
  // Only allow filenames, no path traversal
  const basename = path.basename(firmware);
  const firmwarePath = path.join(FIRMWARE_DIR, basename);

  if (!fs.existsSync(firmwarePath)) {
    return { success: false, error: `Firmware bestand niet gevonden: ${basename}` };
  }

  const r = spawnSync('go-modules', ['overwrite', String(slot), firmwarePath],
    { timeout: 60000, encoding: 'utf8' });
  return {
    success: r.status === 0,
    slot,
    firmware: basename,
    output: (r.stdout || '') + (r.stderr || ''),
  };
}

function listFirmware() {
  if (!fs.existsSync(FIRMWARE_DIR)) return { files: [] };
  const files = fs.readdirSync(FIRMWARE_DIR).filter((f) => f.endsWith('.srec'));
  return { files, firmware_dir: FIRMWARE_DIR };
}

module.exports = { getModules, updateModules, overwriteModule, listFirmware };
