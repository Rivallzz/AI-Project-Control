'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadBrowserModule } = require('./test-helpers/production-hooks');

async function graphifyComponentState(graphify) {
  const hooks = await loadBrowserModule('public/modules/component-status.js');
  return hooks.graphifyComponentState(graphify);
}

async function graphifyComponentView(graphify) {
  const hooks = await loadBrowserModule('public/modules/component-status.js');
  return hooks.graphifyComponentView(graphify);
}

test('Graphify is ready only when runtime and index are ready', async () => {
  assert.deepEqual(
    await graphifyComponentState({ runtimeOk: true, indexOk: true }),
    { ok: true, warning: false, label: 'ok' },
  );
});

test('a missing Graphify runtime is a warning when the index is available', async () => {
  assert.deepEqual(
    await graphifyComponentState({ runtimeOk: false, indexOk: true }),
    { ok: false, warning: true, label: 'runtime fehlt' },
  );
});

test('invalid and missing Graphify indexes remain errors', async () => {
  assert.deepEqual(
    await graphifyComponentState({ runtimeOk: true, indexOk: false, indexStatus: 'invalid' }),
    { ok: false, warning: false, label: 'fehlerhaft' },
  );
  assert.deepEqual(
    await graphifyComponentState({ runtimeOk: true, indexOk: false, indexStatus: 'missing' }),
    { ok: false, warning: false, label: 'index fehlt' },
  );
});

test('unknown or incomplete Graphify contracts do not claim the index is missing', async () => {
  for (const graphify of [undefined, null, {}, { runtimeOk: true }, { indexOk: false }, { indexStatus: 'unexpected' }]) {
    assert.deepEqual(
      await graphifyComponentState(graphify),
      { ok: false, warning: true, label: 'unbekannt' },
    );
  }
});

test('the legacy aggregate status remains safely compatible', async () => {
  assert.deepEqual(
    await graphifyComponentState({ ok: true }),
    { ok: true, warning: false, label: 'ok' },
  );
  assert.deepEqual(
    await graphifyComponentState({ ok: false }),
    { ok: false, warning: true, label: 'unbekannt' },
  );
});

test('the Graphify view preserves a delivered diagnostic detail', async () => {
  assert.deepEqual(
    await graphifyComponentView({ runtimeOk: false, indexOk: true, text: 'Runtime nicht verfügbar · Index lesbar' }),
    { ok: false, warning: true, label: 'runtime fehlt', detail: 'Runtime nicht verfügbar · Index lesbar' },
  );
});

test('the Graphify view safely explains a missing object or detail', async () => {
  const fallback = 'Graphify-Details nicht verfügbar.';
  assert.deepEqual(
    await graphifyComponentView(undefined),
    { ok: false, warning: true, label: 'unbekannt', detail: fallback },
  );
  assert.deepEqual(
    await graphifyComponentView({ runtimeOk: true, indexOk: true }),
    { ok: true, warning: false, label: 'ok', detail: fallback },
  );
  assert.deepEqual(
    await graphifyComponentView({ runtimeOk: false, indexOk: true, text: '   ' }),
    { ok: false, warning: true, label: 'runtime fehlt', detail: fallback },
  );
});
