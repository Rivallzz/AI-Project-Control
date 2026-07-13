'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { resolveGraphifyPython, graphSummary, graphFreshness } = require('../lib/knowledge/graphify');

test('Graphify selects the first existing interpreter whose module probe succeeds', async () => {
  const configured = path.join('C:\\', 'tools', 'graphify-python.exe');
  const localAppData = path.join('C:\\', 'Users', 'Operator', 'AppData', 'Local');
  const python312 = path.join(localAppData, 'Programs', 'Python', 'Python312', 'python.exe');
  const probes = [];
  const resolved = await resolveGraphifyPython({
    configuredPath: configured,
    localAppData,
    isFile: (candidate) => candidate === configured || candidate === python312,
    probe: async (candidate) => {
      probes.push(candidate);
      return { ok: candidate === python312, text: candidate === python312 ? 'graphify 0.9.10' : 'No module named graphify' };
    },
  });

  assert.equal(resolved.command, python312);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.text, 'graphify 0.9.10');
  assert.deepEqual(probes, [configured, python312]);
});

test('Graphify keeps probing through the PATH candidate when owned interpreters lack the module', async () => {
  const configured = path.join('C:\\', 'tools', 'configured-python.exe');
  const localAppData = path.join('C:\\', 'Users', 'Operator', 'AppData', 'Local');
  const python312 = path.join(localAppData, 'Programs', 'Python', 'Python312', 'python.exe');
  const probes = [];
  const resolved = await resolveGraphifyPython({
    configuredPath: configured,
    localAppData,
    isFile: () => true,
    probe: async (candidate) => {
      probes.push(candidate);
      return { ok: candidate === 'python.exe', text: candidate === 'python.exe' ? 'graphify on PATH' : 'No module named graphify' };
    },
  });

  assert.equal(resolved.command, 'python.exe');
  assert.equal(resolved.ok, true);
  assert.deepEqual(probes, [configured, python312, 'python.exe']);
});

test('Graphify reports every failed candidate when no runtime is usable', async () => {
  const resolved = await resolveGraphifyPython({
    configuredPath: path.join('C:\\', 'missing', 'python.exe'),
    localAppData: '',
    isFile: () => false,
    probe: async () => ({ ok: false, text: 'not found' }),
  });

  assert.equal(resolved.command, 'python.exe');
  assert.equal(resolved.ok, false);
  assert.match(resolved.text, /python\.exe: not found/);
});

test('Graphify index summary keeps readability and commit freshness separate', async () => {
  const currentCommit = '1234567890abcdef1234567890abcdef12345678';
  const ready = await graphSummary('graph.json', {
    existsSync: () => true,
    readFile: async () => JSON.stringify({ nodes: [{ id: 'one' }], links: [], built_at_commit: currentCommit }),
  });
  assert.deepEqual(ready, {
    ok: true,
    status: 'ready',
    text: '1 nodes · 0 links',
    builtAtCommit: currentCommit,
  });
  assert.equal(graphFreshness(ready, currentCommit), 'aktuell');
  assert.equal(graphFreshness(ready, 'abcdefabcdefabcdefabcdefabcdefabcdefabcd'), 'veraltet');
  assert.equal(graphFreshness({ ...ready, builtAtCommit: null }, currentCommit), 'unbekannt');
  assert.equal(graphFreshness(ready, ''), 'unbekannt');

  const invalid = await graphSummary('graph.json', {
    existsSync: () => true,
    readFile: async () => '{"nodes":',
  });
  assert.equal(invalid.status, 'invalid');
  assert.equal(graphFreshness(invalid, currentCommit), 'fehlerhaft');

  const missing = await graphSummary('graph.json', { existsSync: () => false });
  assert.equal(missing.status, 'missing');
  assert.equal(graphFreshness(missing, currentCommit), 'fehlt');
});
