'use strict';

const { execSync } = require('child_process');

function nmcli(args) {
  return execSync('nmcli ' + args, { timeout: 8000 }).toString().trim();
}

function getConnections() {
  const lines = nmcli('-t -f NAME,TYPE,DEVICE,STATE connection show').split('\n');
  return lines
    .filter((l) => l.trim())
    .map((line) => {
      const [name, type, device, state] = line.split(':');
      return { name, type, device: device || null, state };
    });
}

function getWifiList() {
  try {
    const lines = nmcli('-t -f SSID,BSSID,SIGNAL,SECURITY,IN-USE device wifi list').split('\n');
    return lines
      .filter((l) => l.trim())
      .map((line) => {
        // nmcli -t uses : as separator but BSSID also has colons — use fixed field splitting
        // nmcli -t escapes colons in BSSID as \:  e.g. GOcontroll:06\:C8\:96\:C0\:E0\:B5:89:WPA2:*
        const parts = line.split(/(?<!\\):/);  // split on colons NOT preceded by backslash
        if (parts.length < 5) return null;
        const active = parts[parts.length - 1] === '*';
        const security = parts[parts.length - 2] || null;
        const signal = parseInt(parts[parts.length - 3]);
        const bssid = parts[parts.length - 4].replace(/\\:/g, ':');
        const ssid = parts.slice(0, parts.length - 4).join(':') || null;
        return { ssid, bssid, signal, security, active };
      })
      .filter(Boolean);
  } catch (err) {
    return { error: err.message };
  }
}

function connectWifi(ssid, password) {
  try {
    const cmd = password
      ? `nmcli device wifi connect "${ssid}" password "${password}"`
      : `nmcli device wifi connect "${ssid}"`;
    const out = execSync(cmd, { timeout: 30000 }).toString().trim();
    return { success: true, message: out };
  } catch (err) {
    return { success: false, message: err.stderr ? err.stderr.toString().trim() : err.message };
  }
}

function activateConnection(name) {
  try {
    const out = nmcli(`connection up "${name}"`);
    return { success: true, message: out };
  } catch (err) {
    return { success: false, message: err.stderr ? err.stderr.toString().trim() : err.message };
  }
}

function deactivateConnection(name) {
  try {
    const out = nmcli(`connection down "${name}"`);
    return { success: true, message: out };
  } catch (err) {
    return { success: false, message: err.stderr ? err.stderr.toString().trim() : err.message };
  }
}

module.exports = { getConnections, getWifiList, connectWifi, activateConnection, deactivateConnection };
