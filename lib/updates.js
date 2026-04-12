'use strict';

const https  = require('https');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const REPO = 'GOcontroll/GOcontroll-Moduline';

// Repo path prefix → absolute controller path
const PATH_MAP = [
  { repo: 'usr/module-firmware/',  controller: '/usr/lib/firmware/gocontroll/' },
  { repo: 'usr/moduline/bin/',     controller: '/usr/bin/' },
  { repo: 'usr/moduline/bash/',    controller: '/usr/bin/' },
  { repo: 'lib/systemd/system/',   controller: '/lib/systemd/system/' },
];

// ---------------------------------------------------------------------------
// Git blob SHA — same algorithm git uses to identify file content.
// sha1("blob {byteLength}\0{content}")
// ---------------------------------------------------------------------------
function gitBlobSha(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    const header  = Buffer.from(`blob ${content.length}\0`);
    const hash    = crypto.createHash('sha1');
    hash.update(header);
    hash.update(content);
    return hash.digest('hex');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Minimal HTTPS GET → parsed JSON (follows one redirect)
// ---------------------------------------------------------------------------
function githubGet(apiPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path:     apiPath,
      headers:  { 'User-Agent': 'GOcontroll-MCP', 'Accept': 'application/vnd.github+json' },
      timeout:  15000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          // Should not happen with the GitHub API, but handle it just in case
          return reject(new Error(`Redirect: ${res.headers.location}`));
        }
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Ongeldig JSON van GitHub (status ${res.statusCode})`)); }
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('GitHub API timeout')); });
    req.on('error', (err) => reject(new Error(`GitHub verbindingsfout: ${err.message}`)));
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Resolve an annotated tag to a commit SHA
// ---------------------------------------------------------------------------
async function resolveTagToCommit(tagSha, tagType) {
  if (tagType !== 'tag') return tagSha; // lightweight tag points directly to commit
  const tagObj = await githubGet(`/repos/${REPO}/git/tags/${tagSha}`);
  return tagObj.object.sha;
}

// ---------------------------------------------------------------------------
// Main: check for updates
// ---------------------------------------------------------------------------
async function checkUpdates() {
  // 1. Latest release
  const release    = await githubGet(`/repos/${REPO}/releases/latest`);
  const latestTag  = release.tag_name;       // e.g. "V0.9.0"
  const releaseDate = (release.published_at || '').slice(0, 10);
  const releaseNotes = (release.body || '').trim();

  // 2. Resolve tag → commit → tree
  const tagRef    = await githubGet(`/repos/${REPO}/git/refs/tags/${latestTag}`);
  const commitSha = await resolveTagToCommit(tagRef.object.sha, tagRef.object.type);
  const commit    = await githubGet(`/repos/${REPO}/git/commits/${commitSha}`);
  const treeSha   = commit.tree.sha;

  // 3. Full recursive tree (one API call)
  const treeResp  = await githubGet(`/repos/${REPO}/git/trees/${treeSha}?recursive=1`);

  if (treeResp.truncated) {
    console.error('[updates] GitHub tree response was truncated — large repo');
  }

  // Build map: repo_path → blob_sha
  const repoFiles = {};
  for (const item of treeResp.tree) {
    if (item.type === 'blob') repoFiles[item.path] = item.sha;
  }

  // 4. Compare with installed files
  const changes    = [];
  const upToDate   = [];
  const seen       = new Set(); // avoid duplicates when multiple repo dirs → same controller dir

  for (const mapping of PATH_MAP) {
    for (const [repoPath, repoSha] of Object.entries(repoFiles)) {
      if (!repoPath.startsWith(mapping.repo)) continue;

      const filename       = path.basename(repoPath);
      const controllerPath = mapping.controller + filename;

      if (seen.has(controllerPath)) continue;
      seen.add(controllerPath);

      const localSha = gitBlobSha(controllerPath);

      if (localSha === null) {
        changes.push({
          file:            filename,
          controller_path: controllerPath,
          status:          'nieuw',
          category:        categoryFor(mapping.controller),
        });
      } else if (localSha !== repoSha) {
        changes.push({
          file:            filename,
          controller_path: controllerPath,
          status:          'gewijzigd',
          category:        categoryFor(mapping.controller),
        });
      } else {
        upToDate.push(filename);
      }
    }
  }

  const updates_available = changes.length > 0;

  return {
    latest_release:   latestTag,
    release_date:     releaseDate,
    updates_available,
    summary: {
      changed:    changes.filter((c) => c.status === 'gewijzigd').length,
      new_files:  changes.filter((c) => c.status === 'nieuw').length,
      up_to_date: upToDate.length,
    },
    changes,
    release_notes: releaseNotes || null,
  };
}

function categoryFor(controllerPath) {
  if (controllerPath.includes('firmware'))   return 'module_firmware';
  if (controllerPath.includes('systemd'))    return 'systemd_service';
  return 'binary';
}

// ---------------------------------------------------------------------------
// apt package updates
// ---------------------------------------------------------------------------
const { spawnSync } = require('child_process');

function listAptUpdates() {
  // apt-get update to refresh package lists
  const update = spawnSync('apt-get', ['update', '-qq'], {
    timeout: 30000, encoding: 'utf8',
    env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' },
  });

  const list = spawnSync('apt', ['list', '--upgradable', '--quiet'], {
    timeout: 10000, encoding: 'utf8',
  });

  const packages = (list.stdout || '')
    .split('\n')
    .filter((l) => l && !l.startsWith('Listing'))
    .map((line) => {
      // Format: "package/suite version arch [upgradable from: old]"
      const m = line.match(/^([^/]+)\/(\S+)\s+(\S+)\s+(\S+)\s+\[upgradable from:\s+([^\]]+)\]/);
      if (!m) return { raw: line };
      return { package: m[1], suite: m[2], new_version: m[3], arch: m[4], old_version: m[5] };
    });

  return {
    count: packages.length,
    packages,
    apt_update_output: (update.stderr || '').trim() || null,
  };
}

function upgradePackages() {
  // Refresh package lists first
  const update = spawnSync('apt-get', ['update', '-qq'], {
    timeout: 30000, encoding: 'utf8',
    env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' },
  });

  const upgrade = spawnSync('apt-get', ['upgrade', '-y'], {
    timeout: 300000, encoding: 'utf8',
    env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' },
  });

  return {
    success:  upgrade.status === 0,
    output:   (upgrade.stdout || '') + (upgrade.stderr || ''),
  };
}

module.exports = { checkUpdates, listAptUpdates, upgradePackages };
