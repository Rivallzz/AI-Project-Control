'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildCurrentWorkflow } = require('../lib/workflow/current-workflow');

const project = { id: 'demo', name: 'Demo' };
const components = {
  codex: { ok: true }, claude: { ok: true }, hermes: { ok: true }, ollama: { ok: true },
  router: { ok: true }, graphify: { ok: true }, obsidian: { ok: true }, cliContinues: { ok: true },
};
const mcpInventory = { servers: [{ name: 'serena', enabled: true, scope: 'project', health: { state: 'not-checked' } }] };

function build(overrides = {}) {
  return buildCurrentWorkflow({
    project, requested: { mode: 'ReadOnly', providerOrder: ['Codex', 'Claude'], codeTask: false },
    jobs: [], components, mcpInventory, git: null, now: new Date('2026-07-14T12:00:00.000Z'), ...overrides,
  });
}

test('idle read-only workflow explains the configured route without inventing Git work', () => {
  const workflow = build();
  assert.equal(workflow.summary.title, 'Workflow bereit');
  assert.equal(workflow.summary.source, 'Aktuelle Arbeitsbereich-Einstellungen');
  assert.equal(workflow.stages.find((entry) => entry.id === 'commit').state, 'not-required');
  assert.equal(workflow.tools.find((entry) => entry.name === 'Serena').state, 'standby');
  assert.equal(workflow.tools.find((entry) => entry.name === 'Graphify').state, 'ready');
});

test('a running write code job overrides the requested form settings and activates its selected tools', () => {
  const workflow = build({
    requested: { mode: 'ReadOnly', providerOrder: ['Ollama'], codeTask: false },
    jobs: [{ id: 'job-1', kind: 'task', projectId: 'demo', status: 'running', mode: 'Write', providerOrder: ['Codex', 'Claude'], selectedProvider: 'Codex', taskPreview: 'Fix API integration test', createdAt: '2026-07-14T11:00:00Z' }],
  });
  assert.equal(workflow.summary.mode, 'Write');
  assert.equal(workflow.summary.title, 'Agent arbeitet');
  assert.equal(workflow.stages.find((entry) => entry.id === 'agent').state, 'active');
  assert.equal(workflow.tools.find((entry) => entry.name === 'Codex').state, 'active');
  assert.equal(workflow.tools.find((entry) => entry.name === 'Serena').state, 'active');
});

test('completed write work with changes pending opens review and then commit', () => {
  const workflow = build({
    jobs: [{ id: 'job-2', kind: 'task', projectId: 'demo', status: 'completed', mode: 'Write', providerOrder: ['Codex'], createdAt: '2026-07-14T11:00:00Z' }],
    git: { deliveryState: 'changes-pending', files: [{ path: 'safe.js' }], integration: {}, ahead: 0, remote: 'configured' },
  });
  assert.equal(workflow.summary.state, 'review');
  assert.equal(workflow.stages.find((entry) => entry.id === 'review').state, 'review');
  assert.equal(workflow.stages.find((entry) => entry.id === 'commit').state, 'ready');
  assert.equal(workflow.stages.find((entry) => entry.id === 'integration').state, 'waiting');
});

test('an integrated but unpublished write workflow makes only push ready', () => {
  const workflow = build({
    jobs: [{ id: 'job-3', kind: 'task', projectId: 'demo', status: 'completed', mode: 'Write', providerOrder: ['Codex'], createdAt: '2026-07-14T11:00:00Z' }],
    git: { deliveryState: 'integrated-unpublished', files: [], integration: { alreadyIntegrated: true }, ahead: 2, remote: 'configured' },
  });
  assert.equal(workflow.stages.find((entry) => entry.id === 'commit').state, 'complete');
  assert.equal(workflow.stages.find((entry) => entry.id === 'integration').state, 'complete');
  assert.equal(workflow.stages.find((entry) => entry.id === 'push').state, 'ready');
});

test('a blocked write execution makes the remaining delivery gates explicitly blocked', () => {
  const workflow = build({
    jobs: [{ id: 'job-4', kind: 'task', projectId: 'demo', status: 'blocked', mode: 'Write', providerOrder: ['Claude'], createdAt: '2026-07-14T11:00:00Z' }],
  });
  assert.equal(workflow.summary.state, 'attention');
  assert.equal(workflow.stages.find((entry) => entry.id === 'review').state, 'attention');
  assert.equal(workflow.stages.find((entry) => entry.id === 'commit').state, 'blocked');
});

test('MCP servers are deduplicated by name and no configuration target enters the projection', () => {
  const workflow = build({
    mcpInventory: { servers: [
      { name: 'serena', scope: 'global', enabled: true, health: { state: 'not-checked' }, target: 'password=must-not-leak' },
      { name: 'serena', scope: 'project', enabled: true, health: { state: 'not-checked' }, target: 'secret=must-not-leak' },
    ] },
  });
  assert.equal(workflow.tools.filter((entry) => entry.name === 'Serena').length, 1);
  assert.equal(workflow.tools.find((entry) => entry.name === 'Serena').scope, 'project');
  assert.doesNotMatch(JSON.stringify(workflow), /must-not-leak|password|secret=/);
});
