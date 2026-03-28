'use strict';

const { execSync, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const TOTAL_SLOTS   = 8;
const FIRMWARE_DIR  = '/usr/lib/firmware/gocontroll';

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

function getModules() {
  const slots = Array.from({ length: TOTAL_SLOTS }, (_, i) => ({
    slot: i + 1,
    module: null,
    hw_version: null,
    sw_version: null,
  }));

  let output;
  try {
    output = execSync('go-modules scan', { timeout: 10000 }).toString();
  } catch (err) {
    return { slots, source: 'go-modules', error: 'go-modules scan failed: ' + err.message };
  }

  for (const line of output.split('\n')) {
    const parsed = parseModuleLine(line);
    if (!parsed) continue;
    const entry = slots.find((s) => s.slot === parsed.slot);
    if (entry) {
      entry.module = parsed.module;
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
