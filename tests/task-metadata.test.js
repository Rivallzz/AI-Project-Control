'use strict';

const assert = require('assert');
const { defaultCommitMessage, taskBranchSlug, normalizeProviderOrder, normalizeProviderModels } = require('../server');

assert.strictEqual(
  taskBranchSlug('Die durch den Chat erstellten Branches haben schlechte Titel. Commit-Nachrichten sollen pro Branch gespeichert werden.'),
  'improve-branch-names-commit-drafts',
);
assert.strictEqual(
  defaultCommitMessage('Die durch den Chat erstellten Branches haben schlechte Titel. Commit-Nachrichten sollen pro Branch gespeichert werden.'),
  'Improve branch names commit drafts',
);
assert.strictEqual(taskBranchSlug('Der Live-Feed funktioniert nicht und zeigt Fehler.'), 'fix-live-progress');
assert.strictEqual(taskBranchSlug('Okay, bitte überarbeiten.'), 'improve');

assert.deepStrictEqual(normalizeProviderOrder(['Claude', 'Codex', 'Ollama']), ['Claude', 'Codex', 'Ollama']);
assert.deepStrictEqual(normalizeProviderOrder(null, 'Auto'), ['Codex', 'Claude', 'Ollama']);
assert.throws(() => normalizeProviderOrder(['Codex', 'Unknown']), /Unknown provider/);
assert.deepStrictEqual(normalizeProviderModels({ Codex: 'gpt-5.6-sol', Claude: 'opus', Ollama: 'polis-coder:latest' }), {
  Codex: 'gpt-5.6-sol', Claude: 'opus', Ollama: 'polis-coder:latest',
});
assert.throws(() => normalizeProviderModels({ Codex: 'bad model' }), /Invalid model/);

process.stdout.write('TASK_METADATA_TEST_OK\n');
