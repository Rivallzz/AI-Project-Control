'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createGraphifyRuntimeResolver, pythonPathsFromLauncher } = require('../lib/integrations/graphify-runtime');

test('Python launcher output exposes every concrete interpreter path', () => {
  assert.deepEqual(pythonPathsFromLauncher([
    ' -V:3.12 *        C:\\Python 312\\python.exe',
    ' -V:Astral/CPython3.11 C:\\uv\\python.exe',
  ].join('\r\n')), ['C:\\Python 312\\python.exe', 'C:\\uv\\python.exe']);
});

test('Graphify runtime resolution escapes a PATH Python that lacks the module', async () => {
  const calls = [];
  const execFileAsync = async (file, args) => {
    calls.push([file, ...args]);
    if (file === 'python.exe') return { exitCode: 1, stdout: '', stderr: 'No module named graphify' };
    if (file === 'py.exe') return { exitCode: 0, stdout: ' -V:3.12 * C:\\Python312\\python.exe\r\n', stderr: '' };
    if (file === 'where.exe') return { exitCode: 0, stdout: 'C:\\Hermes\\python.exe\r\nC:\\Python312\\python.exe\r\n', stderr: '' };
    if (file === 'C:\\Python312\\python.exe') return { exitCode: 0, stdout: 'graphify 0.9.10', stderr: '' };
    return { exitCode: 1, stdout: '', stderr: 'unavailable' };
  };
  const resolveRuntime = createGraphifyRuntimeResolver({ execFileAsync, platform: 'win32' });

  const runtime = await resolveRuntime();

  assert.equal(runtime.ok, true);
  assert.equal(runtime.command, 'C:\\Python312\\python.exe');
  assert.deepEqual(runtime.argsPrefix, ['-m', 'graphify']);
  assert.equal(runtime.text, 'graphify 0.9.10');
  assert.equal(calls.some((call) => call[0] === 'py.exe' && call[1] === '-0p'), true);
});

test('an explicit missing Graphify Python fails closed without probing unrelated runtimes', async () => {
  let calls = 0;
  const resolveRuntime = createGraphifyRuntimeResolver({
    configuredPython: 'C:\\missing\\python.exe',
    existsSync: () => false,
    execFileAsync: async () => { calls += 1; return { exitCode: 0, stdout: 'unexpected', stderr: '' }; },
    platform: 'win32',
  });

  const runtime = await resolveRuntime();

  assert.equal(runtime.ok, false);
  assert.match(runtime.text, /Konfiguriertes Graphify-Python wurde nicht gefunden/);
  assert.equal(calls, 0);
});
