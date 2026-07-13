'use strict';

const assert = require('assert');
const { defaultCommitMessage, taskBranchSlug, normalizeProviderOrder, normalizeProviderModels, extractVersion, parseWingetUpgradeOutput, rememberProviderAttempt } = require('../server');

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

const providerJob = {};
rememberProviderAttempt(providerJob, 'AI_EVENT provider=codex state=started attempt=1 model=gpt-');
rememberProviderAttempt(providerJob, '5.6-sol\n');
rememberProviderAttempt(providerJob, 'x'.repeat(600 * 1024));
assert.deepStrictEqual({ provider: providerJob.selectedProvider, model: providerJob.selectedModel }, { provider: 'codex', model: 'gpt-5.6-sol' });

assert.strictEqual(extractVersion('codex-cli 0.114.0'), '0.114.0');
assert.strictEqual(extractVersion('PowerShell 7.6.3'), '7.6.3');
assert.strictEqual(extractVersion('No version here'), null);
const wingetUpdates = parseWingetUpgradeOutput(`
Name             ID                    Version  Verfügbar  Quelle
----------------------------------------------------------------
Git              Git.Git               2.50.0   2.51.0     winget
OpenAI Codex     OpenAI.Codex          0.1.0    0.2.0      winget
`, ['Git.Git']);
assert.deepStrictEqual(wingetUpdates.get('Git.Git'), { currentVersion: '2.50.0', latestVersion: '2.51.0' });
assert.strictEqual(wingetUpdates.has('OpenAI.Codex'), false);

process.stdout.write('TASK_METADATA_TEST_OK\n');
