'use strict';

const CATALOG_SCHEMA_VERSION = 3;
const NORMALIZED_CATALOGS = new WeakSet();
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SAFE_EXECUTABLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_WINGET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]+$/;
const SAFE_NPM_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const SAFE_PACKAGE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const OPERATION_ORDER = ['install', 'check', 'update'];
const TIERS = new Set(['required', 'recommended', 'project']);

const PINNED_SOURCES = Object.freeze({
  winget: Object.freeze({ url: 'https://cdn.winget.microsoft.com/cache', channel: 'winget' }),
  npm: Object.freeze({ url: 'https://registry.npmjs.org/' }),
  uv: Object.freeze({ url: 'https://pypi.org/simple/' }),
});

class CatalogValidationError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = 'CatalogValidationError';
    this.code = 'INVALID_SYSTEM_CATALOG';
    this.path = path;
  }
}

function fail(path, message) {
  throw new CatalogValidationError(path, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function objectAt(value, path) {
  if (!isPlainObject(value)) fail(path, 'must be an object');
  return value;
}

function assertAllowedKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${path}.${key}`, 'is not allowed');
  }
}

function textAt(value, path, options = {}) {
  if (typeof value !== 'string') fail(path, 'must be a string');
  const normalized = value.trim();
  if (!normalized) fail(path, 'must not be empty');
  if (/\0|[\r\n]/.test(normalized)) fail(path, 'must be a single safe line');
  if (options.pattern && !options.pattern.test(normalized)) fail(path, 'has an invalid format');
  return normalized;
}

function optionalText(value, path) {
  return value === undefined ? undefined : textAt(value, path);
}

function idAt(value, path) {
  const id = textAt(value, path, { pattern: ID_PATTERN });
  if (id !== id.toLowerCase()) fail(path, 'must use lowercase canonical form');
  return id;
}

function stringArrayAt(value, path, options = {}) {
  if (!Array.isArray(value) || (options.nonEmpty && value.length === 0)) {
    fail(path, options.nonEmpty ? 'must be a non-empty array' : 'must be an array');
  }
  const normalized = value.map((item, index) => textAt(item, `${path}[${index}]`, options));
  if (new Set(normalized).size !== normalized.length) fail(path, 'must not contain duplicates');
  return normalized;
}

function normalizeHttpsUrl(value, path) {
  const raw = textAt(value, path);
  let parsed;
  try { parsed = new URL(raw); }
  catch { fail(path, 'must be an absolute HTTPS URL'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    fail(path, 'must be a credential-free HTTPS URL without query or fragment');
  }
  return parsed.toString();
}

function normalizeSource(value, index) {
  const path = `catalog.sources[${index}]`;
  const source = objectAt(value, path);
  assertAllowedKeys(source, new Set(['id', 'type', 'official', 'url', 'channel']), path);
  const id = idAt(source.id, `${path}.id`);
  const type = textAt(source.type, `${path}.type`);
  if (!['winget', 'npm', 'uv', 'git'].includes(type)) fail(`${path}.type`, 'is unsupported');
  if (source.official !== true) fail(`${path}.official`, 'must be true');
  const url = normalizeHttpsUrl(source.url, `${path}.url`);
  const normalized = { id, type, official: true, url };

  if (type === 'winget') {
    normalized.channel = textAt(source.channel, `${path}.channel`, { pattern: ID_PATTERN });
  } else if (source.channel !== undefined) {
    fail(`${path}.channel`, 'is only valid for winget sources');
  }

  const pinned = PINNED_SOURCES[type];
  if (pinned && url !== pinned.url) fail(`${path}.url`, `must be the pinned official ${type} source`);
  if (pinned?.channel && normalized.channel !== pinned.channel) {
    fail(`${path}.channel`, `must be the pinned official ${type} channel`);
  }
  if (type === 'git') {
    const parsed = new URL(url);
    if (parsed.pathname.split('/').filter(Boolean).length < 2) fail(`${path}.url`, 'must identify one Git repository');
  }
  return normalized;
}

function normalizeOperations(value, path) {
  const operations = stringArrayAt(value, path, { nonEmpty: true });
  for (const operation of operations) {
    if (!OPERATION_ORDER.includes(operation)) fail(path, `contains unsupported operation ${operation}`);
  }
  const hasCheck = operations.includes('check');
  const hasUpdate = operations.includes('update');
  if (hasCheck !== hasUpdate) fail(path, 'check and update must be declared together');
  return OPERATION_ORDER.filter((operation) => operations.includes(operation));
}

function normalizePackage(value, index, sourcesById) {
  const path = `catalog.packages[${index}]`;
  const packageDefinition = objectAt(value, path);
  const common = ['id', 'source', 'displayName', 'operations'];
  const sourceId = idAt(packageDefinition.source, `${path}.source`);
  const source = sourcesById.get(sourceId);
  if (!source) fail(`${path}.source`, `references unknown source ${sourceId}`);
  const typeFields = {
    winget: ['identifier'],
    npm: ['name'],
    uv: ['name', 'python'],
    git: ['path', 'remote', 'guards'],
  }[source.type];
  assertAllowedKeys(packageDefinition, new Set([...common, ...typeFields]), path);

  const normalized = {
    id: idAt(packageDefinition.id, `${path}.id`),
    source: sourceId,
    displayName: textAt(packageDefinition.displayName, `${path}.displayName`),
    operations: normalizeOperations(packageDefinition.operations, `${path}.operations`),
  };

  if (source.type === 'winget') {
    normalized.identifier = textAt(packageDefinition.identifier, `${path}.identifier`, { pattern: SAFE_WINGET_ID_PATTERN });
  } else if (source.type === 'npm') {
    normalized.name = textAt(packageDefinition.name, `${path}.name`, { pattern: SAFE_NPM_NAME_PATTERN });
  } else if (source.type === 'uv') {
    normalized.name = textAt(packageDefinition.name, `${path}.name`, { pattern: SAFE_PACKAGE_NAME_PATTERN });
    normalized.python = textAt(packageDefinition.python, `${path}.python`, { pattern: /^\d+\.\d+$/ });
  } else {
    normalized.path = textAt(packageDefinition.path, `${path}.path`);
    normalized.remote = textAt(packageDefinition.remote, `${path}.remote`, { pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/ });
    normalized.guards = stringArrayAt(packageDefinition.guards, `${path}.guards`, { nonEmpty: true }).sort();
    if (normalized.guards.some((guard) => guard !== 'cleanWorkingTree')) fail(`${path}.guards`, 'contains an unsupported guard');
    if (normalized.operations.includes('update') && !normalized.guards.includes('cleanWorkingTree')) {
      fail(`${path}.guards`, 'Git updates require cleanWorkingTree');
    }
  }

  const allowedOperations = {
    winget: new Set(['install', 'check', 'update']),
    npm: new Set(['install', 'check', 'update']),
    uv: new Set(['install']),
    git: new Set(['check', 'update']),
  }[source.type];
  for (const operation of normalized.operations) {
    if (!allowedOperations.has(operation)) fail(`${path}.operations`, `${operation} is not supported by ${source.type}`);
  }
  return normalized;
}

function normalizeCommandDetection(detection, path, extraAllowed = []) {
  assertAllowedKeys(detection, new Set(['type', 'command', 'args', ...extraAllowed]), path);
  const normalized = {
    type: detection.type,
    command: textAt(detection.command, `${path}.command`, { pattern: SAFE_EXECUTABLE_PATTERN }),
    args: detection.args === undefined ? [] : stringArrayAt(detection.args, `${path}.args`),
  };
  return normalized;
}

function normalizeDetection(value, path) {
  const detection = objectAt(value, path);
  const type = textAt(detection.type, `${path}.type`);
  if (type === 'command') return normalizeCommandDetection(detection, path);
  if (type === 'commandOrSearch') {
    const normalized = normalizeCommandDetection(detection, path, ['roots', 'filePattern']);
    normalized.roots = stringArrayAt(detection.roots, `${path}.roots`, { nonEmpty: true });
    normalized.filePattern = textAt(detection.filePattern, `${path}.filePattern`);
    try { new RegExp(normalized.filePattern); }
    catch { fail(`${path}.filePattern`, 'must be a valid regular expression'); }
    return normalized;
  }
  if (type === 'pythonModule') {
    assertAllowedKeys(detection, new Set(['type', 'module']), path);
    return { type, module: textAt(detection.module, `${path}.module`, { pattern: /^[A-Za-z_][A-Za-z0-9_.-]*$/ }) };
  }
  if (type === 'path') {
    assertAllowedKeys(detection, new Set(['type', 'paths']), path);
    return { type, paths: stringArrayAt(detection.paths, `${path}.paths`, { nonEmpty: true }) };
  }
  if (type === 'pathOrCommand') {
    assertAllowedKeys(detection, new Set(['type', 'paths', 'command', 'args']), path);
    return {
      type,
      paths: stringArrayAt(detection.paths, `${path}.paths`, { nonEmpty: true }),
      command: textAt(detection.command, `${path}.command`, { pattern: SAFE_EXECUTABLE_PATTERN }),
      args: detection.args === undefined ? [] : stringArrayAt(detection.args, `${path}.args`),
    };
  }
  if (type === 'flux') {
    assertAllowedKeys(detection, new Set(['type', 'roots']), path);
    return { type, roots: stringArrayAt(detection.roots, `${path}.roots`, { nonEmpty: true }) };
  }
  if (['ollama', 'mcp', 'comfyCloud'].includes(type)) {
    assertAllowedKeys(detection, new Set(['type']), path);
    return { type };
  }
  fail(`${path}.type`, `unsupported detection type ${type}`);
}

function normalizeSystem(value, index, packagesById) {
  const path = `catalog.systems[${index}]`;
  const system = objectAt(value, path);
  assertAllowedKeys(system, new Set([
    'id', 'name', 'category', 'tier', 'reason', 'workflowRole', 'activation', 'costPolicy',
    'capabilities', 'detect', 'package',
  ]), path);
  const tier = textAt(system.tier, `${path}.tier`);
  if (!TIERS.has(tier)) fail(`${path}.tier`, 'is unsupported');
  const normalized = {
    id: idAt(system.id, `${path}.id`),
    name: textAt(system.name, `${path}.name`),
    category: textAt(system.category, `${path}.category`),
    tier,
    reason: textAt(system.reason, `${path}.reason`),
    detect: normalizeDetection(system.detect, `${path}.detect`),
  };
  for (const key of ['workflowRole', 'activation', 'costPolicy']) {
    const normalizedText = optionalText(system[key], `${path}.${key}`);
    if (normalizedText !== undefined) normalized[key] = normalizedText;
  }
  if (system.capabilities !== undefined) {
    normalized.capabilities = stringArrayAt(system.capabilities, `${path}.capabilities`, { nonEmpty: true, pattern: ID_PATTERN }).sort();
  }
  if (system.package !== undefined) {
    normalized.package = idAt(system.package, `${path}.package`);
    if (!packagesById.has(normalized.package)) fail(`${path}.package`, `references unknown package ${normalized.package}`);
  }
  return normalized;
}

function uniqueById(values, path) {
  const byId = new Map();
  for (const value of values) {
    if (byId.has(value.id)) fail(path, `contains duplicate id ${value.id}`);
    byId.set(value.id, value);
  }
  return byId;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeCatalog(value) {
  if (NORMALIZED_CATALOGS.has(value)) return value;
  const catalog = objectAt(value, 'catalog');
  assertAllowedKeys(catalog, new Set(['schemaVersion', 'sources', 'packages', 'systems']), 'catalog');
  if (catalog.schemaVersion !== CATALOG_SCHEMA_VERSION) {
    fail('catalog.schemaVersion', `must equal ${CATALOG_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(catalog.sources) || !catalog.sources.length) fail('catalog.sources', 'must be a non-empty array');
  if (!Array.isArray(catalog.packages) || !catalog.packages.length) fail('catalog.packages', 'must be a non-empty array');
  if (!Array.isArray(catalog.systems) || !catalog.systems.length) fail('catalog.systems', 'must be a non-empty array');

  const sources = catalog.sources.map(normalizeSource).sort((left, right) => left.id.localeCompare(right.id));
  const sourcesById = uniqueById(sources, 'catalog.sources');
  const packages = catalog.packages.map((item, index) => normalizePackage(item, index, sourcesById))
    .sort((left, right) => left.id.localeCompare(right.id));
  const packagesById = uniqueById(packages, 'catalog.packages');
  const systems = catalog.systems.map((item, index) => normalizeSystem(item, index, packagesById));
  uniqueById(systems, 'catalog.systems');

  const packageReferences = new Map(packages.map((item) => [item.id, 0]));
  for (const system of systems) {
    if (system.package) packageReferences.set(system.package, packageReferences.get(system.package) + 1);
  }
  for (const [packageId, count] of packageReferences) {
    if (count !== 1) fail('catalog.systems', `package ${packageId} must be referenced by exactly one system`);
  }
  const usedSources = new Set(packages.map((item) => item.source));
  for (const source of sources) {
    if (!usedSources.has(source.id)) fail('catalog.sources', `source ${source.id} is not coupled to a package`);
  }

  const normalized = { schemaVersion: CATALOG_SCHEMA_VERSION, sources, packages, systems };
  deepFreeze(normalized);
  NORMALIZED_CATALOGS.add(normalized);
  return normalized;
}

function ensureCatalog(value) {
  return NORMALIZED_CATALOGS.has(value) ? value : normalizeCatalog(value);
}

function getCatalogBinding(catalogValue, systemId) {
  const catalog = ensureCatalog(catalogValue);
  const system = catalog.systems.find((candidate) => candidate.id === systemId);
  if (!system) throw new Error(`Unknown catalog system: ${systemId}`);
  if (!system.package) return { catalog, system, packageDefinition: null, source: null };
  const packageDefinition = catalog.packages.find((candidate) => candidate.id === system.package);
  const source = catalog.sources.find((candidate) => candidate.id === packageDefinition.source);
  return { catalog, system, packageDefinition, source };
}

function isSafeGitBranch(value) {
  if (typeof value !== 'string' || !value || value.startsWith('-') || value.endsWith('/') || value.includes('@{')) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(value)) return false;
  return value.split('/').every((segment) => segment && segment !== '.' && segment !== '..' && !segment.endsWith('.lock'));
}

function gitRemoteIdentity(value) {
  const raw = String(value || '').trim();
  let host;
  let pathname;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(raw)) {
    let parsed;
    try { parsed = new URL(raw); }
    catch { return null; }
    if (!['https:', 'ssh:', 'git:'].includes(parsed.protocol) || !parsed.hostname) return null;
    host = parsed.hostname.toLowerCase();
    pathname = parsed.pathname;
  } else {
    const scp = raw.match(/^(?:[^@\s]+@)?([^:\s]+):(.+)$/);
    if (!scp || /^[A-Za-z]:[\\/]/.test(raw)) return null;
    host = scp[1].toLowerCase();
    pathname = scp[2];
  }
  pathname = pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
  if (!pathname || pathname.split('/').length < 2) return null;
  if (['github.com', 'gitlab.com', 'bitbucket.org'].includes(host)) pathname = pathname.toLowerCase();
  return `${host}/${pathname}`;
}

function sameGitRemote(left, right) {
  const leftIdentity = gitRemoteIdentity(left);
  return Boolean(leftIdentity && leftIdentity === gitRemoteIdentity(right));
}

function buildMaintenancePlan(catalogValue, systemId, operation, context = {}) {
  if (!['install', 'update'].includes(operation)) throw new Error(`Unsupported maintenance operation: ${operation}`);
  const { system, packageDefinition, source } = getCatalogBinding(catalogValue, systemId);
  if (!packageDefinition || !packageDefinition.operations.includes(operation)) {
    throw new Error(`${systemId} does not allow ${operation}`);
  }
  const expandPath = typeof context.expandPath === 'function' ? context.expandPath : (value) => value;
  const preflight = [];
  let command;

  if (source.type === 'winget') {
    const verb = operation === 'install' ? 'install' : 'upgrade';
    command = {
      file: 'winget.exe',
      args: [
        verb, '--id', packageDefinition.identifier, '--exact', '--source', source.channel, '--silent',
        '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity',
      ],
      cwd: context.cwd || null,
    };
  } else if (source.type === 'npm') {
    const packageName = operation === 'update' ? `${packageDefinition.name}@latest` : packageDefinition.name;
    command = {
      file: 'npm.cmd',
      args: ['install', '--global', packageName, '--registry', source.url],
      cwd: context.cwd || null,
    };
  } else if (source.type === 'uv') {
    command = {
      file: 'uv.exe',
      args: ['tool', 'install', '--python', packageDefinition.python, '--index-url', source.url, packageDefinition.name],
      cwd: context.cwd || null,
    };
  } else {
    const repository = expandPath(packageDefinition.path);
    const branch = String(context.branch || '');
    if (!isSafeGitBranch(branch)) throw new Error('A safe checked Git branch is required for a Git update');
    preflight.push({
      kind: 'official-source', file: 'git.exe', args: ['remote', 'get-url', packageDefinition.remote],
      cwd: repository, expected: source.url,
    });
    if (packageDefinition.guards.includes('cleanWorkingTree')) {
      preflight.push({ kind: 'clean-working-tree', file: 'git.exe', args: ['status', '--porcelain'], cwd: repository, expected: '' });
    }
    command = {
      file: 'git.exe',
      args: ['pull', '--ff-only', packageDefinition.remote, branch],
      cwd: repository,
    };
  }

  return deepFreeze({
    systemId: system.id,
    packageId: packageDefinition.id,
    sourceId: source.id,
    sourceType: source.type,
    operation,
    displayName: packageDefinition.displayName,
    mutating: true,
    cancellationPolicy: 'queued-only',
    preflight,
    command,
  });
}

module.exports = {
  CATALOG_SCHEMA_VERSION,
  CatalogValidationError,
  normalizeCatalog,
  getCatalogBinding,
  buildMaintenancePlan,
  isSafeGitBranch,
  gitRemoteIdentity,
  sameGitRemote,
};
