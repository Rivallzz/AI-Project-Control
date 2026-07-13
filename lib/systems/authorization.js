'use strict';

const { createHash } = require('node:crypto');
const { normalizeCatalog, getCatalogBinding, isSafeGitBranch } = require('./catalog');
const { semverDirection } = require('./semver');

const UPDATE_CACHE_SCHEMA_VERSION = 2;
const DEFAULT_UPDATE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_CLOCK_SKEW_MS = 30_000;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  const normalized = {};
  for (const key of Object.keys(value).sort()) normalized[key] = canonicalize(value[key]);
  return normalized;
}

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;
}

function fingerprintableCatalog(catalog) {
  return {
    ...catalog,
    sources: [...catalog.sources].sort((left, right) => left.id.localeCompare(right.id)),
    packages: [...catalog.packages].sort((left, right) => left.id.localeCompare(right.id)),
    systems: [...catalog.systems].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function catalogFingerprint(catalogValue) {
  return digest(fingerprintableCatalog(normalizeCatalog(catalogValue)));
}

function packageFingerprint(catalogValue, systemId) {
  const { system, packageDefinition, source } = getCatalogBinding(catalogValue, systemId);
  if (!packageDefinition) throw new Error(`${systemId} has no package binding`);
  return digest({ system: { id: system.id, package: system.package }, package: packageDefinition, source });
}

function nowMilliseconds(now) {
  const value = typeof now === 'function' ? now() : now === undefined ? Date.now() : now;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid authorization clock value');
  return date.getTime();
}

function checkEntries(value) {
  if (value?.entries && typeof value.entries === 'object' && !Array.isArray(value.entries)) return value.entries;
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  throw new Error('Update check results must be an entries object');
}

function createUpdateCache(catalogValue, checkResults, options = {}) {
  const catalog = normalizeCatalog(catalogValue);
  const results = checkEntries(checkResults);
  const generatedAt = new Date(nowMilliseconds(options.now)).toISOString();
  const entries = {};
  for (const system of catalog.systems) {
    if (!system.package) continue;
    const binding = getCatalogBinding(catalog, system.id);
    if (!binding.packageDefinition.operations.includes('check')) continue;
    const result = results[system.id];
    if (!result || typeof result !== 'object') continue;
    if (result.systemId && result.systemId !== system.id) throw new Error(`Mismatched result system for ${system.id}`);
    if (result.packageId && result.packageId !== binding.packageDefinition.id) throw new Error(`Mismatched result package for ${system.id}`);
    if (result.sourceId && result.sourceId !== binding.source.id) throw new Error(`Mismatched result source for ${system.id}`);
    entries[system.id] = {
      systemId: system.id,
      packageId: binding.packageDefinition.id,
      sourceId: binding.source.id,
      packageFingerprint: packageFingerprint(catalog, system.id),
      status: String(result.status || 'unknown'),
      direction: String(result.direction || 'unknown'),
      relation: result.relation ? String(result.relation) : null,
      currentVersion: result.currentVersion ? String(result.currentVersion) : null,
      latestVersion: result.latestVersion ? String(result.latestVersion) : null,
      ahead: Number.isSafeInteger(result.ahead) ? result.ahead : null,
      behind: Number.isSafeInteger(result.behind) ? result.behind : null,
      branch: result.branch ? String(result.branch) : null,
      checkedAt: result.checkedAt ? String(result.checkedAt) : null,
      reasonCode: result.reasonCode ? String(result.reasonCode) : null,
    };
  }
  return {
    schemaVersion: UPDATE_CACHE_SCHEMA_VERSION,
    catalogFingerprint: catalogFingerprint(catalog),
    generatedAt,
    entries,
  };
}

function denied(code, reason) {
  return { authorized: false, code, reason };
}

function authorizeSystemUpdate(catalogValue, cache, systemId, options = {}) {
  const catalog = normalizeCatalog(catalogValue);
  let binding;
  try { binding = getCatalogBinding(catalog, systemId); }
  catch { return denied('unknown-system', 'The system is not present in the catalog.'); }
  if (!binding.packageDefinition?.operations.includes('update')) {
    return denied('update-not-approved', 'The system has no catalog-approved update operation.');
  }
  if (!cache || cache.schemaVersion !== UPDATE_CACHE_SCHEMA_VERSION || !cache.entries || typeof cache.entries !== 'object') {
    return denied('cache-schema', 'The update evidence cache has an unsupported shape.');
  }
  const currentCatalogFingerprint = catalogFingerprint(catalog);
  if (cache.catalogFingerprint !== currentCatalogFingerprint) {
    return denied('catalog-changed', 'The catalog changed after the update check.');
  }
  const entry = cache.entries[systemId];
  if (!entry || typeof entry !== 'object') return denied('no-evidence', 'No update evidence exists for this system.');
  if (entry.systemId !== systemId
    || entry.packageId !== binding.packageDefinition.id
    || entry.sourceId !== binding.source.id
    || entry.packageFingerprint !== packageFingerprint(catalog, systemId)) {
    return denied('binding-changed', 'The update evidence is not bound to the current package and official source.');
  }

  const checkedAt = Date.parse(entry.checkedAt);
  if (!Number.isFinite(checkedAt)) return denied('invalid-timestamp', 'The update evidence has no valid check time.');
  const now = nowMilliseconds(options.now);
  const ttlMs = options.ttlMs === undefined ? DEFAULT_UPDATE_TTL_MS : Number(options.ttlMs);
  const maxClockSkewMs = options.maxClockSkewMs === undefined ? DEFAULT_CLOCK_SKEW_MS : Number(options.maxClockSkewMs);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('Update authorization TTL must be positive');
  if (!Number.isFinite(maxClockSkewMs) || maxClockSkewMs < 0) throw new Error('Clock skew allowance must not be negative');
  if (checkedAt - now > maxClockSkewMs) return denied('future-evidence', 'The update evidence is dated in the future.');
  if (now - checkedAt > ttlMs) return denied('stale-evidence', 'The update evidence has expired.');
  if (entry.status !== 'available') return denied('update-not-available', 'The latest check did not authorize an update.');

  if (binding.source.type === 'git') {
    if (entry.relation !== 'behind' || entry.ahead !== 0 || !Number.isSafeInteger(entry.behind) || entry.behind <= 0 || !isSafeGitBranch(entry.branch)) {
      return denied('unsafe-git-direction', 'Only a strictly behind Git checkout can be fast-forward updated.');
    }
  } else {
    const direction = semverDirection(entry.currentVersion, entry.latestVersion);
    if (entry.direction !== 'behind' || direction !== 'behind') {
      return denied('unsafe-semver-direction', 'Only a strictly newer semantic version can be installed.');
    }
  }

  const expiresAt = new Date(checkedAt + ttlMs).toISOString();
  const authorizationId = digest({
    catalogFingerprint: currentCatalogFingerprint,
    packageFingerprint: entry.packageFingerprint,
    systemId,
    checkedAt: entry.checkedAt,
    currentVersion: entry.currentVersion,
    latestVersion: entry.latestVersion,
    relation: entry.relation,
    branch: entry.branch,
  });
  return {
    authorized: true,
    code: 'authorized',
    authorizationId,
    systemId,
    packageId: entry.packageId,
    sourceId: entry.sourceId,
    checkedAt: entry.checkedAt,
    expiresAt,
    branch: entry.branch,
  };
}

function assertSystemUpdateAuthorized(catalog, cache, systemId, options = {}) {
  const authorization = authorizeSystemUpdate(catalog, cache, systemId, options);
  if (authorization.authorized) return authorization;
  const error = new Error(authorization.reason);
  error.code = authorization.code;
  throw error;
}

function consumeSystemUpdateAuthorization(catalog, cache, systemId, options = {}) {
  const authorization = assertSystemUpdateAuthorized(catalog, cache, systemId, options);
  const entries = { ...cache.entries };
  delete entries[systemId];
  return { authorization, cache: { ...cache, entries } };
}

module.exports = {
  UPDATE_CACHE_SCHEMA_VERSION,
  DEFAULT_UPDATE_TTL_MS,
  catalogFingerprint,
  packageFingerprint,
  createUpdateCache,
  authorizeSystemUpdate,
  assertSystemUpdateAuthorized,
  consumeSystemUpdateAuthorization,
};
