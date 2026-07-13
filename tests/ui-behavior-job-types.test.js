'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadUiStateHooks } = require('./test-helpers/production-hooks');

test('the active project conversation accepts every supported job kind', async (t) => {
  const hooks = await loadUiStateHooks();
  if (typeof hooks?.jobBelongsInConversation !== 'function') {
    t.skip('Required production hook: public/modules/project-ui-state.js#jobBelongsInConversation');
    return;
  }
  for (const kind of ['task', 'install', 'update', 'provision', 'dashboard-command']) {
    assert.equal(
      hooks.jobBelongsInConversation({ id: kind, kind, projectId: 'project-a' }, 'project-a'),
      true,
      `${kind} must be visible in the active project conversation`,
    );
  }
});

test('jobs from another project cannot leak into the active conversation', async (t) => {
  const hooks = await loadUiStateHooks();
  if (typeof hooks?.jobBelongsInConversation !== 'function') {
    t.skip('Required production hook: public/modules/project-ui-state.js#jobBelongsInConversation');
    return;
  }
  assert.equal(
    hooks.jobBelongsInConversation({ id: 'other', kind: 'update', projectId: 'project-b' }, 'project-a'),
    false,
  );
});

test('a live job wins over its not-yet-complete run directory', async (t) => {
  const hooks = await loadUiStateHooks();
  if (typeof hooks?.reconcileConversationSources !== 'function') {
    t.skip('Required production hook: public/modules/project-ui-state.js#reconcileConversationSources');
    return;
  }
  const run = { path: 'C:\\Runs\\one', status: 'external' };
  const job = { id: 'job-one', runDirectory: 'c:/runs/one', status: 'running' };
  const visible = hooks.reconcileConversationSources([run], [job]);
  assert.deepEqual(visible.runs, []);
  assert.deepEqual(visible.jobs, [job]);
});

test('a completed run replaces its duplicate job record', async (t) => {
  const hooks = await loadUiStateHooks();
  if (typeof hooks?.reconcileConversationSources !== 'function') {
    t.skip('Required production hook: public/modules/project-ui-state.js#reconcileConversationSources');
    return;
  }
  const run = { path: 'C:\\Runs\\one', status: 'PASS' };
  const job = { id: 'job-one', runDirectory: 'C:\\Runs\\one', status: 'completed' };
  const visible = hooks.reconcileConversationSources([run], [job]);
  assert.deepEqual(visible.runs, [run]);
  assert.deepEqual(visible.jobs, []);
});

test('an orphaned external run is explicit and never presented as active work', async (t) => {
  const hooks = await loadUiStateHooks();
  if (typeof hooks?.runStatusPresentation !== 'function') {
    t.skip('Required production hook: public/modules/project-ui-state.js#runStatusPresentation');
    return;
  }
  const presentation = hooks.runStatusPresentation('external');
  assert.equal(presentation.label, 'unvollständig');
  assert.equal(presentation.className, 'warn');
  assert.match(presentation.fallback, /keine laufende Arbeit/i);
});
