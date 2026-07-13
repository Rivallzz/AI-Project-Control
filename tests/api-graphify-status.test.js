'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { createRepository, git } = require('./test-helpers/git-fixture');
const { postJson, requestJson } = require('./test-helpers/http-client');
const { createSandbox, removeSandbox, startServer } = require('./test-helpers/server-harness');

let fixture;
let graphPath;
let project;
let root;
let server;

before(async () => {
  root = await createSandbox();
  server = await startServer({ root });
  fixture = await createRepository(root);
  graphPath = path.join(fixture.repository, 'graphify-out', 'graph.json');
  await fs.mkdir(path.dirname(graphPath), { recursive: true });

  const head = (await git(['rev-parse', 'HEAD'], { cwd: fixture.repository })).stdout.trim();
  await writeGraph(head);

  const registered = await postJson(server.baseUrl, '/api/projects', {
    name: 'Graphify Status Contract',
    repository: fixture.repository,
    graphPath,
    obsidianPath: path.join(root, 'obsidian', 'Graphify Status Contract'),
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  project = registered.body;
});

after(async () => {
  await server?.stop();
  if (root) await removeSandbox(root);
});

async function writeGraph(builtAtCommit) {
  await fs.writeFile(graphPath, JSON.stringify({
    directed: false,
    multigraph: false,
    graph: {},
    nodes: [{ id: 'readme', label: 'README', source_file: 'README.md' }],
    links: [],
    built_at_commit: builtAtCommit,
  }), 'utf8');
}

async function graphifyComponents() {
  const response = await requestJson(
    server.baseUrl,
    `/api/components?projectId=${encodeURIComponent(project.id)}&force=1`,
  );
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.graphify;
}

async function portfolioGraph() {
  const response = await requestJson(server.baseUrl, '/api/portfolio');
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const selected = response.body.projects.find((candidate) => candidate.id === project.id);
  assert(selected, `Portfolio omitted project ${project.id}.`);
  return selected.graph;
}

test('Graphify index status and freshness remain independent from runtime availability', async () => {
  const readyComponents = await graphifyComponents();
  assert.equal(readyComponents.ok, false);
  assert.equal(readyComponents.runtimeOk, false);
  assert.equal(readyComponents.indexOk, true);
  assert.equal(readyComponents.indexStatus, 'ready');

  const graph = await requestJson(
    server.baseUrl,
    `/api/graph?projectId=${encodeURIComponent(project.id)}`,
  );
  assert.equal(graph.status, 200, JSON.stringify(graph.body));
  assert.deepEqual(graph.body.totals, { nodes: 1, links: 0 });
  assert.equal((await portfolioGraph()).status, 'aktuell');

  await writeGraph('0000000000000000000000000000000000000000');
  const staleComponents = await graphifyComponents();
  assert.equal(staleComponents.runtimeOk, false);
  assert.equal(staleComponents.indexOk, true);
  assert.equal(staleComponents.indexStatus, 'ready');
  assert.equal((await portfolioGraph()).status, 'veraltet');

  await writeGraph(null);
  const unknownComponents = await graphifyComponents();
  assert.equal(unknownComponents.indexOk, true);
  assert.equal(unknownComponents.indexStatus, 'ready');
  assert.equal((await portfolioGraph()).status, 'unbekannt');

  await fs.writeFile(graphPath, '{"nodes":', 'utf8');
  const invalidComponents = await graphifyComponents();
  assert.equal(invalidComponents.indexOk, false);
  assert.equal((await portfolioGraph()).status, 'fehlerhaft');

  await fs.rm(graphPath);
  const missingComponents = await graphifyComponents();
  assert.equal(missingComponents.indexOk, false);
  assert.equal((await portfolioGraph()).status, 'fehlt');
});
