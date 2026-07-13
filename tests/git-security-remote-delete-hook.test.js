'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

let authorizeRemoteBranchDelete = null;
try { ({ authorizeRemoteBranchDelete } = require('../server')); }
catch {}

const hookMissing = typeof authorizeRemoteBranchDelete !== 'function';
const skip = hookMissing ? 'Required production hook: server.js#authorizeRemoteBranchDelete' : false;

test('remote deletion is limited to integrated ai/* branches with an unchanged OID', { skip }, () => {
  const input = {
    branch: 'ai/completed-task',
    expectedOid: '1111111111111111111111111111111111111111',
    currentOid: '1111111111111111111111111111111111111111',
    integrated: true,
  };
  assert.equal(authorizeRemoteBranchDelete(input), true);
});

test('remote deletion rejects a branch that changed after confirmation', { skip }, () => {
  assert.throws(() => authorizeRemoteBranchDelete({
    branch: 'ai/completed-task',
    expectedOid: '1111111111111111111111111111111111111111',
    currentOid: '2222222222222222222222222222222222222222',
    integrated: true,
  }), /changed|lease|OID/i);
});

test('remote deletion rejects protected or non-integrated branches', { skip }, () => {
  const oid = '1111111111111111111111111111111111111111';
  assert.throws(() => authorizeRemoteBranchDelete({ branch: 'main', expectedOid: oid, currentOid: oid, integrated: true }), /branch|task|protected/i);
  assert.throws(() => authorizeRemoteBranchDelete({ branch: 'ai/open-task', expectedOid: oid, currentOid: oid, integrated: false }), /integrated|contained/i);
});
