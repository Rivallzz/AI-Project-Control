'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadBrowserModule } = require('./test-helpers/production-hooks');

function configFixture() {
  const model = (id, provider, displayName = id) => ({
    id, provider, displayName, description: `${displayName} description`, capabilityTags: [], recommendedUseCases: [],
    contextWindow: null, speedClass: 'standard', privacyMode: provider === 'Ollama' ? 'local' : 'subscription',
    localOrRemote: provider === 'Ollama' ? 'local' : 'remote', availability: 'available', deprecated: false,
  });
  return {
    modelCatalog: {
      version: 1,
      providers: {
        Codex: { id: 'Codex', displayName: 'Codex', status: 'available', message: '', defaultModelId: 'default', models: [model('default', 'Codex', 'Codex-Standard'), model('codex-coding', 'Codex')] },
        Claude: { id: 'Claude', displayName: 'Claude Code', status: 'available', message: '', defaultModelId: 'sonnet', models: [model('sonnet', 'Claude'), model('haiku', 'Claude')] },
        Ollama: { id: 'Ollama', displayName: 'Hermes + Ollama', status: 'available', message: '', defaultModelId: 'local-a', models: [model('local-a', 'Ollama')] },
      },
      profiles: {
        balanced: { id: 'balanced', displayName: 'Ausgewogen', description: 'Balanced', modelIds: { Codex: 'default', Claude: 'sonnet', Ollama: 'local-a' } },
        fast: { id: 'fast', displayName: 'Schnell', description: 'Fast', modelIds: { Codex: 'default', Claude: 'haiku', Ollama: 'local-a' } },
      },
    },
  };
}

test('a persisted available model is restored without replacement', async () => {
  const hooks = await loadBrowserModule('public/modules/model-selection.js');
  const selection = hooks.reconcileModelSelection(configFixture(), 'Claude', 'haiku');
  assert.equal(selection.value, 'haiku');
  assert.equal(selection.replaced, false);
});

test('a stale persisted model is replaced by the catalog default and explained', async () => {
  const hooks = await loadBrowserModule('public/modules/model-selection.js');
  const selection = hooks.reconcileModelSelection(configFixture(), 'Claude', 'removed-model');
  assert.equal(selection.value, 'sonnet');
  assert.equal(selection.replaced, true);
  assert.match(selection.message, /nicht mehr verfügbar/);
});

test('an empty provider catalog returns no executable model', async () => {
  const hooks = await loadBrowserModule('public/modules/model-selection.js');
  const config = configFixture();
  config.modelCatalog.providers.Ollama = { ...config.modelCatalog.providers.Ollama, status: 'empty', message: 'Keine lokalen Modelle installiert.', defaultModelId: null, models: [] };
  const selection = hooks.reconcileModelSelection(config, 'Ollama', 'local-a');
  assert.equal(selection.value, '');
  assert.equal(selection.model, null);
  assert.match(selection.message, /Keine lokalen Modelle/);
});

test('a non-empty catalog with only unavailable models still returns no executable model', async () => {
  const hooks = await loadBrowserModule('public/modules/model-selection.js');
  const config = configFixture();
  config.modelCatalog.providers.Ollama = {
    ...config.modelCatalog.providers.Ollama,
    status: 'unavailable',
    message: 'Keine bestätigte Completion-Fähigkeit.',
    defaultModelId: null,
    models: [{ ...config.modelCatalog.providers.Ollama.models[0], availability: 'unavailable' }],
  };
  const selection = hooks.reconcileModelSelection(config, 'Ollama', 'local-a');
  assert.equal(selection.value, '');
  assert.equal(selection.model, null);
  assert.match(selection.message, /Completion-Fähigkeit/);
});

test('profiles resolve to concrete provider model ids', async () => {
  const hooks = await loadBrowserModule('public/modules/model-selection.js');
  assert.deepEqual(hooks.profileSelections(configFixture(), 'fast'), { Codex: 'default', Claude: 'haiku', Ollama: 'local-a' });
});

test('the selected primary provider leads the executable fallback order', async () => {
  const hooks = await loadBrowserModule('public/modules/model-selection.js');
  assert.deepEqual(hooks.primaryFirst(['Codex', 'Claude', 'Ollama'], 'Claude'), ['Claude', 'Codex', 'Ollama']);
  assert.deepEqual(hooks.primaryFirst(['Codex', 'Ollama'], 'Claude'), ['Codex', 'Ollama']);
});

test('task start stays disabled while loading or running and enables for a valid route', async () => {
  const hooks = await loadBrowserModule('public/modules/model-selection.js');
  assert.equal(hooks.taskStartState({ providerOrder: ['Codex'], hasRunningTask: false, catalogReady: false }).disabled, true);
  assert.equal(hooks.taskStartState({ providerOrder: ['Codex'], hasRunningTask: false, catalogReady: true, runtimeReady: false }).disabled, true);
  assert.equal(hooks.taskStartState({ providerOrder: ['Codex'], hasRunningTask: true, catalogReady: true }).disabled, true);
  assert.equal(hooks.taskStartState({ providerOrder: ['Codex'], hasRunningTask: false, catalogReady: true }).disabled, false);
});
