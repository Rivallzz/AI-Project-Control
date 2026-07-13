'use strict';

const fs = require('fs');

function firstOutputLine(result) {
  return String(result?.stdout || result?.stderr || result?.error || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || 'nicht verfügbar';
}

function pythonPathsFromLauncher(value) {
  return String(value || '').split(/\r?\n/).map((line) => {
    const match = line.match(/([A-Za-z]:\\.*?python(?:\.exe)?)\s*$/i);
    return match?.[1] || null;
  }).filter(Boolean);
}

function executablePaths(value) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function createGraphifyRuntimeResolver({
  configuredPython = '',
  execFileAsync,
  existsSync = fs.existsSync,
  platform = process.platform,
  cacheTtlMs = 60000,
  now = Date.now,
} = {}) {
  if (typeof execFileAsync !== 'function') throw new Error('Graphify runtime resolution requires execFileAsync.');
  let cached = null;
  let cachedAt = 0;

  async function probe(command) {
    const result = await execFileAsync(command, ['-m', 'graphify', '--version'], { timeout: 15000 });
    return {
      ok: result.exitCode === 0,
      command,
      argsPrefix: ['-m', 'graphify'],
      text: firstOutputLine(result),
    };
  }

  return async function resolveGraphifyRuntime(force = false) {
    if (!force && cached && now() - cachedAt < cacheTtlMs) return cached;
    const configured = String(configuredPython || '').trim();
    if (configured) {
      cached = existsSync(configured)
        ? await probe(configured)
        : { ok: false, command: configured, argsPrefix: ['-m', 'graphify'], text: `Konfiguriertes Graphify-Python wurde nicht gefunden: ${configured}` };
      cachedAt = now();
      return cached;
    }

    const commands = [];
    const seen = new Set();
    const add = (command) => {
      const value = String(command || '').trim();
      const key = platform === 'win32' ? value.toLowerCase() : value;
      if (value && !seen.has(key)) { seen.add(key); commands.push(value); }
    };
    add(platform === 'win32' ? 'python.exe' : 'python3');
    if (platform !== 'win32') add('python');

    let firstFailure = null;
    const primary = await probe(commands[0]);
    if (primary.ok) {
      cached = primary; cachedAt = now(); return cached;
    }
    firstFailure = primary;

    if (platform === 'win32') {
      const [launcher, located] = await Promise.all([
        execFileAsync('py.exe', ['-0p'], { timeout: 15000 }),
        execFileAsync('where.exe', ['python.exe'], { timeout: 15000 }),
      ]);
      if (launcher.exitCode === 0) pythonPathsFromLauncher(launcher.stdout).forEach(add);
      if (located.exitCode === 0) executablePaths(located.stdout).forEach(add);
    }

    for (const command of commands.slice(1)) {
      const result = await probe(command);
      if (result.ok) {
        cached = result; cachedAt = now(); return cached;
      }
    }

    cached = {
      ok: false,
      command: commands[0],
      argsPrefix: ['-m', 'graphify'],
      text: `Graphify wurde in keiner erkannten Python-Laufzeit gefunden. ${firstFailure.text}`,
    };
    cachedAt = now();
    return cached;
  };
}

module.exports = { createGraphifyRuntimeResolver, executablePaths, pythonPathsFromLauncher };
