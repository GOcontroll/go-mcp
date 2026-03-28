'use strict';

const fs = require('fs');
const path = require('path');

const DECIMAL_FACTOR = 3.34 / 1023;

function findMcp3004Path() {
  const base = '/sys/bus/iio/devices';
  try {
    for (const entry of fs.readdirSync(base)) {
      const namePath = path.join(base, entry, 'name');
      try {
        if (fs.readFileSync(namePath, 'utf8').trim() === 'mcp3004') {
          return path.join(base, entry);
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return null;
}

function readRaw(adcPath, channel) {
  const raw = parseInt(fs.readFileSync(path.join(adcPath, `in_voltage${channel}_raw`), 'utf8').trim());
  return Math.round((raw * DECIMAL_FACTOR / 1.5) * 11700);
}

function getPowerSupply() {
  const adcPath = findMcp3004Path();
  if (!adcPath) {
    return { error: 'MCP3004 ADC niet gevonden' };
  }

  const result = {};
  const channels = { K15_A: 0, K15_B: 1, K15_C: 2, K30: 3 };

  for (const [key, ch] of Object.entries(channels)) {
    try {
      result[key] = { voltage_mv: readRaw(adcPath, ch), voltage_v: +(readRaw(adcPath, ch) / 1000).toFixed(2) };
    } catch {
      result[key] = null;
    }
  }

  return result;
}

module.exports = { getPowerSupply };
