'use strict';

const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const SERVER_PATH = path.join(REPOSITORY_ROOT, 'server.js');
const TEST_ROOT_PREFIX = 'ai-project-control-node-test-';

function executablePath(name) {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  const output = execFileSync(locator, [name], { encoding: 'utf8' });
  return output.split(/\r?\n/).find(Boolean);
}

function isolatedPath() {
  const entries = [path.dirname(executablePath(process.platform === 'win32' ? 'git.exe' : 'git'))];
  if (process.platform === 'win32') {
    entries.push(path.join(process.env.SystemRoot, 'System32'), process.env.SystemRoot);
  } else {
    entries.push('/usr/bin', '/bin');
  }
  return [...new Set(entries.filter(Boolean))].join(path.delimiter);
}

async function createSandbox() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), TEST_ROOT_PREFIX));
  await Promise.all([
    fs.mkdir(path.join(root, 'home'), { recursive: true }),
    fs.mkdir(path.join(root, 'temp'), { recursive: true }),
  ]);
  return root;
}

function assertTestRoot(root) {
  const relative = path.relative(os.tmpdir(), path.resolve(root));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(root).startsWith(TEST_ROOT_PREFIX)) {
    throw new Error(`Refusing to remove non-test directory: ${root}`);
  }
}

async function removeSandbox(root) {
  assertTestRoot(root);
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function reservePort(host = '127.0.0.1') {
  const socket = net.createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, host, resolve);
  });
  const { port } = socket.address();
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function startServer({ root, port, extraEnv = {} } = {}) {
  if (!root) throw new Error('startServer requires a sandbox root.');
  const selectedPort = port ?? await reservePort();
  const home = path.join(root, 'home');
  const temp = path.join(root, 'temp');
  const dataRoot = path.join(root, 'data');
  const runRoot = path.join(root, 'runs');
  const worktreeRoot = path.join(root, 'worktrees');
  const obsidianVault = path.join(root, 'obsidian');
  let stdout = '';
  let stderr = '';

  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: REPOSITORY_ROOT,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PATH: isolatedPath(),
      HOME: home,
      USERPROFILE: home,
      LOCALAPPDATA: path.join(root, 'local-app-data'),
      APPDATA: path.join(root, 'app-data'),
      TEMP: temp,
      TMP: temp,
      OPENAI_API_KEY: '',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_BASE_URL: '',
      AI_PROJECT_CONTROL_HOST: '127.0.0.1',
      AI_PROJECT_CONTROL_PORT: String(selectedPort),
      AI_PROJECT_CONTROL_DATA: dataRoot,
      AI_PROJECT_CONTROL_RUN_ROOT: runRoot,
      AI_PROJECT_CONTROL_WORKTREE_ROOT: worktreeRoot,
      AI_PROJECT_CONTROL_OBSIDIAN_VAULT: obsidianVault,
      AI_PROJECT_CONTROL_ECC_ROOT: path.join(root, 'missing-ecc'),
      AI_PROJECT_CONTROL_GRAPHIFY_PYTHON: path.join(root, 'disabled-graphify.exe'),
      AI_PROJECT_CONTROL_SKIP_UPDATE_CHECKS: '1',
      ...extraEnv,
    },
  });

  child.stdout.on('data', (chunk) => { stdout = (stdout + chunk.toString('utf8')).slice(-100000); });
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString('utf8')).slice(-100000); });

  const baseUrl = `http://127.0.0.1:${selectedPort}`;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited during startup (${child.exitCode}).\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) {
        return {
          baseUrl,
          child,
          dataRoot,
          port: selectedPort,
          root,
          runRoot,
          worktreeRoot,
          logs: () => ({ stdout, stderr }),
          stop: async () => stopServer(child),
        };
      }
    } catch {}
    await delay(50);
  }

  await stopServer(child);
  throw new Error(`Server did not become ready at ${baseUrl}.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exitPromise = new Promise((resolve) => child.once('exit', () => resolve(true)));
  child.kill('SIGTERM');
  const exited = await Promise.race([
    exitPromise,
    delay(5000).then(() => false),
  ]);
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await new Promise((resolve) => child.once('exit', resolve));
  }
}

module.exports = {
  REPOSITORY_ROOT,
  createSandbox,
  removeSandbox,
  reservePort,
  startServer,
};
