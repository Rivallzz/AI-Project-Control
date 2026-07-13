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
