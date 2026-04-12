'use strict';

const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');

function getModel() {
  try {
    return fs.readFileSync('/sys/firmware/devicetree/base/model', 'utf8').replace(/\0/g, '').trim();
  } catch {
    return 'Moduline';
  }
}

function getHardware() {
  try {
    return fs.readFileSync('/sys/firmware/devicetree/base/hardware', 'utf8').replace(/\0/g, '').trim();
  } catch {
    return null;
  }
}

function getOs() {
  try {
    return execSync('lsb_release -ds', { timeout: 2000 }).toString().trim().replace(/^"|"$/g, '');
  } catch {
    return null;
  }
}

function getFirmwareVersion() {
  try {
    return fs.readFileSync('/etc/version', 'utf8').trim();
  } catch {
    return null;
  }
}

function getNodeRedActive() {
  try {
    const result = execSync('systemctl is-active nodered', { timeout: 2000 }).toString().trim();
    return result === 'active';
  } catch {
    return false;
  }
}

function getSerialNumber() {
  try {
    return execSync('go-sn read', { timeout: 3000 }).toString().trim();
  } catch {
    return null;
  }
}

function getMacAddresses() {
  const interfaces = os.networkInterfaces();
  const macs = [];
  for (const [iface, addrs] of Object.entries(interfaces)) {
    if (addrs && addrs[0] && addrs[0].mac && addrs[0].mac !== '00:00:00:00:00:00') {
      macs.push({ interface: iface, mac: addrs[0].mac });
    }
  }
  return macs;
}

function getIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const [iface, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        addresses.push({ interface: iface, address: addr.address });
      }
    }
  }
  return addresses;
}

function getSystemInfo() {
  return {
    hostname: os.hostname(),
    serial_number: getSerialNumber(),
    model: getModel(),
    hardware: getHardware(),
    os: getOs(),
    uptime_seconds: Math.floor(os.uptime()),
    kernel: os.release(),
    firmware_version: getFirmwareVersion(),
    node_red_active: getNodeRedActive(),
    mac_addresses: getMacAddresses(),
    ip_addresses: getIpAddresses(),
  };
}

module.exports = { getSystemInfo };
