'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  PROVIDER_NAMES,
  buildModelCatalog,
  validateModelSelections,
} = require('../lib/providers/model-catalog');

function ollamaShow(capabilities = ['completion'], contextWindow = 32768) {
  return {
    exitCode: 0,
    stdout: [
      '  Model',
      `    context length      ${contextWindow}`,
      '',
      '  Capabilities',
      ...capabilities.map((capability) => `    ${capability}`),
      '',
      '  Parameters',
    ].join('\n'),
    stderr: '',
  };
}

function fixtureCatalog(overrides = {}) {
  return buildModelCatalog({
    configuredCodexModel: 'codex-quality',
    codexCache: {
      models: [
        {
          slug: 'codex-quality', display_name: 'Codex Quality', visibility: 'list',
          description: 'Agentic coding model for complex work.', default_reasoning_level: 'high',
          supported_reasoning_levels: [{ effort: 'medium' }, { effort: 'high' }],
          context_window: 200000, priority: 1, shell_type: 'shell_command',
        },
        {
          slug: 'codex-fast', display_name: 'Codex Fast', visibility: 'list',
          description: 'Fast helper for focused tasks.', default_reasoning_level: 'medium',
          context_window: 100000, priority: 2,
        },
      ],
    },
    ollamaResult: {
      exitCode: 0,
      stdout: 'NAME ID SIZE MODIFIED\nalpha:latest 111 4 GB now\nbeta:latest 222 8 GB now\n',
      stderr: '',
    },
    ollamaShowResults: {
      'alpha:latest': ollamaShow(['completion', 'tools']),
      'beta:latest': ollamaShow(),
    },
    ...overrides,
  });
}

test('buildModelCatalog exposes the versioned provider contract and reviewed Claude aliases', () => {
  const catalog = fixtureCatalog();
  assert.deepEqual(PROVIDER_NAMES, ['Codex', 'Claude', 'Ollama']);
  assert.equal(catalog.version, 1);
  assert.deepEqual(Object.keys(catalog.providers), PROVIDER_NAMES);
  assert.equal(catalog.providers.Claude.status, 'available');
  assert.equal(catalog.providers.Claude.defaultModelId, 'default');
  assert.deepEqual(catalog.providers.Claude.models.map((model) => model.id), ['default', 'sonnet', 'opus', 'haiku']);
  assert.equal(catalog.profiles.balanced.modelIds.Claude, 'sonnet');
  assert.equal(catalog.profiles.fast.modelIds.Claude, 'haiku');
  assert.equal(catalog.profiles.quality.modelIds.Claude, 'opus');
  assert.equal(catalog.profiles.coding.modelIds.Claude, 'sonnet');
});

test('Codex cache metadata drives dedupe, defaults, capabilities, context, priority and profiles', () => {
  const catalog = buildModelCatalog({
    configuredCodexModel: 'CODEX-QUALITY',
    codexCache: JSON.stringify({
      models: [
        {
          slug: 'codex-quality', display_name: 'Codex Quality', visibility: 'list',
          description: 'Frontier agentic coding model.', default_reasoning_level: 'high',
          supported_reasoning_levels: [{ effort: 'high' }], context_window: 250000,
          priority: 1, shell_type: 'shell_command',
        },
        {
          slug: 'CODEX-QUALITY', display_name: 'Duplicate', visibility: 'list',
          description: 'Lower-priority duplicate.', priority: 9,
        },
        {
          slug: 'codex-speed', display_name: 'Codex Speed', visibility: 'list',
          description: 'Ultra-fast helper for bounded work.', priority: 2,
        },
        { slug: 'hidden-review', display_name: 'Hidden', visibility: 'hide', description: 'coding model', priority: 0 },
      ],
    }),
    ollamaResult: { exitCode: 0, stdout: 'NAME ID\nlocal:latest 1\n' },
    ollamaShowResults: { 'local:latest': ollamaShow() },
  });
  const codex = catalog.providers.Codex;
  assert.equal(codex.status, 'available');
  assert.equal(codex.defaultModelId, 'default');
  assert.deepEqual(codex.models.map((model) => model.id), ['default', 'codex-quality', 'codex-speed']);
  assert.equal(codex.models[0].resolvedModelId, 'codex-quality');

  const quality = codex.models.find((model) => model.id === 'codex-quality');
  assert.equal(quality.description, 'Frontier agentic coding model.');
  assert.equal(quality.contextWindow, 250000);
  assert.equal(quality.priority, 1);
  assert(quality.capabilityTags.includes('coding'));
  assert(quality.capabilityTags.includes('reasoning'));
  assert(quality.capabilityTags.includes('long-context'));
  assert(quality.capabilityTags.includes('tools'));
  assert.equal(catalog.profiles.balanced.modelIds.Codex, 'codex-quality');
  assert.equal(catalog.profiles.fast.modelIds.Codex, 'codex-speed');
  assert.equal(catalog.profiles.quality.modelIds.Codex, 'codex-quality');
  assert.equal(catalog.profiles.coding.modelIds.Codex, 'codex-quality');
});

test('Ollama parsing uses reported capabilities, deduplicates case-insensitively and sorts deterministically', () => {
  const catalog = buildModelCatalog({
    ollamaResult: {
      exitCode: 0,
      stdout: [
        'NAME                       ID     SIZE',
        'Zulu:latest                1      8 GB',
        'coder-fast:latest          2      4 GB',
        'alpha:latest               3      4 GB',
        'zulu:latest                4      8 GB',
        'nomic-embed-text:latest    5      1 GB',
        'semantic-vector:latest     6      1 GB',
      ].join('\n'),
    },
    ollamaShowResults: {
      'Zulu:latest': ollamaShow(),
      'coder-fast:latest': ollamaShow(['completion', 'tools'], 64000),
      'alpha:latest': ollamaShow(),
      'nomic-embed-text:latest': ollamaShow(['completion']),
      'semantic-vector:latest': ollamaShow(['embedding']),
    },
  });
  const ollama = catalog.providers.Ollama;
  assert.equal(ollama.status, 'available');
  assert.equal(ollama.defaultModelId, 'alpha:latest');
  assert.deepEqual(
    ollama.models.filter((model) => model.availability === 'available').map((model) => model.id.toLowerCase()),
    ['alpha:latest', 'coder-fast:latest', 'nomic-embed-text:latest', 'zulu:latest'],
  );

  const misleadingName = ollama.models.find((model) => model.id === 'coder-fast:latest');
  assert.deepEqual(misleadingName.capabilityTags, ['local', 'privacy', 'completion', 'tools']);
  assert.deepEqual(misleadingName.recommendedUseCases, ['Lokale, datenschutzorientierte Verarbeitung']);
  assert.equal(misleadingName.speedClass, 'unknown');
  assert.equal(misleadingName.contextWindow, 64000);
  assert.equal(misleadingName.privacyMode, 'local-private');
  assert.equal(misleadingName.localOrRemote, 'local');
  assert.equal(ollama.models.find((model) => model.id === 'nomic-embed-text:latest').availability, 'available');
  assert.equal(ollama.models.find((model) => model.id === 'semantic-vector:latest').availability, 'unavailable');
  assert.equal(catalog.profiles.fast.modelIds.Ollama, null);
  assert.equal(catalog.profiles.coding.modelIds.Ollama, null);
});

test('provider status distinguishes discovery errors from an empty chat-model catalog', () => {
  const failed = buildModelCatalog({ ollamaResult: { exitCode: 1, stdout: '', stderr: 'service offline' } });
  assert.equal(failed.providers.Ollama.status, 'error');
  assert.match(failed.providers.Ollama.message, /service offline/);
  assert.equal(failed.providers.Ollama.defaultModelId, null);
  assert.deepEqual(failed.providers.Ollama.models, []);

  const embeddingsOnly = buildModelCatalog({
    ollamaResult: { exitCode: 0, stdout: 'NAME ID\nsemantic-vector:latest 1\n' },
    ollamaShowResults: { 'semantic-vector:latest': ollamaShow(['embedding']) },
  });
  assert.equal(embeddingsOnly.providers.Ollama.status, 'unavailable');
  assert.match(embeddingsOnly.providers.Ollama.message, /bestätigte Completion-Fähigkeit/);
  assert.equal(embeddingsOnly.providers.Ollama.defaultModelId, null);

  const malformedCodex = buildModelCatalog({ codexCache: '{broken', ollamaResult: { exitCode: 1 } });
  assert.equal(malformedCodex.providers.Codex.status, 'available');
  assert.equal(malformedCodex.providers.Codex.defaultModelId, 'default');
  assert.match(malformedCodex.providers.Codex.message, /Codex-Standard bleibt verfügbar/);
  assert.equal(malformedCodex.profiles.fast.modelIds.Codex, null);
  assert.equal(malformedCodex.profiles.quality.modelIds.Codex, null);
  assert.equal(malformedCodex.profiles.coding.modelIds.Codex, null);
});

test('validateModelSelections resolves active IDs canonically and normalizes inactive providers', () => {
  const catalog = fixtureCatalog();
  const selected = validateModelSelections(
    { Codex: 'CODEX-QUALITY', Claude: 'opus', Ollama: 'default' },
    ['Ollama', 'Codex'],
    catalog,
  );
  assert.deepEqual(selected, {
    Codex: 'codex-quality',
    Claude: 'default',
    Ollama: 'alpha:latest',
  });

  const cloudOnly = validateModelSelections(
    { Codex: 'default', Claude: 'sonnet', Ollama: 'not installed' },
    ['Codex', 'Claude'],
    catalog,
  );
  assert.deepEqual(cloudOnly, { Codex: 'default', Claude: 'sonnet', Ollama: 'alpha:latest' });
});

test('validateModelSelections rejects unknown, unavailable and deprecated active selections with German errors', () => {
  const catalog = fixtureCatalog();
  assert.throws(
    () => validateModelSelections({ Codex: 'fantasy-model' }, ['Codex'], catalog),
    (error) => error.code === 'INVALID_MODEL_SELECTION' && error.statusCode === 400
      && /nicht verfügbar/.test(error.message) && /fantasy-model/.test(error.message),
  );

  const noLocalModels = fixtureCatalog({
    ollamaResult: { exitCode: 0, stdout: 'NAME ID\nsemantic-vector:latest 1\n' },
    ollamaShowResults: { 'semantic-vector:latest': ollamaShow(['embedding']) },
  });
  assert.throws(
    () => validateModelSelections({ Ollama: 'default' }, ['Ollama'], noLocalModels),
    /Hermes \+ Ollama ist nicht verfügbar/,
  );

  const deprecated = buildModelCatalog({
    configuredCodexModel: 'old-model',
    codexCache: {
      models: [
        {
          slug: 'old-model', display_name: 'Old', visibility: 'list', description: 'Legacy model.',
          deprecated: true, priority: 1,
        },
        {
          slug: 'current-model', display_name: 'Current', visibility: 'list', description: 'Current model.',
          priority: 2,
        },
      ],
    },
    ollamaResult: { exitCode: 1 },
  });
  assert.throws(
    () => validateModelSelections({ Codex: 'old-model' }, ['Codex'], deprecated),
    /veraltet und nicht mehr auswählbar/,
  );
});

test('quality profiles keep the provider default when Codex metadata has no reasoning evidence', () => {
  const catalog = buildModelCatalog({
    codexCache: {
      models: [{
        slug: 'priority-only', display_name: 'Priority Only', visibility: 'list',
        description: 'General helper.', priority: 0,
      }],
    },
    ollamaResult: { exitCode: 1 },
  });
  assert.equal(catalog.profiles.quality.modelIds.Codex, null);
});

test('validateModelSelections rejects malformed routes and catalog contracts', () => {
  const catalog = fixtureCatalog();
  assert.throws(() => validateModelSelections({}, ['Unknown'], catalog), /Unbekannter Provider/);
  assert.throws(() => validateModelSelections({}, ['Codex', 'Codex'], catalog), /mehrfach/);
  assert.throws(() => validateModelSelections({}, 'Codex', catalog), /Providerreihenfolge/);
  assert.throws(() => validateModelSelections({}, ['Codex'], { version: 2 }), /Modellkatalog/);
});
