'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadUiStateHooks } = require('./test-helpers/production-hooks');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('a slower response from the previous project cannot overwrite the new project', async (t) => {
  const hooks = await loadUiStateHooks();
  if (typeof hooks?.createRequestState !== 'function') {
    t.skip('Required production hook: public/modules/request-state.js#createRequestState');
    return;
  }
  let activeProjectId = 'project-a';
  const requestState = hooks.createRequestState(() => activeProjectId);
  const oldResponse = deferred();
  const newResponse = deferred();
  const applied = [];

  const oldToken = requestState.begin('git', 'project-a');
  const oldRequest = oldResponse.promise.then((value) => { if (requestState.isCurrent(oldToken)) applied.push(value); });
  activeProjectId = 'project-b';
  requestState.invalidateProject();
  const newToken = requestState.begin('git', 'project-b');
  const newRequest = newResponse.promise.then((value) => { if (requestState.isCurrent(newToken)) applied.push(value); });

  newResponse.resolve('project-b');
  await newRequest;
  oldResponse.resolve('project-a');
  await oldRequest;

  assert.deepEqual(applied, ['project-b']);
});

test('starting another request for the same project also invalidates an older response', async (t) => {
  const hooks = await loadUiStateHooks();
  if (typeof hooks?.createRequestState !== 'function') {
    t.skip('Required production hook: public/modules/request-state.js#createRequestState');
    return;
  }
  const requestState = hooks.createRequestState(() => 'project-a');
  const first = requestState.begin('git', 'project-a');
  const second = requestState.begin('git', 'project-a');
  assert.equal(requestState.isCurrent(first), false);
  assert.equal(requestState.isCurrent(second), true);
});
