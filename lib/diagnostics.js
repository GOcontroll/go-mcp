'use strict';

const { spawnSync } = require('child_process');

function testLeds() {
  const r = spawnSync('go-test-leds', [], { timeout: 15000, encoding: 'utf8' });
  const passed = r.status === 0;
  return {
    passed,
    output: ((r.stdout || '') + (r.stderr || '')).trim() || (passed ? 'Test geslaagd' : 'Test mislukt'),
  };
}

function testCan() {
  const r = spawnSync('go-test-can', [], { timeout: 15000, encoding: 'utf8' });
  return {
    passed: r.status === 0,
    output: ((r.stdout || '') + (r.stderr || '')).trim(),
  };
}

module.exports = { testLeds, testCan };
