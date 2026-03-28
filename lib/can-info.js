'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const INTERFACES_DIR = '/etc/network/interfaces.d';

function parseInterfacesFile(content, filename) {
  const interfaces = {};
  let current = null;

  for (const line of content.split('\n')) {
    const ifaceMatch = line.match(/^(?:auto|allow-hotplug)\s+(can\S+)/);
    if (ifaceMatch) {
      current = ifaceMatch[1];
      if (!interfaces[current]) interfaces[current] = { interface: current, bitrate: null, usb: filename.includes('usb') };
    }
    if (current) {
      const bitrateMatch = line.match(/bitrate\s+(\d+)/);
      if (bitrateMatch) interfaces[current].bitrate = parseInt(bitrateMatch[1]);
    }
  }
  return interfaces;
}

function getLiveCanState(iface) {
  try {
    const out = execSync(`ip -details link show ${iface} 2>/dev/null`, { timeout: 2000 }).toString();
    const stateMatch = out.match(/state\s+(\S+)/);
    const linkMatch = out.match(/<([^>]+)>/);
    const flags = linkMatch ? linkMatch[1].split(',') : [];
    return {
      up: flags.includes('UP'),
      state: stateMatch ? stateMatch[1] : 'UNKNOWN',
    };
  } catch {
    return { up: false, state: 'NOT_FOUND' };
  }
}

function getCanInterfaces() {
  const allInterfaces = {};

  try {
    for (const file of fs.readdirSync(INTERFACES_DIR)) {
      if (!file.includes('can')) continue;
      const content = fs.readFileSync(path.join(INTERFACES_DIR, file), 'utf8');
      const parsed = parseInterfacesFile(content, file);
      Object.assign(allInterfaces, parsed);
    }
  } catch (err) {
    return { interfaces: [], error: err.message };
  }

  const result = Object.values(allInterfaces).map((iface) => {
    const live = getLiveCanState(iface.interface);
    return { ...iface, ...live };
  });

  result.sort((a, b) => a.interface.localeCompare(b.interface));
  return { interfaces: result };
}

module.exports = { getCanInterfaces };
