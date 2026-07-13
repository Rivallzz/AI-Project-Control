'use strict';

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { createCompletedDashboardJob } = require('./test-helpers/job-fixture');
const { requestJson } = require('./test-helpers/http-client');
const { createSandbox, removeSandbox, startServer } = require('./test-helpers/server-harness');
const { openSse } = require('./test-helpers/sse-client');

let root;
let server;

before(async () => {
  root = await createSandbox();
  server = await startServer({ root });
});

after(async () => {
  await server?.stop();
  if (root) await removeSandbox(root);
});

test('SSE carries a non-provider dashboard job with the same public shape as /api/jobs', async () => {
  const stream = openSse(`${server.baseUrl}/api/events`);
  await stream.ready;
  try {
    const { job } = await createCompletedDashboardJob(server, 'SseProject');
    const event = await stream.waitForEvent((candidate) => {
      if (candidate.type !== 'job') return false;
      try { return JSON.parse(candidate.data).id === job.id; }
      catch { return false; }
    });
    const streamed = JSON.parse(event.data);
    const listed = await requestJson(server.baseUrl, '/api/jobs');
    const fromApi = listed.body.find((candidate) => candidate.id === job.id);

    assert.equal(streamed.kind, 'dashboard-command');
    assert.equal(streamed.projectId, job.projectId);
    assert.equal(typeof streamed.stdout, 'string');
    assert.match(streamed.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(streamed, fromApi);
  } finally {
    stream.close();
  }
});
