'use strict';

const assert = require('assert');
const { defaultCommitMessage, taskBranchSlug } = require('../server');

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

process.stdout.write('TASK_METADATA_TEST_OK\n');
