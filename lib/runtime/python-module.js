'use strict';

/**
 * @param {{ configuredCommand?: string, commandExists?: (candidate: string) => boolean, platform?: string }} [options]
 */
function pythonModuleCandidates(options) {
  options ||= {};
  const { configuredCommand = '', commandExists = (_candidate) => false, platform = process.platform } = options;
  const configured = String(configuredCommand || '').trim();
  if (configured && commandExists(configured)) return [configured];
  return platform === 'win32' ? ['py.exe', 'python.exe'] : ['python3', 'python'];
}

/**
 * @param {{
 *   moduleName?: string,
 *   configuredCommand?: string,
 *   commandExists?: (candidate: string) => boolean,
 *   platform?: string,
 *   summarize?: (command: string, args: string[]) => Promise<{ ok?: boolean, text?: string }> | { ok?: boolean, text?: string },
 * }} [options]
 */
async function resolvePythonModuleRuntime(options) {
  options ||= {};
  const {
    moduleName,
    configuredCommand = '',
    commandExists = (_candidate) => false,
    platform = process.platform,
    summarize,
  } = options;
  const normalizedModule = String(moduleName || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(normalizedModule)) throw new Error('A valid Python module name is required.');
  if (typeof summarize !== 'function') throw new Error('A Python module summarizer is required.');

  const candidates = pythonModuleCandidates({ configuredCommand, commandExists, platform });
  let last = { command: candidates[candidates.length - 1], ok: false, text: 'not available' };
  for (const command of candidates) {
    try {
      const summary = await summarize(command, ['-m', normalizedModule, '--version']);
      last = {
        command,
        ok: Boolean(summary?.ok),
        text: String(summary?.text || 'not available'),
      };
    } catch (error) {
      last = { command, ok: false, text: String(error?.message || error || 'not available') };
    }
    if (last.ok) return last;
  }
  return last;
}

module.exports = { pythonModuleCandidates, resolvePythonModuleRuntime };
