'use strict';

const { normalizeCatalog, getCatalogBinding, isSafeGitBranch, sameGitRemote } = require('./catalog');
const { extractSemver, greatestSemver, semverDirection } = require('./semver');

const CHECK_TIMEOUT_MS = 45_000;
const WINGET_TIMEOUT_MS = 120_000;

function checkedAtValue(now) {
  const value = typeof now === 'function' ? now() : now === undefined ? Date.now() : now;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid update-check clock value');
  return date.toISOString();
}

function detectionFor(detections, systemId) {
  if (detections instanceof Map) return detections.get(systemId);
  return detections && typeof detections === 'object' ? detections[systemId] : undefined;
}

function detectedVersion(detection) {
  return extractSemver(detection?.version) || extractSemver(detection?.text);
}

function baseResult(binding, checkedAt) {
  return {
    systemId: binding.system.id,
    packageId: binding.packageDefinition.id,
    sourceId: binding.source.id,
    sourceType: binding.source.type,
    checkedAt,
  };
}

function unknownResult(binding, checkedAt, currentVersion, reasonCode, extra = {}) {
  return {
    ...baseResult(binding, checkedAt),
    status: 'unknown',
    direction: 'unknown',
    currentVersion: currentVersion || null,
    latestVersion: null,
    reasonCode,
    ...extra,
  };
}

function versionResult(binding, checkedAt, currentVersion, latestVersion, extra = {}) {
  const direction = semverDirection(currentVersion, latestVersion);
  const status = { behind: 'available', current: 'current', ahead: 'ahead', unknown: 'unknown' }[direction];
  return {
    ...baseResult(binding, checkedAt),
    status,
    direction,
    currentVersion: currentVersion || null,
    latestVersion: latestVersion || null,
    reasonCode: direction === 'unknown' ? 'uncomparable-version' : null,
    ...extra,
  };
}

function normalizeExecutionResult(value) {
  if (!value || typeof value !== 'object') return { exitCode: 1, stdout: '', stderr: 'Invalid executor result' };
  return {
    exitCode: Number.isInteger(value.exitCode) ? value.exitCode : 1,
    stdout: String(value.stdout || ''),
    stderr: String(value.stderr || ''),
  };
}

async function safeExecute(execute, file, args, options) {
  try { return normalizeExecutionResult(await execute(file, [...args], { ...options })); }
  catch (error) {
    return { exitCode: 1, stdout: '', stderr: String(error?.message || error || 'Command failed') };
  }
}

function stripAnsi(value) {
  return String(value || '').replace(/\x1B(?:[@-_][0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, '');
}

function parseWingetUpgradeOutput(value, packageIds) {
  const rows = new Map();
  const expected = new Map(packageIds.map((id) => [String(id).toLowerCase(), String(id)]));
  for (const line of stripAnsi(value).split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    const packageIndex = columns.findIndex((column) => expected.has(column.toLowerCase()));
    if (packageIndex < 0 || columns.length < packageIndex + 3) continue;
    const id = expected.get(columns[packageIndex].toLowerCase());
    rows.set(id, { currentVersion: columns[packageIndex + 1], latestVersion: columns[packageIndex + 2] });
  }
  return rows;
}

function parseNpmVersionOutput(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { parsed = raw.replace(/^"|"$/g, ''); }
  const candidates = (Array.isArray(parsed) ? parsed : [parsed]).map((item) => String(item || '').trim()).filter(Boolean);
  return greatestSemver(candidates) || null;
}

function classifyGitRelation(ahead, behind) {
  if (!Number.isSafeInteger(ahead) || ahead < 0 || !Number.isSafeInteger(behind) || behind < 0) return 'unknown';
  if (ahead === 0 && behind === 0) return 'current';
  if (ahead === 0) return 'behind';
  if (behind === 0) return 'ahead';
  return 'diverged';
}

function parseGitAheadBehind(value) {
  const columns = String(value || '').trim().split(/\s+/);
  if (columns.length !== 2 || !/^\d+$/.test(columns[0]) || !/^\d+$/.test(columns[1])) return null;
  const ahead = Number(columns[0]);
  const behind = Number(columns[1]);
  if (!Number.isSafeInteger(ahead) || !Number.isSafeInteger(behind)) return null;
  return { ahead, behind, relation: classifyGitRelation(ahead, behind) };
}

async function checkWingetPackages(bindings, detections, options) {
  if (!bindings.length) return {};
  const { execute, checkedAt } = options;
  const source = bindings[0].source;
  const result = await safeExecute(execute, 'winget.exe', [
    'upgrade', '--source', source.channel, '--accept-source-agreements', '--disable-interactivity',
  ], { timeout: WINGET_TIMEOUT_MS });
  const rows = parseWingetUpgradeOutput(`${result.stdout}\n${result.stderr}`, bindings.map((binding) => binding.packageDefinition.identifier));
  const entries = {};
  for (const binding of bindings) {
    const currentFromDetection = detectedVersion(detectionFor(detections, binding.system.id));
    const row = rows.get(binding.packageDefinition.identifier);
    if (row) {
      entries[binding.system.id] = versionResult(
        binding,
        checkedAt,
        extractSemver(row.currentVersion) || currentFromDetection,
        extractSemver(row.latestVersion),
      );
    } else if (result.exitCode === 0 && currentFromDetection) {
      entries[binding.system.id] = versionResult(binding, checkedAt, currentFromDetection, currentFromDetection);
    } else {
      entries[binding.system.id] = unknownResult(binding, checkedAt, currentFromDetection, 'winget-source-unavailable');
    }
  }
  return entries;
}

async function checkNpmPackage(binding, detection, options) {
  const { execute, checkedAt } = options;
  const currentVersion = detectedVersion(detection);
  const result = await safeExecute(execute, 'npm.cmd', [
    'view', binding.packageDefinition.name, 'version', '--json', '--registry', binding.source.url,
  ], { timeout: CHECK_TIMEOUT_MS });
  if (result.exitCode !== 0) return unknownResult(binding, checkedAt, currentVersion, 'npm-source-unavailable');
  const latestVersion = parseNpmVersionOutput(result.stdout);
  if (!currentVersion) return unknownResult(binding, checkedAt, null, 'installed-version-missing', { latestVersion });
  if (!latestVersion) return unknownResult(binding, checkedAt, currentVersion, 'published-version-missing');
  return versionResult(binding, checkedAt, currentVersion, latestVersion);
}

function gitResult(binding, checkedAt, relation, ahead, behind, currentVersion, latestVersion, branch) {
  const status = { current: 'current', behind: 'available', ahead: 'ahead', diverged: 'diverged', unknown: 'unknown' }[relation];
  return {
    ...baseResult(binding, checkedAt),
    status,
    direction: relation,
    relation,
    ahead,
    behind,
    currentVersion: currentVersion || null,
    latestVersion: latestVersion || null,
    branch: branch || null,
    reasonCode: relation === 'unknown' ? 'git-relation-unknown' : null,
  };
}

async function checkGitPackage(binding, options) {
  const { execute, checkedAt } = options;
  const expandPath = typeof options.expandPath === 'function' ? options.expandPath : (value) => value;
  const repository = expandPath(binding.packageDefinition.path);
  const commandOptions = { cwd: repository, timeout: CHECK_TIMEOUT_MS };
  const remote = binding.packageDefinition.remote;

  const remoteUrl = await safeExecute(execute, 'git.exe', ['remote', 'get-url', remote], commandOptions);
  if (remoteUrl.exitCode !== 0) return unknownResult(binding, checkedAt, null, 'git-remote-missing');
  if (!sameGitRemote(remoteUrl.stdout.trim(), binding.source.url)) {
    return unknownResult(binding, checkedAt, null, 'official-source-mismatch');
  }

  const branchResult = await safeExecute(execute, 'git.exe', ['symbolic-ref', '--quiet', '--short', 'HEAD'], commandOptions);
  const branch = branchResult.stdout.trim();
  if (branchResult.exitCode !== 0 || !branch) return unknownResult(binding, checkedAt, null, 'git-detached-head');
  if (!isSafeGitBranch(branch)) return unknownResult(binding, checkedAt, null, 'git-unsafe-branch');
  const local = await safeExecute(execute, 'git.exe', ['rev-parse', 'HEAD'], commandOptions);
  if (local.exitCode !== 0 || !/^[a-f0-9]{40,64}$/i.test(local.stdout.trim())) {
    return unknownResult(binding, checkedAt, null, 'git-local-head-missing');
  }
  const fetchResult = await safeExecute(execute, 'git.exe', [
    'fetch', '--no-tags', '--quiet', remote, `refs/heads/${branch}`,
  ], commandOptions);
  if (fetchResult.exitCode !== 0) {
    return unknownResult(binding, checkedAt, local.stdout.trim().slice(0, 12), 'git-source-unavailable', { branch });
  }
  const fetched = await safeExecute(execute, 'git.exe', ['rev-parse', 'FETCH_HEAD'], commandOptions);
  if (fetched.exitCode !== 0 || !/^[a-f0-9]{40,64}$/i.test(fetched.stdout.trim())) {
    return unknownResult(binding, checkedAt, local.stdout.trim().slice(0, 12), 'git-fetched-head-missing', { branch });
  }
  const counts = await safeExecute(execute, 'git.exe', [
    'rev-list', '--left-right', '--count', 'HEAD...FETCH_HEAD',
  ], commandOptions);
  const parsed = counts.exitCode === 0 ? parseGitAheadBehind(counts.stdout) : null;
  if (!parsed) {
    return unknownResult(binding, checkedAt, local.stdout.trim().slice(0, 12), 'git-relation-unknown', {
      latestVersion: fetched.stdout.trim().slice(0, 12), branch,
    });
  }
  return gitResult(
    binding,
    checkedAt,
    parsed.relation,
    parsed.ahead,
    parsed.behind,
    local.stdout.trim().slice(0, 12),
    fetched.stdout.trim().slice(0, 12),
    branch,
  );
}

async function checkCatalogUpdates(catalogValue, detections, options = {}) {
  const catalog = normalizeCatalog(catalogValue);
  const checkedAt = checkedAtValue(options.now);
  const bindings = catalog.systems
    .filter((system) => system.package)
    .map((system) => getCatalogBinding(catalog, system.id))
    .filter((binding) => binding.packageDefinition.operations.includes('check'));
  const entries = {};
  const pending = [];
  for (const binding of bindings) {
    const detection = detectionFor(detections, binding.system.id);
    if (!detection?.ok) {
      entries[binding.system.id] = {
        ...baseResult(binding, null), status: 'not-installed', direction: 'unknown',
        currentVersion: null, latestVersion: null, reasonCode: 'not-installed',
      };
    } else {
      pending.push(binding);
    }
  }
  if (pending.length && typeof options.execute !== 'function') throw new Error('An update-check executor is required');

  const wingetSources = new Map();
  for (const binding of pending.filter((candidate) => candidate.source.type === 'winget')) {
    const group = wingetSources.get(binding.source.id) || [];
    group.push(binding);
    wingetSources.set(binding.source.id, group);
  }
  for (const group of wingetSources.values()) {
    Object.assign(entries, await checkWingetPackages(group, detections, { ...options, checkedAt }));
  }
  for (const binding of pending.filter((candidate) => candidate.source.type === 'npm')) {
    entries[binding.system.id] = await checkNpmPackage(binding, detectionFor(detections, binding.system.id), { ...options, checkedAt });
  }
  for (const binding of pending.filter((candidate) => candidate.source.type === 'git')) {
    entries[binding.system.id] = await checkGitPackage(binding, { ...options, checkedAt });
  }
  return { checkedAt, entries };
}

function createUpdateChecker(defaultOptions = {}) {
  return Object.freeze({
    check(catalog, detections, options = {}) {
      return checkCatalogUpdates(catalog, detections, { ...defaultOptions, ...options });
    },
  });
}

module.exports = {
  parseWingetUpgradeOutput,
  parseNpmVersionOutput,
  parseGitAheadBehind,
  classifyGitRelation,
  checkWingetPackages,
  checkNpmPackage,
  checkGitPackage,
  checkCatalogUpdates,
  createUpdateChecker,
};
