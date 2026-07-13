'use strict';

const MAINTENANCE_GUARD_SCHEMA_VERSION = 1;
const MAINTENANCE_KINDS = new Set(['install', 'update', 'provision']);
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function emptyMaintenanceGuard() {
  return { schemaVersion: MAINTENANCE_GUARD_SCHEMA_VERSION, revision: 0, active: null };
}

function safeToken(value, name, optional = false) {
  if ((value === null || value === undefined || value === '') && optional) return null;
  const token = String(value || '').trim();
  if (!TOKEN_PATTERN.test(token)) throw new Error(`${name} has an invalid format`);
  return token;
}

function safeTime(value, name) {
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) throw new Error(`${name} must be a valid time`);
  return time.toISOString();
}

function exactKeys(value, keys, name) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${name} has an unsupported shape`);
  }
}

function restoreMaintenanceGuard(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); }
    catch { throw new Error('Maintenance guard is not valid JSON'); }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Maintenance guard must be an object');
  exactKeys(parsed, ['schemaVersion', 'revision', 'active'], 'Maintenance guard');
  if (parsed.schemaVersion !== MAINTENANCE_GUARD_SCHEMA_VERSION) throw new Error('Maintenance guard schema is unsupported');
  if (!Number.isSafeInteger(parsed.revision) || parsed.revision < 0) throw new Error('Maintenance guard revision is invalid');
  if (parsed.active === null) return { schemaVersion: parsed.schemaVersion, revision: parsed.revision, active: null };
  if (!parsed.active || typeof parsed.active !== 'object' || Array.isArray(parsed.active)) throw new Error('Maintenance lease is invalid');
  exactKeys(parsed.active, ['leaseId', 'jobId', 'kind', 'systemId', 'projectId', 'acquiredAt'], 'Maintenance lease');
  const kind = safeToken(parsed.active.kind, 'Maintenance kind');
  if (!MAINTENANCE_KINDS.has(kind)) throw new Error('Maintenance kind is unsupported');
  return {
    schemaVersion: parsed.schemaVersion,
    revision: parsed.revision,
    active: {
      leaseId: safeToken(parsed.active.leaseId, 'Maintenance lease id'),
      jobId: safeToken(parsed.active.jobId, 'Maintenance job id'),
      kind,
      systemId: safeToken(parsed.active.systemId, 'Maintenance system id', true),
      projectId: safeToken(parsed.active.projectId, 'Maintenance project id', true),
      acquiredAt: safeTime(parsed.active.acquiredAt, 'Maintenance acquisition time'),
    },
  };
}

function serializeMaintenanceGuard(value) {
  return JSON.stringify(restoreMaintenanceGuard(value));
}

function acquisitionTime(now) {
  const value = typeof now === 'function' ? now() : now === undefined ? Date.now() : now;
  return safeTime(value, 'Maintenance acquisition time');
}

function tryAcquireMaintenanceJob(stateValue, request, options = {}) {
  const state = restoreMaintenanceGuard(stateValue || emptyMaintenanceGuard());
  if (state.active) {
    return {
      acquired: false,
      code: 'maintenance-busy',
      state,
      active: { ...state.active },
    };
  }
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Maintenance request must be an object');
  const kind = safeToken(request.kind, 'Maintenance kind');
  if (!MAINTENANCE_KINDS.has(kind)) throw new Error('Maintenance kind is unsupported');
  const jobId = safeToken(request.jobId, 'Maintenance job id');
  const revision = state.revision + 1;
  const active = {
    leaseId: `lease:${revision}`,
    jobId,
    kind,
    systemId: safeToken(request.systemId, 'Maintenance system id', kind === 'provision'),
    projectId: safeToken(request.projectId, 'Maintenance project id', true),
    acquiredAt: acquisitionTime(options.now),
  };
  const nextState = { schemaVersion: MAINTENANCE_GUARD_SCHEMA_VERSION, revision, active };
  return { acquired: true, code: 'acquired', lease: { ...active }, state: nextState };
}

function releaseMaintenanceJob(stateValue, lease, outcome = 'completed') {
  const state = restoreMaintenanceGuard(stateValue);
  if (!state.active) return { released: false, code: 'maintenance-idle', state };
  if (!lease || lease.leaseId !== state.active.leaseId || lease.jobId !== state.active.jobId) {
    return { released: false, code: 'lease-mismatch', state, active: { ...state.active } };
  }
  if (!['completed', 'failed', 'cancelled'].includes(outcome)) throw new Error('Maintenance outcome is unsupported');
  return {
    released: true,
    code: 'released',
    outcome,
    releasedLease: { ...state.active },
    state: { schemaVersion: MAINTENANCE_GUARD_SCHEMA_VERSION, revision: state.revision + 1, active: null },
  };
}

function recoverMaintenanceGuard(stateValue, confirmation) {
  const state = restoreMaintenanceGuard(stateValue);
  if (!state.active) return { recovered: false, code: 'maintenance-idle', state };
  if (confirmation?.confirmedInactive !== true) {
    return { recovered: false, code: 'recovery-not-confirmed', state, active: { ...state.active } };
  }
  const reason = String(confirmation.reason || '').trim();
  if (!reason) throw new Error('Maintenance recovery requires a reason');
  return {
    recovered: true,
    code: 'recovered',
    reason,
    recoveredLease: { ...state.active },
    state: { schemaVersion: MAINTENANCE_GUARD_SCHEMA_VERSION, revision: state.revision + 1, active: null },
  };
}

module.exports = {
  MAINTENANCE_GUARD_SCHEMA_VERSION,
  emptyMaintenanceGuard,
  restoreMaintenanceGuard,
  serializeMaintenanceGuard,
  tryAcquireMaintenanceJob,
  releaseMaintenanceJob,
  recoverMaintenanceGuard,
};
