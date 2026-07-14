'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { requestJson } = require('./test-helpers/http-client');
const { createRepository } = require('./test-helpers/git-fixture');
const { createSandbox, removeSandbox, startServer } = require('./test-helpers/server-harness');

let root;
let server;
let project;
let graphProject;

before(async () => {
  root = await createSandbox();
  server = await startServer({ root });
  const projects = await requestJson(server.baseUrl, '/api/projects');
  project = projects.body.projects[0];
  const fixture = await createRepository(root);
  const graphPath = path.join(fixture.repository, 'graphify-out', 'graph.json');
  await fs.mkdir(path.dirname(graphPath), { recursive: true });
  await fs.writeFile(graphPath, JSON.stringify({
    nodes: [{ id: 'a' }, { id: 'b' }],
    links: [{ source: 'a', target: 'b' }],
  }), 'utf8');
  const registered = await requestJson(server.baseUrl, '/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: server.baseUrl },
    body: JSON.stringify({
      name: 'Graph Status Fixture',
      repository: fixture.repository,
      graphPath,
      obsidianPath: path.join(root, 'obsidian', 'Graph Status Fixture'),
    }),
  });
  assert.equal(registered.status, 201);
  graphProject = registered.body;
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
  assert.equal(response.body.apiContractVersion, 3);
  assert.equal(response.body.modelCatalog.version, 1);
  assert.deepEqual(Object.keys(response.body.modelCatalog.providers), ['Codex', 'Claude', 'Ollama']);
  assert.equal(response.body.modelCatalog.providers.Codex.models.some((model) => model.id === 'default'), true);
  assert.equal(response.body.modelCatalog.providers.Claude.models.some((model) => model.id === 'sonnet'), true);
  assert.equal(response.body.modelCatalog.providers.Ollama.status, 'error');
});

test('the MCP endpoint exposes read-only configuration state without credential values', async () => {
  const codexRoot = path.join(root, 'home', '.codex');
  await fs.mkdir(codexRoot, { recursive: true });
  await fs.writeFile(path.join(codexRoot, 'config.toml'), `
    [mcp_servers.remote]
    url = 'https://account:password@example.test/mcp?token=must-not-leak'
    bearer_token_env_var = 'REMOTE_TOKEN'
  `, 'utf8');

  const response = await requestJson(server.baseUrl, `/api/mcp?projectId=${encodeURIComponent(graphProject.id)}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.policy.mode, 'read-only');
  assert.equal(response.body.summary.configured, 1);
  assert.equal(response.body.servers[0].health.state, 'not-checked');
  assert.equal(response.body.servers[0].target, 'https://example.test/mcp?…');
  assert.deepEqual(response.body.servers[0].environmentRefs, ['REMOTE_TOKEN']);
  assert.doesNotMatch(JSON.stringify(response.body), /password|must-not-leak/);
});

test('the workflow endpoint explains stages and tools without exposing MCP credentials or targets', async () => {
  const response = await requestJson(server.baseUrl, `/api/workflow?projectId=${encodeURIComponent(graphProject.id)}&mode=ReadOnly&providerOrder=Codex,Claude&useSubscriptionTokens=1&codeTask=0`);
  assert.equal(response.status, 200);
  assert.equal(response.body.policy.mode, 'read-only');
  assert.equal(response.body.summary.mode, 'ReadOnly');
  assert.deepEqual(response.body.stages.map((entry) => entry.title), ['Projektkontext', 'Provider-Route', 'Agent', 'Review', 'Commit', 'Integration', 'Push']);
  assert.equal(response.body.stages.find((entry) => entry.id === 'push').state, 'not-required');
  assert.equal(response.body.tools.some((entry) => entry.name === 'Graphify'), true);
  assert.doesNotMatch(JSON.stringify(response.body), /password|must-not-leak|example\.test|REMOTE_TOKEN/);
});

test('a readable project index stays available when the global Graphify CLI is unavailable', async () => {
  const components = await requestJson(server.baseUrl, `/api/components?projectId=${encodeURIComponent(graphProject.id)}&force=1`);
  assert.equal(components.status, 200);
  assert.equal(components.body.graphify.ok, true);
  assert.equal(components.body.graphify.index.ok, true);
  assert.equal(components.body.graphify.runtime.ok, false);
  assert.match(components.body.graphify.text, /2 nodes · 1 links/);

  const portfolio = await requestJson(server.baseUrl, '/api/portfolio');
  const projectRow = portfolio.body.projects.find((candidate) => candidate.id === graphProject.id);
  assert.equal(projectRow.graph.status, 'aktuell');
  assert.equal(portfolio.body.attention.some((item) => item.projectId === graphProject.id && /Graphify-Index fehlt/.test(item.message)), false);
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
