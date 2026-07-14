'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const {
  getMcpInventory,
  normalizeMcpServer,
  parseCodexMcpServers,
  redactUrl,
} = require('../lib/integrations/mcp-inventory');

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

test('Codex TOML parsing keeps server names and policy fields without evaluating configuration', () => {
  const servers = parseCodexMcpServers(`
    [mcp_servers.local]
    command = 'local-server.exe'
    args = ['serve', '--quiet']
    enabled_tools = [
      'search', # comments in a multiline allow-list stay safe
      'inspect',
    ]
    startup_timeout_sec = 45

    [mcp_servers.local.env]
    LOCAL_TOKEN = 'secret-value'

    [mcp_servers."remote.api"]
    url = "https://example.test/mcp"
    required = true
  `);

  assert.deepEqual(servers.map((server) => server.name), ['local', 'remote.api']);
  assert.equal(servers[0].command, 'local-server.exe');
  assert.deepEqual(servers[0].enabled_tools, ['search', 'inspect']);
  assert.equal(servers[0].startup_timeout_sec, 45);
  assert.deepEqual(Object.keys(servers[0].env), ['LOCAL_TOKEN']);
  assert.equal(servers[1].required, true);
});

test('normalized HTTP targets and serialized rows never expose credential values', () => {
  assert.equal(redactUrl('https://user:password@example.test/mcp?token=top-secret#fragment'), 'https://example.test/mcp?…');
  const row = normalizeMcpServer({
    url: 'https://user:password@example.test/mcp?token=top-secret',
    bearer_token_env_var: 'REMOTE_TOKEN',
    http_headers: { Authorization: 'Bearer top-secret' },
  }, { client: 'Codex', scope: 'global', source: '~/.codex/config.toml', name: 'remote' });
  const serialized = JSON.stringify(row);
  assert.match(serialized, /REMOTE_TOKEN/);
  assert.match(serialized, /Authorization/);
  assert.doesNotMatch(serialized, /password|top-secret|Bearer/);
  assert.equal(row.health.state, 'not-checked');
  assert.equal(row.status, 'konfiguriert');
});

test('inventory combines global and current-project Codex and Claude configurations read-only', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-inventory-test-'));
  roots.push(root);
  const home = path.join(root, 'home');
  const repository = path.join(root, 'Example Project');
  await Promise.all([
    fs.mkdir(path.join(home, '.codex'), { recursive: true }),
    fs.mkdir(path.join(repository, '.codex'), { recursive: true }),
  ]);
  await fs.writeFile(path.join(home, '.codex', 'config.toml'), `
    [mcp_servers.local]
    command = 'local-server.exe'
    [mcp_servers.local.env]
    PRIVATE_VALUE = 'must-not-leak'

    [mcp_servers.remote]
    url = 'https://account:password@example.test/mcp?key=must-not-leak'
    bearer_token_env_var = 'REMOTE_TOKEN'
  `, 'utf8');
  await fs.writeFile(path.join(repository, '.codex', 'config.toml'), `
    [mcp_servers.project-code]
    command = 'project-server.exe'
    enabled = false
  `, 'utf8');
  await fs.writeFile(path.join(home, '.claude.json'), JSON.stringify({
    mcpServers: { globalClaude: { command: 'claude-global.exe', env: { CLAUDE_SECRET: 'must-not-leak' } } },
    projects: {
      [repository.replace(/\\/g, '/').toUpperCase()]: {
        mcpServers: { projectClaude: { command: 'from-user-config.exe' } },
      },
      'C:/Another/Repository': { mcpServers: { unrelated: { command: 'not-visible.exe' } } },
    },
  }), 'utf8');
  await fs.writeFile(path.join(repository, '.mcp.json'), JSON.stringify({
    mcpServers: { projectClaude: { command: 'from-project-config.exe' } },
  }), 'utf8');

  const inventory = await getMcpInventory({ home, projectRepository: repository });
  const serialized = JSON.stringify(inventory);
  assert.equal(inventory.summary.configured, 5);
  assert.equal(inventory.summary.active, 4);
  assert.equal(inventory.summary.local, 3);
  assert.equal(inventory.summary.remote, 1);
  assert.equal(inventory.summary.project, 1);
  assert.equal(inventory.servers.find((server) => server.name === 'projectClaude').source, '.mcp.json');
  assert.doesNotMatch(serialized, /must-not-leak|password|not-visible/);
  assert.match(serialized, /PRIVATE_VALUE|CLAUDE_SECRET|REMOTE_TOKEN/);
});
