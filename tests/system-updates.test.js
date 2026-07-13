'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  CATALOG_SCHEMA_VERSION,
  normalizeCatalog,
  getCatalogBinding,
  buildMaintenancePlan,
  sameGitRemote,
  parseSemver,
  compareSemver,
  semverDirection,
  greatestSemver,
  extractSemver,
  parseWingetUpgradeOutput,
  parseNpmVersionOutput,
  parseGitAheadBehind,
  classifyGitRelation,
  checkGitPackage,
  checkCatalogUpdates,
  catalogFingerprint,
  packageFingerprint,
  createUpdateCache,
  authorizeSystemUpdate,
  consumeSystemUpdateAuthorization,
  emptyMaintenanceGuard,
  restoreMaintenanceGuard,
  serializeMaintenanceGuard,
  tryAcquireMaintenanceJob,
  releaseMaintenanceJob,
  recoverMaintenanceGuard,
  cancellationMetadata,
  resolveCancellationTarget,
  cancellableSnapshotMetadata,
} = require('../lib/systems');

const root = path.resolve(__dirname, '..');
const catalogPath = path.join(root, 'config', 'systems.json');
const rawCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));

function invalidCatalog(change) {
  const value = clone(rawCatalog);
  change(value);
  return value;
}

function commandKey(file, args) {
  return `${file} ${args.join(' ')}`;
}

async function main() {
  const catalog = normalizeCatalog(rawCatalog);
  assert.strictEqual(catalog.schemaVersion, CATALOG_SCHEMA_VERSION);
  assert.strictEqual(CATALOG_SCHEMA_VERSION, 3);
  assert.strictEqual(catalog.sources.length, 4);
  assert.strictEqual(catalog.packages.length, 18);
  assert.strictEqual(catalog.systems.length, 26);
  assert(Object.isFrozen(catalog));
  assert(Object.isFrozen(catalog.packages[0]));
  assert(catalog.sources.every((source) => source.official === true));
  assert(catalog.packages.every((packageDefinition) => !('command' in packageDefinition) && !('args' in packageDefinition)));
  assert(catalog.systems.every((system) => !('install' in system) && !('update' in system) && !('updateCheck' in system)));

  const nodeBinding = getCatalogBinding(catalog, 'node');
  assert.strictEqual(nodeBinding.packageDefinition.identifier, 'OpenJS.NodeJS.LTS');
  assert.strictEqual(nodeBinding.source.id, 'winget');
  assert.strictEqual(getCatalogBinding(catalog, 'hermes').packageDefinition, null);

  const nodeUpdate = buildMaintenancePlan(catalog, 'node', 'update', { cwd: 'C:\\fixture' });
  assert.deepStrictEqual(nodeUpdate.command, {
    file: 'winget.exe',
    args: [
      'upgrade', '--id', 'OpenJS.NodeJS.LTS', '--exact', '--source', 'winget', '--silent',
      '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity',
    ],
    cwd: 'C:\\fixture',
  });
  assert.strictEqual(nodeUpdate.cancellationPolicy, 'queued-only');
  const npmUpdate = buildMaintenancePlan(catalog, 'codex', 'update');
  assert.deepStrictEqual(npmUpdate.command.args, [
    'install', '--global', '@openai/codex@latest', '--registry', 'https://registry.npmjs.org/',
  ]);
  const uvInstall = buildMaintenancePlan(catalog, 'serena', 'install');
  assert.deepStrictEqual(uvInstall.command.args, [
    'tool', 'install', '--python', '3.13', '--index-url', 'https://pypi.org/simple/', 'serena-agent',
  ]);
  const gitUpdate = buildMaintenancePlan(catalog, 'ecc', 'update', {
    branch: 'main',
    expandPath: () => 'C:\\fixture\\ECC',
  });
  assert.strictEqual(gitUpdate.command.cwd, 'C:\\fixture\\ECC');
  assert.deepStrictEqual(gitUpdate.command.args, ['pull', '--ff-only', 'origin', 'main']);
  assert.deepStrictEqual(gitUpdate.preflight.map((item) => item.kind), ['official-source', 'clean-working-tree']);
  assert.strictEqual(gitUpdate.preflight[0].expected, 'https://github.com/affaan-m/everything-claude-code.git');
  assert.throws(() => buildMaintenancePlan(catalog, 'ecc', 'update', { branch: '--upload-pack=evil' }), /safe checked Git branch/);
  assert.throws(() => buildMaintenancePlan(catalog, 'serena', 'update'), /does not allow update/);

  assert.throws(() => normalizeCatalog(invalidCatalog((value) => { value.systems[0].install = {}; })), /install.*not allowed/);
  assert.throws(() => normalizeCatalog(invalidCatalog((value) => { value.sources[0].official = false; })), /official.*must be true/);
  assert.throws(() => normalizeCatalog(invalidCatalog((value) => { value.sources.find((item) => item.id === 'npm').url = 'https:\/\/registry.example.invalid\/'; })), /pinned official npm source/);
  assert.throws(() => normalizeCatalog(invalidCatalog((value) => { value.packages[0].operations = ['update']; })), /check and update/);
  assert.throws(() => normalizeCatalog(invalidCatalog((value) => { value.systems[0].package = 'missing'; })), /unknown package/);
  assert.throws(() => normalizeCatalog(invalidCatalog((value) => { value.systems[1].package = value.systems[0].package; })), /exactly one system/);
  assert.throws(() => normalizeCatalog(invalidCatalog((value) => { value.sources.push(clone(value.sources[0])); })), /duplicate id/);
  assert.throws(() => normalizeCatalog(invalidCatalog((value) => { value.systems.find((item) => item.id === 'godot').detect.filePattern = '('; })), /valid regular expression/);

  assert(parseSemver('v1.2.3-rc.1+build.4'));
  assert.strictEqual(parseSemver('1.2'), null);
  assert.strictEqual(compareSemver('1.0.0-rc.1', '1.0.0'), -1);
  assert.strictEqual(compareSemver('1.0.0+one', '1.0.0+two'), 0);
  assert.strictEqual(compareSemver('90071992547409930.0.0', '90071992547409931.0.0'), -1);
  assert.strictEqual(semverDirection('1.2.3', '2.0.0'), 'behind');
  assert.strictEqual(semverDirection('2.0.0', '1.2.3'), 'ahead');
  assert.strictEqual(semverDirection('2.0.0', '2.0.0'), 'current');
  assert.strictEqual(semverDirection('rolling', '2.0.0'), 'unknown');
  assert.strictEqual(greatestSemver(['2.0.0', '1.0.0', '3.0.0-rc.1']), '3.0.0-rc.1');
  assert.strictEqual(extractSemver('codex-cli 0.114.0'), '0.114.0');

  const wingetRows = parseWingetUpgradeOutput(`
Name             ID                    Version  Verfuegbar  Quelle
------------------------------------------------------------------
Git              Git.Git               2.52.0   2.51.0      winget
Node.js          OpenJS.NodeJS.LTS      20.1.0   22.0.0      winget
OpenAI Codex     OpenAI.Codex          0.1.0    0.2.0       winget
`, ['Git.Git', 'OpenJS.NodeJS.LTS']);
  assert.deepStrictEqual(wingetRows.get('Git.Git'), { currentVersion: '2.52.0', latestVersion: '2.51.0' });
  assert.strictEqual(wingetRows.has('OpenAI.Codex'), false);
  assert.strictEqual(parseNpmVersionOutput('["2.0.0","1.0.0","3.0.0-rc.1"]'), '3.0.0-rc.1');
  assert.strictEqual(parseNpmVersionOutput('not-a-version'), null);
  assert.deepStrictEqual(parseGitAheadBehind('0\t4'), { ahead: 0, behind: 4, relation: 'behind' });
  assert.deepStrictEqual(parseGitAheadBehind('2 0'), { ahead: 2, behind: 0, relation: 'ahead' });
  assert.deepStrictEqual(parseGitAheadBehind('2 3'), { ahead: 2, behind: 3, relation: 'diverged' });
  assert.strictEqual(parseGitAheadBehind('n/a'), null);
  assert.strictEqual(classifyGitRelation(0, 0), 'current');
  assert.strictEqual(classifyGitRelation(-1, 0), 'unknown');

  assert.strictEqual(
    sameGitRemote('git@github.com:affaan-m/everything-claude-code.git', 'https://github.com/affaan-m/everything-claude-code.git'),
    true,
  );
  assert.strictEqual(
    sameGitRemote('https://github.com/attacker/everything-claude-code.git', 'https://github.com/affaan-m/everything-claude-code.git'),
    false,
  );

  const calls = [];
  const localSha = '1'.repeat(40);
  const fetchedSha = '2'.repeat(40);
  const executor = async (file, args, options) => {
    calls.push({ file, args, options });
    const key = commandKey(file, args);
    if (file === 'winget.exe') return { exitCode: 0, stdout: [...wingetRows.entries()].map(([id, versions]) => `${id} ${versions.currentVersion} ${versions.latestVersion}`).join('\n'), stderr: '' };
    if (file === 'npm.cmd') return { exitCode: 0, stdout: '"0.10.0"', stderr: '' };
    if (key === 'git.exe remote get-url origin') return { exitCode: 0, stdout: 'git@github.com:affaan-m/everything-claude-code.git\n', stderr: '' };
    if (key === 'git.exe symbolic-ref --quiet --short HEAD') return { exitCode: 0, stdout: 'main\n', stderr: '' };
    if (key === 'git.exe rev-parse HEAD') return { exitCode: 0, stdout: `${localSha}\n`, stderr: '' };
    if (key.startsWith('git.exe fetch ')) return { exitCode: 0, stdout: '', stderr: '' };
    if (key === 'git.exe rev-parse FETCH_HEAD') return { exitCode: 0, stdout: `${fetchedSha}\n`, stderr: '' };
    if (key === 'git.exe rev-list --left-right --count HEAD...FETCH_HEAD') return { exitCode: 0, stdout: '0\t3\n', stderr: '' };
    throw new Error(`Unexpected fixture command: ${key}`);
  };
  const checkedAt = '2026-07-13T10:00:00.000Z';
  const checks = await checkCatalogUpdates(catalog, {
    node: { ok: true, text: 'v20.1.0' },
    git: { ok: true, text: 'git version 2.52.0' },
    codex: { ok: true, text: 'codex-cli 0.9.0' },
    ecc: { ok: true, text: 'installed' },
  }, {
    execute: executor,
    now: checkedAt,
    expandPath: () => 'C:\\fixture\\ECC',
  });
  assert.strictEqual(checks.checkedAt, checkedAt);
  assert.strictEqual(checks.entries.node.status, 'available');
  assert.strictEqual(checks.entries.node.direction, 'behind');
  assert.strictEqual(checks.entries.git.status, 'ahead');
  assert.strictEqual(checks.entries.codex.status, 'available');
  assert.strictEqual(checks.entries.ecc.status, 'available');
  assert.strictEqual(checks.entries.ecc.relation, 'behind');
  assert.strictEqual(checks.entries.ecc.behind, 3);
  assert.strictEqual(checks.entries.claude.status, 'not-installed');
  assert.strictEqual(calls.filter((call) => call.file === 'winget.exe').length, 1);
  assert(calls.find((call) => call.file === 'npm.cmd').args.includes('https://registry.npmjs.org/'));
  assert(calls.filter((call) => call.file === 'git.exe').every((call) => call.options.cwd === 'C:\\fixture\\ECC'));

  const eccBinding = getCatalogBinding(catalog, 'ecc');
  const mismatchCalls = [];
  const mismatch = await checkGitPackage(eccBinding, {
    checkedAt,
    expandPath: () => 'C:\\fixture\\ECC',
    execute: async (file, args) => {
      mismatchCalls.push(commandKey(file, args));
      return { exitCode: 0, stdout: 'https://github.com/attacker/everything-claude-code.git\n', stderr: '' };
    },
  });
  assert.strictEqual(mismatch.status, 'unknown');
  assert.strictEqual(mismatch.reasonCode, 'official-source-mismatch');
  assert.deepStrictEqual(mismatchCalls, ['git.exe remote get-url origin']);

  const diverged = await checkGitPackage(eccBinding, {
    checkedAt,
    expandPath: () => 'C:\\fixture\\ECC',
    execute: async (file, args) => {
      const key = commandKey(file, args);
      if (key === 'git.exe remote get-url origin') return { exitCode: 0, stdout: 'https://github.com/affaan-m/everything-claude-code.git', stderr: '' };
      if (key === 'git.exe symbolic-ref --quiet --short HEAD') return { exitCode: 0, stdout: 'main', stderr: '' };
      if (key === 'git.exe rev-parse HEAD') return { exitCode: 0, stdout: localSha, stderr: '' };
      if (key.startsWith('git.exe fetch ')) return { exitCode: 0, stdout: '', stderr: '' };
      if (key === 'git.exe rev-parse FETCH_HEAD') return { exitCode: 0, stdout: fetchedSha, stderr: '' };
      if (key === 'git.exe rev-list --left-right --count HEAD...FETCH_HEAD') return { exitCode: 0, stdout: '2 3', stderr: '' };
      throw new Error(`Unexpected fixture command: ${key}`);
    },
  });
  assert.strictEqual(diverged.status, 'diverged');
  assert.strictEqual(diverged.relation, 'diverged');

  const cache = createUpdateCache(catalog, checks, { now: checkedAt });
  assert.strictEqual(cache.schemaVersion, 2);
  assert.strictEqual(cache.catalogFingerprint, catalogFingerprint(catalog));
  assert.strictEqual(cache.entries.node.packageFingerprint, packageFingerprint(catalog, 'node'));
  const authorizedNode = authorizeSystemUpdate(catalog, cache, 'node', { now: '2026-07-13T11:00:00.000Z' });
  assert.strictEqual(authorizedNode.authorized, true);
  const authorizedGit = authorizeSystemUpdate(catalog, cache, 'ecc', { now: '2026-07-13T11:00:00.000Z' });
  assert.strictEqual(authorizedGit.authorized, true);
  assert.strictEqual(authorizedGit.branch, 'main');
  assert.strictEqual(authorizeSystemUpdate(catalog, cache, 'git', { now: '2026-07-13T11:00:00.000Z' }).code, 'update-not-available');
  assert.strictEqual(authorizeSystemUpdate(catalog, cache, 'node', { now: '2026-07-13T16:00:00.001Z' }).code, 'stale-evidence');
  assert.strictEqual(authorizeSystemUpdate(catalog, cache, 'node', { now: '2026-07-13T09:59:00.000Z' }).code, 'future-evidence');

  const changedCatalogValue = clone(rawCatalog);
  changedCatalogValue.systems.find((system) => system.id === 'node').reason = 'Changed review boundary.';
  const changedCatalog = normalizeCatalog(changedCatalogValue);
  assert.strictEqual(authorizeSystemUpdate(changedCatalog, cache, 'node', { now: '2026-07-13T11:00:00.000Z' }).code, 'catalog-changed');
  const reorderedCatalogValue = clone(rawCatalog);
  reorderedCatalogValue.sources.reverse();
  reorderedCatalogValue.packages.reverse();
  reorderedCatalogValue.systems.reverse();
  assert.strictEqual(catalogFingerprint(reorderedCatalogValue), catalogFingerprint(catalog));

  const tamperedBinding = clone(cache);
  tamperedBinding.entries.node.packageFingerprint = `sha256:${'0'.repeat(64)}`;
  assert.strictEqual(authorizeSystemUpdate(catalog, tamperedBinding, 'node', { now: '2026-07-13T11:00:00.000Z' }).code, 'binding-changed');
  const tamperedDirection = clone(cache);
  tamperedDirection.entries.node.currentVersion = '99.0.0';
  tamperedDirection.entries.node.latestVersion = '22.0.0';
  assert.strictEqual(authorizeSystemUpdate(catalog, tamperedDirection, 'node', { now: '2026-07-13T11:00:00.000Z' }).code, 'unsafe-semver-direction');
  const tamperedGit = clone(cache);
  tamperedGit.entries.ecc.relation = 'diverged';
  tamperedGit.entries.ecc.ahead = 2;
  assert.strictEqual(authorizeSystemUpdate(catalog, tamperedGit, 'ecc', { now: '2026-07-13T11:00:00.000Z' }).code, 'unsafe-git-direction');
  const consumed = consumeSystemUpdateAuthorization(catalog, cache, 'node', { now: '2026-07-13T11:00:00.000Z' });
  assert.strictEqual(consumed.authorization.authorized, true);
  assert.strictEqual(consumed.cache.entries.node, undefined);
  assert(cache.entries.node);

  const initialGuard = emptyMaintenanceGuard();
  const acquired = tryAcquireMaintenanceJob(initialGuard, {
    jobId: 'job-1', kind: 'update', systemId: 'node', projectId: 'project-1',
  }, { now: checkedAt });
  assert.strictEqual(acquired.acquired, true);
  assert.deepStrictEqual(restoreMaintenanceGuard(serializeMaintenanceGuard(acquired.state)), acquired.state);
  const busy = tryAcquireMaintenanceJob(acquired.state, {
    jobId: 'job-2', kind: 'install', systemId: 'git', projectId: 'project-1',
  }, { now: checkedAt });
  assert.strictEqual(busy.acquired, false);
  assert.strictEqual(busy.active.jobId, 'job-1');
  assert.strictEqual(releaseMaintenanceJob(acquired.state, { jobId: 'job-2', leaseId: acquired.lease.leaseId }).code, 'lease-mismatch');
  const released = releaseMaintenanceJob(acquired.state, acquired.lease, 'completed');
  assert.strictEqual(released.released, true);
  assert.strictEqual(released.state.active, null);
  assert.strictEqual(released.state.revision, 2);
  assert.strictEqual(recoverMaintenanceGuard(acquired.state, { confirmedInactive: false }).code, 'recovery-not-confirmed');
  assert.strictEqual(recoverMaintenanceGuard(acquired.state, { confirmedInactive: true, reason: 'process inspection confirmed exit' }).recovered, true);
  assert.throws(() => restoreMaintenanceGuard('{bad json'), /valid JSON/);
  assert.throws(() => restoreMaintenanceGuard({ ...initialGuard, extra: true }), /unsupported shape/);

  assert.deepStrictEqual(cancellationMetadata({ kind: 'update', status: 'running', phase: 'queued', pid: null }), {
    cancellable: true, mode: 'queued', reasonCode: null,
  });
  assert.deepStrictEqual(cancellationMetadata({ kind: 'update', status: 'running', phase: 'updating', pid: 1234 }), {
    cancellable: false, mode: null, reasonCode: 'mutation-in-progress',
  });
  assert.deepStrictEqual(cancellationMetadata({ kind: 'task', status: 'running', phase: 'routing', pid: 1234 }), {
    cancellable: true, mode: 'process-tree', reasonCode: null,
  });
  assert.deepStrictEqual(resolveCancellationTarget({ kind: 'task', status: 'running', phase: 'routing', pid: 1234 }), {
    mode: 'process-tree', pid: 1234,
  });
  assert.deepStrictEqual(cancellationMetadata({ kind: 'task', status: 'stopping', phase: 'routing', pid: 1234 }), {
    cancellable: false, mode: null, reasonCode: 'cancellation-in-progress',
  });
  assert.strictEqual(cancellationMetadata({ kind: 'unknown', status: 'running', phase: 'run', pid: 1234, cancellable: true }).cancellable, false);
  assert.strictEqual(cancellationMetadata({ kind: 'task', status: 'completed', phase: 'done', pid: 1234 }).cancellable, false);
  const snapshotMetadata = cancellableSnapshotMetadata({ kind: 'task', status: 'running', phase: 'routing', pid: 1234 });
  assert.strictEqual(snapshotMetadata.cancellable, true);
  assert.strictEqual(JSON.stringify(snapshotMetadata).includes('1234'), false);

  process.stdout.write('SYSTEM_UPDATES_TEST_OK\n');
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
