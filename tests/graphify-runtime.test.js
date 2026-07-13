'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { test } = require('node:test');
const { resolvePythonModuleRuntime } = require('../lib/runtime/python-module');
const { createRepository } = require('./test-helpers/git-fixture');
const { postJson, requestJson } = require('./test-helpers/http-client');
const { createSandbox, removeSandbox, startServer } = require('./test-helpers/server-harness');

test('Python module discovery prefers the Windows launcher over a PATH interpreter', async () => {
  const calls = [];
  const runtime = await resolvePythonModuleRuntime({
    moduleName: 'graphify',
    platform: 'win32',
    summarize: async (command, args) => {
      calls.push({ command, args });
      return command === 'py.exe'
        ? { ok: true, text: 'graphify 0.9.10' }
        : { ok: false, text: 'unexpected PATH interpreter' };
    },
  });

  assert.deepEqual(runtime, { command: 'py.exe', ok: true, text: 'graphify 0.9.10' });
  assert.deepEqual(calls, [{ command: 'py.exe', args: ['-m', 'graphify', '--version'] }]);
});

test('Python module discovery falls back when the Windows launcher lacks the module', async () => {
  const calls = [];
  const runtime = await resolvePythonModuleRuntime({
    moduleName: 'graphify',
    platform: 'win32',
    summarize: async (command) => {
      calls.push(command);
      return command === 'python.exe'
        ? { ok: true, text: 'graphify 0.9.10' }
        : { ok: false, text: 'module missing' };
    },
  });

  assert.equal(runtime.command, 'python.exe');
  assert.equal(runtime.ok, true);
  assert.deepEqual(calls, ['py.exe', 'python.exe']);
});

test('an existing configured Python remains the authoritative module runtime', async () => {
  const calls = [];
  const configuredCommand = 'C:\\Tools\\Graphify\\python.exe';
  const runtime = await resolvePythonModuleRuntime({
    moduleName: 'graphify',
    configuredCommand,
    commandExists: (candidate) => candidate === configuredCommand,
    platform: 'win32',
    summarize: async (command) => {
      calls.push(command);
      return { ok: false, text: 'configured runtime is unhealthy' };
    },
  });

  assert.deepEqual(runtime, { command: configuredCommand, ok: false, text: 'configured runtime is unhealthy' });
  assert.deepEqual(calls, [configuredCommand]);
});

test('portfolio freshness remains based on the index when the Graphify CLI is unavailable', async () => {
  const root = await createSandbox();
  let server;
  try {
    server = await startServer({
      root,
      extraEnv: { AI_PROJECT_CONTROL_GRAPHIFY_PYTHON: process.execPath },
    });
    const fixture = await createRepository(root);
    const graphPath = path.join(fixture.repository, 'graphify-out', 'graph.json');
    const obsidianPath = path.join(root, 'obsidian-project');
    await fs.mkdir(path.dirname(graphPath), { recursive: true });
    await fs.writeFile(graphPath, JSON.stringify({
      nodes: [{ id: 'repository', label: 'Repository' }],
      links: [],
      built_at_commit: '0000000000000000000000000000000000000000',
    }), 'utf8');

    const registered = await postJson(server.baseUrl, '/api/projects', {
      name: 'Graphify Status',
      repository: fixture.repository,
      graphPath,
      obsidianPath,
    });
    assert.equal(registered.status, 201, JSON.stringify(registered.body));

    const projectId = registered.body.id;
    const components = await requestJson(server.baseUrl, `/api/components?projectId=${encodeURIComponent(projectId)}&force=1`);
    assert.equal(components.status, 200);
    assert.equal(components.body.graphify.ok, false);
    assert.equal(components.body.graphify.cli.ok, false);
    assert.equal(components.body.graphify.index.ok, true);
    assert.equal(components.body.graphify.index.exists, true);
    assert.match(components.body.graphify.text, /1 nodes · 0 links/);

    const portfolio = await requestJson(server.baseUrl, `/api/portfolio?projectId=${encodeURIComponent(projectId)}`);
    assert.equal(portfolio.status, 200);
    const row = portfolio.body.projects.find((candidate) => candidate.id === projectId);
    assert.ok(row, JSON.stringify(portfolio.body));
    assert.equal(row.graph.status, 'veraltet');
    assert.equal(row.graph.ok, false);
    const projectAttention = portfolio.body.attention.filter((entry) => entry.projectId === projectId);
    assert.equal(projectAttention.some((entry) => entry.message === 'Der Graphify-Index basiert nicht auf dem aktuellen Commit.'), true);
    assert.equal(projectAttention.some((entry) => entry.message === 'Der Graphify-Index fehlt oder ist nicht lesbar.'), false);
  } finally {
    await server?.stop();
    await removeSandbox(root);
  }
});
