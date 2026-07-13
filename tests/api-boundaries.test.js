'use strict';

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { requestJson } = require('./test-helpers/http-client');
const { createSandbox, removeSandbox, startServer } = require('./test-helpers/server-harness');

let root;
let server;
let project;

before(async () => {
  root = await createSandbox();
  server = await startServer({ root });
  const projects = await requestJson(server.baseUrl, '/api/projects');
  project = projects.body.projects[0];
});

after(async () => {
  await server?.stop();
  if (root) await removeSandbox(root);
});

test('the isolated harness chooses a non-default port and health reports it', async () => {
  const health = await requestJson(server.baseUrl, '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');
  assert.equal(health.body.host, '127.0.0.1');
  assert.equal(health.body.port, server.port);
  assert.notEqual(server.port, 8765);
});

test('the config endpoint exposes the versioned model catalog including partial availability', async () => {
  const response = await requestJson(server.baseUrl, '/api/config');
  assert.equal(response.status, 200);
  assert.equal(response.body.apiContractVersion, 2);
  assert.equal(response.body.modelCatalog.version, 1);
  assert.deepEqual(Object.keys(response.body.modelCatalog.providers), ['Codex', 'Claude', 'Ollama']);
  assert.equal(response.body.modelCatalog.providers.Codex.models.some((model) => model.id === 'default'), true);
  assert.equal(response.body.modelCatalog.providers.Claude.models.some((model) => model.id === 'sonnet'), true);
  assert.equal(response.body.modelCatalog.providers.Ollama.status, 'error');
});

test('a foreign Origin cannot mutate local project state', async () => {
  const marker = 'foreign-origin-must-not-be-written';
  const rejected = await requestJson(server.baseUrl, '/api/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.invalid' },
    body: JSON.stringify({ projectId: project.id, text: marker }),
  });
  assert.equal(rejected.status, 403);

  const memory = await requestJson(server.baseUrl, `/api/memory?projectId=${encodeURIComponent(project.id)}`);
  assert.equal(JSON.stringify(memory.body).includes(marker), false);
});

test('a mutating request with a non-JSON content type is rejected', async () => {
  const marker = 'text-content-type-must-not-be-written';
  const rejected = await requestJson(server.baseUrl, '/api/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Origin: server.baseUrl },
    body: JSON.stringify({ projectId: project.id, text: marker }),
  });
  assert.equal(rejected.status, 415);

  const memory = await requestJson(server.baseUrl, `/api/memory?projectId=${encodeURIComponent(project.id)}`);
  assert.equal(JSON.stringify(memory.body).includes(marker), false);
});

test('a same-origin application/json mutation remains accepted', async () => {
  const accepted = await requestJson(server.baseUrl, '/api/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: server.baseUrl },
    body: JSON.stringify({ projectId: project.id, text: 'same-origin-contract' }),
  });
  assert.equal(accepted.status, 201);
});

test('an unknown active model is rejected before provider execution', async () => {
  const rejected = await requestJson(server.baseUrl, '/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: server.baseUrl },
    body: JSON.stringify({
      projectId: project.id,
      task: 'Do not start a provider for this invalid model.',
      provider: 'Codex',
      providerOrder: ['Codex'],
      models: { Codex: 'fantasy-model', Claude: 'default', Ollama: 'default' },
      mode: 'ReadOnly',
      useSubscriptionTokens: true,
    }),
  });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error, /fantasy-model/);
  assert.match(rejected.body.error, /nicht verfügbar/);
});
