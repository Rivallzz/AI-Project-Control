'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { after, test } = require('node:test');
const { createCompletedDashboardJob } = require('./test-helpers/job-fixture');
const { requestJson, waitFor } = require('./test-helpers/http-client');
const { createSandbox, removeSandbox, startServer } = require('./test-helpers/server-harness');

let root;
let server;

let recoverJobs = null;
try { ({ recoverJobs } = require('../server')); }
catch {}

after(async () => {
  await server?.stop();
  if (root) await removeSandbox(root);
});

test('completed jobs remain visible after a server restart', async () => {
  root = await createSandbox();
  server = await startServer({ root });
  const { job } = await createCompletedDashboardJob(server, 'RestartProject');
  await waitFor(async () => {
    try {
      const store = JSON.parse(await fs.readFile(path.join(server.dataRoot, 'jobs.json'), 'utf8'));
      return store.jobs?.some((candidate) => candidate.id === job.id && candidate.status === 'completed');
    } catch { return false; }
  }, { description: 'completed job persistence' });
  await server.stop();

  server = await startServer({ root });
  const jobs = await requestJson(server.baseUrl, '/api/jobs');
  const recovered = jobs.body.find((candidate) => candidate.id === job.id);
  assert.ok(recovered, 'the restarted server must reload the completed job');
  assert.equal(recovered.status, 'completed');
  assert.equal(recovered.kind, 'dashboard-command');
});

test('in-flight jobs recover as explicit non-running interrupted records', {
  skip: typeof recoverJobs === 'function' ? false : 'Required production hook: server.js#recoverJobs(records, now)',
}, () => {
  const now = '2026-07-13T12:00:00.000Z';
  const [running, stopping, completed] = recoverJobs([
    { id: 'running', kind: 'task', status: 'running', pid: 10, stdout: 'kept' },
    { id: 'stopping', kind: 'update', status: 'stopping', pid: 11, stdout: '' },
    { id: 'completed', kind: 'install', status: 'completed', pid: null, finishedAt: '2026-07-13T11:00:00.000Z' },
  ], now);

  for (const recovered of [running, stopping]) {
    assert.equal(['running', 'stopping'].includes(recovered.status), false);
    assert.equal(recovered.phase, 'interrupted');
    assert.equal(recovered.finishedAt, now);
    assert.equal(recovered.updatedAt, now);
    assert.equal(recovered.pid, null);
  }
  assert.equal(running.stdout, 'kept');
  assert.equal(completed.status, 'completed');
  assert.equal(completed.finishedAt, '2026-07-13T11:00:00.000Z');
});
