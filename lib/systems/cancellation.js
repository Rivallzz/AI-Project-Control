'use strict';

const PROCESS_CANCELLABLE_KINDS = new Set(['task', 'update-check']);
const QUEUED_ONLY_KINDS = new Set(['install', 'update', 'provision', 'dashboard-command']);
const ACTIVE_STATUSES = new Set(['queued', 'running']);

function safeProcessId(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 0x7fffffff;
}

function cancellationMetadata(job) {
  const kind = String(job?.kind || '');
  const status = String(job?.status || '');
  const phase = String(job?.phase || '');
  const queued = ACTIVE_STATUSES.has(status) && phase === 'queued' && !safeProcessId(job?.pid);

  if (status === 'stopping') {
    return Object.freeze({ cancellable: false, mode: null, reasonCode: 'cancellation-in-progress' });
  }
  if (queued && (PROCESS_CANCELLABLE_KINDS.has(kind) || QUEUED_ONLY_KINDS.has(kind))) {
    return Object.freeze({ cancellable: true, mode: 'queued', reasonCode: null });
  }
  if (!ACTIVE_STATUSES.has(status)) {
    return Object.freeze({ cancellable: false, mode: null, reasonCode: 'job-not-active' });
  }
  if (QUEUED_ONLY_KINDS.has(kind)) {
    return Object.freeze({ cancellable: false, mode: null, reasonCode: 'mutation-in-progress' });
  }
  if (!PROCESS_CANCELLABLE_KINDS.has(kind)) {
    return Object.freeze({ cancellable: false, mode: null, reasonCode: 'job-kind-not-cancellable' });
  }
  if (!safeProcessId(job?.pid)) {
    return Object.freeze({ cancellable: false, mode: null, reasonCode: 'process-not-running' });
  }
  return Object.freeze({ cancellable: true, mode: 'process-tree', reasonCode: null });
}

function resolveCancellationTarget(job) {
  const metadata = cancellationMetadata(job);
  if (!metadata.cancellable) {
    const error = new Error(`Job cannot be cancelled: ${metadata.reasonCode}`);
    error.code = metadata.reasonCode;
    throw error;
  }
  if (metadata.mode === 'queued') return { mode: 'queued' };
  return { mode: 'process-tree', pid: job.pid };
}

function cancellableSnapshotMetadata(job) {
  const cancellation = cancellationMetadata(job);
  return { cancellable: cancellation.cancellable, cancellation };
}

module.exports = {
  cancellationMetadata,
  resolveCancellationTarget,
  cancellableSnapshotMetadata,
};
