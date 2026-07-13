'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

function existingFile(candidate, statSync = fs.statSync) {
  if (!candidate) return false;
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function normalizedProbe(result) {
  if (result === true) return { ok: true, text: 'available' };
  if (result === false || !result) return { ok: false, text: 'not available' };
  return {
    ok: result.ok === true,
    text: String(result.text || (result.ok === true ? 'available' : 'not available')),
  };
}

async function resolveGraphifyPython({
  configuredPath = process.env.AI_PROJECT_CONTROL_GRAPHIFY_PYTHON || '',
  localAppData = process.env.LOCALAPPDATA || '',
  isFile = existingFile,
  probe,
} = {}) {
  if (typeof probe !== 'function') throw new TypeError('A Graphify runtime probe is required.');

  const configured = String(configuredPath || '').trim();
  const python312 = localAppData
    ? path.join(String(localAppData), 'Programs', 'Python', 'Python312', 'python.exe')
    : '';
  const candidates = [];
  const seen = new Set();
  const addCandidate = (candidate, requireFile) => {
    if (!candidate || (requireFile && !isFile(candidate))) return;
    const key = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };
  addCandidate(configured, true);
  addCandidate(python312, true);
  addCandidate('python.exe', false);

  const attempts = [];
  for (const command of candidates) {
    let result;
    try {
      result = normalizedProbe(await probe(command));
    } catch (error) {
      result = { ok: false, text: String(error?.message || error || 'not available') };
    }
    attempts.push({ command, ...result });
    if (result.ok) return { command, ...result, attempts };
  }

  return {
    command: candidates[candidates.length - 1] || 'python.exe',
    ok: false,
    text: attempts.map((attempt) => `${attempt.command}: ${attempt.text}`).join(' | ') || 'Graphify runtime not available',
    attempts,
  };
}

async function graphSummary(graphPath, {
  existsSync = fs.existsSync,
  readFile = fsp.readFile,
} = {}) {
  if (!existsSync(graphPath)) {
    return { ok: false, status: 'missing', text: `Graph missing: ${graphPath}`, builtAtCommit: null };
  }
  try {
    const graph = JSON.parse(await readFile(graphPath, 'utf8'));
    return {
      ok: true,
      status: 'ready',
      text: `${graph.nodes?.length || 0} nodes · ${graph.links?.length || 0} links`,
      builtAtCommit: graph.built_at_commit ? String(graph.built_at_commit) : null,
    };
  } catch (error) {
    return { ok: false, status: 'invalid', text: error.message, builtAtCommit: null };
  }
}

function graphFreshness(summary, headCommit) {
  if (!summary?.ok) return summary?.status === 'invalid' ? 'fehlerhaft' : 'fehlt';
  const builtAt = String(summary.builtAtCommit || '');
  const head = String(headCommit || '');
  if (!builtAt || !head) return 'unbekannt';
  if (!head.startsWith(builtAt) && !builtAt.startsWith(head)) return 'veraltet';
  return 'aktuell';
}

module.exports = { resolveGraphifyPython, graphSummary, graphFreshness };
