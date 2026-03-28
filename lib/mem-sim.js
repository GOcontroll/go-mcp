'use strict';

const fs = require('fs');
const path = require('path');

const MEM_SIM_PATH = '/usr/mem-sim';

function getMemSim() {
  const entries = {};
  let files;
  try {
    files = fs.readdirSync(MEM_SIM_PATH);
  } catch {
    return { entries, count: 0, error: 'Cannot read ' + MEM_SIM_PATH };
  }

  for (const file of files) {
    try {
      const value = fs.readFileSync(path.join(MEM_SIM_PATH, file), 'utf8').trim();
      const num = Number(value);
      entries[file] = isNaN(num) ? value : num;
    } catch {
      // skip unreadable files
    }
  }

  return { entries, count: Object.keys(entries).length };
}

module.exports = { getMemSim };
