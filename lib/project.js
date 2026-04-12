'use strict';

const { spawnSync, spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');

const PROJECT_DIR = '/home/project/GOcontroll-Project';
const APP_ELF     = path.join(PROJECT_DIR, 'build/app.elf');
const PID_FILE    = '/tmp/gocontroll-app.pid';

const MAX_LOG_LINES = 500;
let appOutputBuffer = [];
let runningProcess  = null;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveProjectPath(filePath) {
  const resolved = path.resolve(PROJECT_DIR, filePath);
  return resolved.startsWith(PROJECT_DIR + path.sep) || resolved === PROJECT_DIR
    ? resolved
    : null;
}

function readPid() {
  try { return parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10); }
  catch { return null; }
}

function isAppRunning() {
  if (runningProcess && !runningProcess.killed) {
    try { process.kill(runningProcess.pid, 0); return true; }
    catch { /* process gone */ }
  }
  const pid = readPid();
  if (pid) {
    try { process.kill(pid, 0); return true; }
    catch { /* pid stale */ }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

function getSubmoduleStatus() {
  const exists = fs.existsSync(PROJECT_DIR);
  if (!exists) return { project_dir: PROJECT_DIR, exists: false };

  const r = spawnSync(
    'git', ['submodule', 'status', '--recursive'],
    { cwd: PROJECT_DIR, encoding: 'utf8', timeout: 10000 }
  );

  if (r.status !== 0) throw new Error(r.stderr || 'git submodule status mislukt');

  const submodules = r.stdout.trim().split('\n').filter(Boolean).map((line) => {
    // Format: <prefix><hash> <path> (<describe>)
    const prefix = line[0]; // ' ' = ok, '+' = lokale wijzigingen, '-' = niet geïnitialiseerd, 'U' = conflict
    const rest   = line.slice(1).trim();
    const [hashAndPath, ...descParts] = rest.split(' (');
    const parts  = hashAndPath.split(' ');
    const hash   = parts[0];
    const subPath  = parts[1];
    const describe = descParts.length ? descParts.join(' (').replace(/\)$/, '') : null;

    const stateMap = { ' ': 'ok', '+': 'local_changes', '-': 'not_initialized', 'U': 'conflict' };
    return { path: subPath, hash, state: stateMap[prefix] || prefix, describe };
  });

  return { project_dir: PROJECT_DIR, exists: true, submodules };
}

function getProjectStatus() {
  const exists = fs.existsSync(PROJECT_DIR);
  const status = { project_dir: PROJECT_DIR, exists };

  if (!exists) return status;

  // Last git commit
  const git = spawnSync('git', ['log', '--oneline', '-1'], { cwd: PROJECT_DIR, encoding: 'utf8' });
  status.git_commit = git.stdout ? git.stdout.trim() : null;

  // Build artefact
  status.app_elf_exists = fs.existsSync(APP_ELF);
  if (status.app_elf_exists) {
    status.app_elf_built = fs.statSync(APP_ELF).mtime.toISOString();
  }

  // Running process
  status.app_running = isAppRunning();
  if (status.app_running) status.app_pid = readPid();

  return status;
}

function setupProject() {
  if (!fs.existsSync(PROJECT_DIR)) {
    const r = spawnSync(
      'git', ['clone', '--recurse-submodules',
        'https://github.com/GOcontroll/GOcontroll-Project', PROJECT_DIR],
      { timeout: 180000, encoding: 'utf8' }
    );
    if (r.status !== 0) throw new Error(r.stderr || 'clone mislukt');
    return { action: 'cloned', output: r.stdout + r.stderr };
  }

  const pull = spawnSync('git', ['pull'], { cwd: PROJECT_DIR, timeout: 30000, encoding: 'utf8' });
  const sub  = spawnSync('git', ['submodule', 'update', '--init', '--recursive'],
    { cwd: PROJECT_DIR, timeout: 60000, encoding: 'utf8' });

  return {
    action:           'updated',
    git_pull:         pull.stdout.trim(),
    submodule_update: sub.stdout.trim(),
  };
}

function listFiles() {
  const read = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  return {
    application: read(path.join(PROJECT_DIR, 'application')),
    examples:    read(path.join(PROJECT_DIR, 'GOcontroll-CodeBase/examples')),
  };
}

function readFile(filePath) {
  const safe = resolveProjectPath(filePath);
  if (!safe) throw new Error('Pad buiten project directory niet toegestaan');
  if (!fs.existsSync(safe)) throw new Error(`Bestand niet gevonden: ${filePath}`);
  return fs.readFileSync(safe, 'utf8');
}

function writeFile(filePath, content) {
  const safe = resolveProjectPath(filePath);
  if (!safe) throw new Error('Pad buiten project directory niet toegestaan');

  // Only allow writes inside application/
  const appDir = path.join(PROJECT_DIR, 'application');
  if (!safe.startsWith(appDir + path.sep) && safe !== appDir) {
    throw new Error('Schrijven alleen toegestaan in de application/ map');
  }

  fs.mkdirSync(path.dirname(safe), { recursive: true });
  fs.writeFileSync(safe, content, 'utf8');
  return { written: filePath };
}

function buildProject(target) {
  const args = ['clean', target || 'all'];
  // Only pass user-supplied target (skip 'clean' step when a named example is chosen,
  // as the examples overwrite APP_SRC anyway).
  const makeArgs = target ? [target] : [];

  // Always clean first so a changed main.c is picked up
  spawnSync('make', ['clean'], { cwd: PROJECT_DIR, encoding: 'utf8' });

  const r = spawnSync('make', makeArgs, {
    cwd:      PROJECT_DIR,
    timeout:  120000,
    encoding: 'utf8',
  });

  return {
    success:   r.status === 0,
    output:    (r.stdout || '') + (r.stderr || ''),
    exit_code: r.status,
  };
}

function runApp() {
  if (isAppRunning()) {
    return { error: 'App draait al', pid: readPid() };
  }
  if (!fs.existsSync(APP_ELF)) {
    return { error: 'build/app.elf niet gevonden — bouw eerst het project met build_project' };
  }

  appOutputBuffer = [];

  runningProcess = spawn(APP_ELF, [], { cwd: PROJECT_DIR });

  fs.writeFileSync(PID_FILE, String(runningProcess.pid));

  const addLine = (line) => {
    const entry = `[${new Date().toISOString()}] ${line}`;
    appOutputBuffer.push(entry);
    if (appOutputBuffer.length > MAX_LOG_LINES) appOutputBuffer.shift();
    console.error(entry);
  };

  runningProcess.stdout.on('data', (d) =>
    d.toString().split('\n').filter(Boolean).forEach(addLine));
  runningProcess.stderr.on('data', (d) =>
    d.toString().split('\n').filter(Boolean).forEach(addLine));
  runningProcess.on('exit', (code) => {
    addLine(`[process afgesloten met code ${code}]`);
    try { fs.unlinkSync(PID_FILE); } catch { /* ok */ }
    runningProcess = null;
  });

  return { started: true, pid: runningProcess.pid };
}

function stopApp() {
  if (runningProcess) {
    runningProcess.kill('SIGTERM');
    runningProcess = null;
    try { fs.unlinkSync(PID_FILE); } catch { /* ok */ }
    return { stopped: true };
  }
  const pid = readPid();
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM');
      try { fs.unlinkSync(PID_FILE); } catch { /* ok */ }
      return { stopped: true, pid };
    } catch (err) {
      return { error: `Kan process ${pid} niet stoppen: ${err.message}` };
    }
  }
  return { error: 'Geen draaiende app gevonden' };
}

function getAppOutput(lines) {
  return {
    running: isAppRunning(),
    lines:   appOutputBuffer.slice(-(lines || 50)),
  };
}

// ---------------------------------------------------------------------------
// A2L generation
// ---------------------------------------------------------------------------

const A2L_OUTPUT  = path.join(PROJECT_DIR, 'build/xcp_connected.a2l');
const A2L_SCRIPT  = path.join(PROJECT_DIR, 'GOcontroll-CodeBase/examples/update_xcp_a2l.sh');

// C type → a2l type info
const TYPE_MAP = {
  'uint8_t':  { a2lType: 'UBYTE',        record: 'Record_UBYTE',        cm: 'CM_uint8',  limits: [0,          255       ] },
  'uint16_t': { a2lType: 'UWORD',        record: 'Record_UWORD',        cm: 'CM_uint16', limits: [0,          65535     ] },
  'uint32_t': { a2lType: 'ULONG',        record: 'Record_ULONG',        cm: 'CM_uint32', limits: [0,          4294967295] },
  'int8_t':   { a2lType: 'SBYTE',        record: 'Record_SBYTE',        cm: 'CM_int8',   limits: [-128,       127       ] },
  'int16_t':  { a2lType: 'SWORD',        record: 'Record_SWORD',        cm: 'CM_int16',  limits: [-32768,     32767     ] },
  'int32_t':  { a2lType: 'SLONG',        record: 'Record_SLONG',        cm: 'CM_int32',  limits: [-2147483648,2147483647] },
  'float':    { a2lType: 'FLOAT32_IEEE', record: 'Record_FLOAT32_IEEE', cm: 'CM_single', limits: [-3.4e38,    3.4e38    ] },
  'double':   { a2lType: 'FLOAT64_IEEE', record: 'Record_FLOAT64_IEEE', cm: 'CM_double', limits: [-1.7e308,   1.7e308   ] },
};

function scanXcpVariables() {
  const vars = [];
  const appDir = path.join(PROJECT_DIR, 'application');
  if (!fs.existsSync(appDir)) return vars;

  const files = fs.readdirSync(appDir).filter(f => f.endsWith('.c'));
  const regex = /\bvolatile\s+(\w+)\s+((?:xcpr_|xcpw_)\w+)\s*[=;]/g;

  for (const file of files) {
    const content = fs.readFileSync(path.join(appDir, file), 'utf8');
    let match;
    while ((match = regex.exec(content)) !== null) {
      const [, cType, name] = match;
      const info = TYPE_MAP[cType];
      if (info && !vars.find(v => v.name === name)) {
        vars.push({ name, cType, ...info, isChar: name.startsWith('xcpw_') });
      }
    }
  }
  return vars;
}

function buildA2lTemplate(vars) {
  const measurements  = vars.filter(v => !v.isChar);
  const characteristics = vars.filter(v => v.isChar);

  const measurementBlocks = measurements.map(v => `
  /begin MEASUREMENT
    /* Name                   */  ${v.name}
    /* Long identifier        */  "${v.name}"
    /* Data type              */  ${v.a2lType}
    /* Conversion method      */  ${v.cm}
    /* Resolution (Not used)  */  0
    /* Accuracy (Not used)    */  0
    /* Lower limit            */  ${v.limits[0]}
    /* Upper limit            */  ${v.limits[1]}
    ECU_ADDRESS                   __ADDR_${v.name}__
  /end MEASUREMENT`).join('\n');

  const characteristicBlocks = characteristics.map(v => `
  /begin CHARACTERISTIC
    /* Name                   */  ${v.name}
    /* Long identifier        */  "${v.name}"
    /* Type                   */  VALUE
    /* ECU Address            */  __ADDR_${v.name}__
    /* Record Layout          */  ${v.record}
    /* Maximum Difference     */  0
    /* Conversion Method      */  ${v.cm}
    /* Lower Limit            */  ${v.limits[0]}
    /* Upper Limit            */  ${v.limits[1]}
  /end CHARACTERISTIC`).join('\n');

  // Collect only the record layouts and compu methods that are actually used
  const usedRecords = [...new Set(vars.map(v => v.record))];
  const usedCm      = [...new Set(vars.map(v => v.cm))];

  const allRecords = {
    'Record_UBYTE':        'FNC_VALUES 1 UBYTE COLUMN_DIR DIRECT',
    'Record_UWORD':        'FNC_VALUES 1 UWORD COLUMN_DIR DIRECT',
    'Record_ULONG':        'FNC_VALUES 1 ULONG COLUMN_DIR DIRECT',
    'Record_SBYTE':        'FNC_VALUES 1 SBYTE COLUMN_DIR DIRECT',
    'Record_SWORD':        'FNC_VALUES 1 SWORD COLUMN_DIR DIRECT',
    'Record_SLONG':        'FNC_VALUES 1 SLONG COLUMN_DIR DIRECT',
    'Record_FLOAT32_IEEE': 'FNC_VALUES 1 FLOAT32_IEEE COLUMN_DIR DIRECT',
    'Record_FLOAT64_IEEE': 'FNC_VALUES 1 FLOAT64_IEEE COLUMN_DIR DIRECT',
  };
  const allCm = {
    'CM_uint8':  { fmt: '%3.0',  unit: '' },
    'CM_uint16': { fmt: '%5.0',  unit: '' },
    'CM_uint32': { fmt: '%10.0', unit: '' },
    'CM_int8':   { fmt: '%4.0',  unit: '' },
    'CM_int16':  { fmt: '%6.0',  unit: '' },
    'CM_int32':  { fmt: '%11.0', unit: '' },
    'CM_single': { fmt: '%8.6',  unit: '' },
    'CM_double': { fmt: '%15.10',unit: '' },
  };

  const recordBlocks = usedRecords.map(r =>
    `  /begin RECORD_LAYOUT ${r}\n    ${allRecords[r]}\n  /end RECORD_LAYOUT`).join('\n');

  const cmBlocks = usedCm.map(c =>
    `  /begin COMPU_METHOD\n    /* Name */  ${c}\n    /* Long identifier */ "Q = V"\n    /* Conversion Type */ IDENTICAL\n    /* Format */  "${allCm[c].fmt}"\n    /* Units  */  "${allCm[c].unit}"\n  /end COMPU_METHOD`).join('\n');

  const mRefList  = measurements.map(v => `        ${v.name}`).join('\n');
  const cRefList  = characteristics.map(v => `        ${v.name}`).join('\n');

  const groups = `
  /begin GROUP
    /* Name */ Measurements
    /* Long identifier */ "Live signals (read-only)"
    /* Root */ ROOT
    /begin REF_MEASUREMENT
${mRefList}
    /end REF_MEASUREMENT
  /end GROUP

  /begin GROUP
    /* Name */ Parameters
    /* Long identifier */ "Writable parameters"
    /* Root */ ROOT
    /begin REF_CHARACTERISTIC
${cRefList}
    /end REF_CHARACTERISTIC
  /end GROUP`;

  return `/******************************************************************************
 * Auto-generated a2l — GOcontroll Moduline
 * Variables scanned from application/*.c  (volatile M_*/C_* prefix convention)
 * Addresses filled in by update_xcp_a2l.sh after each build.
 ******************************************************************************/
ASAP2_VERSION  1 71

/begin PROJECT app  "GOcontroll application"

  /begin HEADER "Auto-generated by GOcontroll MCP"
  /end HEADER

  /begin MODULE app  "Application module"

    /begin MOD_PAR ""
      CPU_TYPE  "i.MX8"
      ECU       "GOcontroll Moduline IV"
    /end MOD_PAR

    /begin IF_DATA XCP
      /begin XCP_ON_TCP_IP
        0x100
        50002
        "HOST_NAME" moduline
        "ADDRESS" 0.0.0.0
      /end XCP_ON_TCP_IP
    /end IF_DATA XCP

    /begin MOD_COMMON ""
      BYTE_ORDER  MSB_LAST
    /end MOD_COMMON
${measurementBlocks}
${characteristicBlocks}
${recordBlocks}
${cmBlocks}
${groups}

  /end MODULE

/end PROJECT
/* EOF */
`;
}

function generateA2l() {
  if (!fs.existsSync(APP_ELF)) {
    return { success: false, error: 'build/app.elf niet gevonden — bouw eerst het project' };
  }
  if (!fs.existsSync(A2L_SCRIPT)) {
    return { success: false, error: 'update_xcp_a2l.sh niet gevonden in codebase' };
  }

  const vars = scanXcpVariables();
  if (vars.length === 0) {
    return {
      success: false,
      error:   'Geen XCP-variabelen gevonden in application/*.c. ' +
               'Declareer variabelen als: volatile uint16_t xcpr_Signaal = 0; (measurement) of volatile uint8_t xcpw_Parameter = 0; (characteristic)',
    };
  }

  // Write generated template to build dir
  const templatePath = path.join(PROJECT_DIR, 'build/xcp_template.a2l');
  fs.mkdirSync(path.dirname(templatePath), { recursive: true });
  fs.writeFileSync(templatePath, buildA2lTemplate(vars), 'utf8');

  // Run address update script
  const r = spawnSync('bash', [A2L_SCRIPT, APP_ELF, templatePath, A2L_OUTPUT], {
    cwd: PROJECT_DIR, encoding: 'utf8', timeout: 15000,
  });

  if (r.status !== 0) {
    return { success: false, error: r.stderr || 'script mislukt', output: r.stdout };
  }

  return {
    success:          true,
    variables_found:  vars.length,
    measurements:     vars.filter(v => !v.isChar).map(v => v.name),
    characteristics:  vars.filter(v => v.isChar).map(v => v.name),
    output:           r.stdout,
  };
}

function getA2lPath() {
  return fs.existsSync(A2L_OUTPUT) ? A2L_OUTPUT : null;
}

module.exports = {
  getSubmoduleStatus,
  getProjectStatus,
  setupProject,
  listFiles,
  readFile,
  writeFile,
  buildProject,
  runApp,
  stopApp,
  getAppOutput,
  generateA2l,
  getA2lPath,
};
