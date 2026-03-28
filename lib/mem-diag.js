'use strict';

const fs = require('fs');
const path = require('path');

const MEM_DIAG_PATH = '/usr/mem-diag';

function getMemDiag() {
  const dtcs = [];
  let files;
  try {
    files = fs.readdirSync(MEM_DIAG_PATH);
  } catch {
    return { dtcs, count: 0, error: 'Cannot read ' + MEM_DIAG_PATH };
  }

  for (const file of files) {
    const dtc_code = parseInt(file);
    if (isNaN(dtc_code)) continue;
    try {
      const raw = fs.readFileSync(path.join(MEM_DIAG_PATH, file), 'utf8').trim();
      const value = Number(raw);
      dtcs.push({ dtc: dtc_code, value: isNaN(value) ? raw : value });
    } catch {
      dtcs.push({ dtc: dtc_code, value: null });
    }
  }

  dtcs.sort((a, b) => a.dtc - b.dtc);
  return { dtcs, count: dtcs.length };
}

module.exports = { getMemDiag };
