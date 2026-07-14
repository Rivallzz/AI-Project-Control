'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

function stripTomlComment(value) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) { escaped = false; continue; }
    if (quote === '"' && character === '\\') { escaped = true; continue; }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '#') return value.slice(0, index).trim();
  }
  return value.trim();
}

function splitTomlList(value) {
  const entries = [];
  let quote = null;
  let escaped = false;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) { escaped = false; continue; }
    if (quote === '"' && character === '\\') { escaped = true; continue; }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === ',') { entries.push(value.slice(start, index)); start = index + 1; }
  }
  entries.push(value.slice(start));
  return entries.map((entry) => entry.trim()).filter(Boolean);
}

function parseTomlValue(source) {
  const value = stripTomlComment(String(source || ''));
  if (value.startsWith('[') && value.endsWith(']')) return splitTomlList(value.slice(1, -1)).map(parseTomlValue);
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^[+-]?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function tomlCompositeComplete(source) {
  let quote = null;
  let escaped = false;
  let depth = 0;
  for (const character of String(source || '')) {
    if (escaped) { escaped = false; continue; }
    if (quote === '"' && character === '\\') { escaped = true; continue; }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '[' || character === '{') depth += 1;
    else if (character === ']' || character === '}') depth -= 1;
  }
  return depth <= 0;
}

function splitTomlPath(source) {
  const segments = [];
  let quote = null;
  let escaped = false;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) { escaped = false; continue; }
    if (quote === '"' && character === '\\') { escaped = true; continue; }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '.') { segments.push(source.slice(start, index)); start = index + 1; }
  }
  segments.push(source.slice(start));
  return segments.map((segment) => {
    const trimmed = segment.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return parseTomlValue(trimmed);
    }
    return trimmed;
  }).filter(Boolean);
}

function parseCodexMcpServers(text) {
  const servers = new Map();
  let section = null;
  const lines = String(text || '').split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]\s*(?:#.*)?$/);
    if (sectionMatch) {
      const parts = splitTomlPath(sectionMatch[1]);
      section = parts[0] === 'mcp_servers' && parts[1] ? { name: String(parts[1]), nested: parts.slice(2) } : null;
      if (section && !servers.has(section.name)) servers.set(section.name, { name: section.name });
      continue;
    }
    if (!section) continue;
    const assignment = rawLine.match(/^\s*([^=]+?)\s*=\s*(.*)$/);
    if (!assignment) continue;
    const key = String(splitTomlPath(assignment[1])[0] || '').trim();
    if (!key) continue;
    let valueSource = stripTomlComment(assignment[2]);
    if (/^[\[{]/.test(valueSource) && !tomlCompositeComplete(valueSource)) {
      while (lineIndex + 1 < lines.length) {
        const continuation = lines[lineIndex + 1].trim();
        if (/^\[[^\]]+\]\s*(?:#.*)?$/.test(continuation)) break;
        lineIndex += 1;
        const fragment = stripTomlComment(continuation);
        if (fragment) valueSource += ` ${fragment}`;
        if (tomlCompositeComplete(valueSource)) break;
      }
    }
    const server = servers.get(section.name);
    const nested = section.nested[0];
    if (!nested) server[key] = parseTomlValue(valueSource);
    else {
      if (!server[nested] || typeof server[nested] !== 'object' || Array.isArray(server[nested])) server[nested] = {};
      server[nested][key] = parseTomlValue(valueSource);
    }
  }
  return [...servers.values()];
}

function redactUrl(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  try {
    const url = new URL(source);
    return `${url.protocol}//${url.host}${url.pathname}${url.search ? '?…' : ''}`;
  } catch {
    return source
      .replace(/\/\/[^/@\s]+@/g, '//redacted@')
      .replace(/([?&](?:token|key|secret|auth|password)=)[^&\s]+/gi, '$1…');
  }
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry)).filter(Boolean);
}

function objectKeys(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
}

function environmentReferences(server) {
  return [...new Set([
    ...objectKeys(server.env),
    ...objectKeys(server.env_http_headers),
    ...objectKeys(server.http_headers),
    server.bearer_token_env_var,
  ].filter(Boolean).map(String))].sort((left, right) => left.localeCompare(right));
}

function normalizeMcpServer(server, context) {
  const command = typeof server.command === 'string' ? server.command.trim() : '';
  const url = typeof server.url === 'string' ? server.url.trim() : '';
  const declaredType = String(server.type || '').toLowerCase();
  const transport = url || ['http', 'sse', 'streamable-http'].includes(declaredType) ? 'http' : command ? 'stdio' : 'unbekannt';
  const enabled = server.enabled !== false && server.disabled !== true;
  const complete = transport === 'http' ? Boolean(url) : transport === 'stdio' ? Boolean(command) : false;
  const status = !enabled ? 'deaktiviert' : complete ? 'konfiguriert' : 'unvollständig';
  const state = !enabled ? 'inactive' : complete ? 'not-checked' : 'invalid';
  const environmentRefs = environmentReferences(server);
  const enabledTools = stringArray(server.enabled_tools || server.allowedTools);
  const disabledTools = stringArray(server.disabled_tools || server.deniedTools);
  const target = transport === 'http' ? redactUrl(url) : command;
  return {
    id: `${context.client.toLowerCase()}-${context.scope}-${context.name}`.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase(),
    name: context.name,
    client: context.client,
    scope: context.scope,
    source: context.source,
    transport,
    target: target || 'Kein Startziel konfiguriert',
    enabled,
    required: server.required === true,
    status,
    health: {
      state,
      label: status,
      detail: state === 'not-checked'
        ? 'Konfiguration erkannt. Die Laufzeit wird vom jeweiligen Client gestartet und hier nicht automatisch ausgeführt.'
        : state === 'inactive' ? 'Die Konfiguration ist vorhanden, aber deaktiviert.' : 'Command oder URL fehlt in der Konfiguration.',
    },
    role: `Stellt ${context.client} bei Bedarf MCP-Werkzeuge bereit.`,
    activation: !enabled ? 'Deaktiviert.' : context.scope === 'project'
      ? 'Nur im ausgewählten Projekt, sobald der Client diesen Server benötigt.'
      : `Global für ${context.client}, sobald der Client diesen Server benötigt.`,
    costPolicy: transport === 'http'
      ? 'MCP selbst ist kostenlos; der entfernte Dienst kann ein Konto, Zugangsdaten oder eigene Kosten haben.'
      : 'MCP selbst ist kostenlos; dieser lokale Server nutzt nur lokale Rechnerressourcen und angebundene Dienste.',
    environmentRefs,
    toolPolicy: {
      enabled: enabledTools,
      disabled: disabledTools,
      approvalMode: server.default_tools_approval_mode || null,
    },
    timeouts: {
      startupSeconds: Number.isFinite(server.startup_timeout_sec) ? server.startup_timeout_sec : null,
      toolSeconds: Number.isFinite(server.tool_timeout_sec) ? server.tool_timeout_sec : null,
    },
  };
}

function normalizeProjectPath(value) {
  return String(value || '').replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
}

function jsonMcpServers(config) {
  const servers = config?.mcpServers;
  return servers && typeof servers === 'object' && !Array.isArray(servers) ? Object.entries(servers) : [];
}

async function readText(filePath) {
  try { return { ok: true, value: await fs.readFile(filePath, 'utf8') }; }
  catch (error) { return error.code === 'ENOENT' ? { ok: false, missing: true } : { ok: false, error }; }
}

async function getMcpInventory({ home, projectRepository = null }) {
  const rows = new Map();
  const errors = [];
  const add = (server, context) => rows.set(`${context.client}:${context.scope}:${context.name}`, normalizeMcpServer(server, context));
  const readCodex = async (filePath, scope, source) => {
    const result = await readText(filePath);
    if (result.missing) return;
    if (!result.ok) { errors.push({ client: 'Codex', scope, source, message: 'Konfiguration ist nicht lesbar.' }); return; }
    for (const server of parseCodexMcpServers(result.value)) add(server, { client: 'Codex', scope, source, name: server.name });
  };
  const readClaudeFile = async (filePath, scope, source) => {
    const result = await readText(filePath);
    if (result.missing) return null;
    if (!result.ok) { errors.push({ client: 'Claude Code', scope, source, message: 'Konfiguration ist nicht lesbar.' }); return null; }
    try { return JSON.parse(result.value); }
    catch { errors.push({ client: 'Claude Code', scope, source, message: 'Konfiguration enthält ungültiges JSON.' }); return null; }
  };

  await readCodex(path.join(home, '.codex', 'config.toml'), 'global', '~/.codex/config.toml');
  if (projectRepository) await readCodex(path.join(projectRepository, '.codex', 'config.toml'), 'project', '.codex/config.toml');

  const claudeConfig = await readClaudeFile(path.join(home, '.claude.json'), 'global', '~/.claude.json');
  if (claudeConfig) {
    for (const [name, server] of jsonMcpServers(claudeConfig)) add(server, { client: 'Claude Code', scope: 'global', source: '~/.claude.json', name });
    if (projectRepository && claudeConfig.projects && typeof claudeConfig.projects === 'object') {
      const expected = normalizeProjectPath(projectRepository);
      for (const [projectPath, projectConfig] of Object.entries(claudeConfig.projects)) {
        if (normalizeProjectPath(projectPath) !== expected) continue;
        for (const [name, server] of jsonMcpServers(projectConfig)) add(server, { client: 'Claude Code', scope: 'project', source: '~/.claude.json (Projekt)', name });
      }
    }
  }
  if (projectRepository) {
    const projectClaude = await readClaudeFile(path.join(projectRepository, '.mcp.json'), 'project', '.mcp.json');
    for (const [name, server] of jsonMcpServers(projectClaude)) add(server, { client: 'Claude Code', scope: 'project', source: '.mcp.json', name });
  }

  const servers = [...rows.values()].sort((left, right) => left.name.localeCompare(right.name) || left.client.localeCompare(right.client));
  const active = servers.filter((server) => server.enabled && server.health.state === 'not-checked');
  return {
    servers,
    errors,
    summary: {
      configured: servers.length,
      active: active.length,
      local: active.filter((server) => server.transport === 'stdio').length,
      remote: active.filter((server) => server.transport === 'http').length,
      project: active.filter((server) => server.scope === 'project').length,
      clients: {
        codex: servers.filter((server) => server.client === 'Codex').length,
        claude: servers.filter((server) => server.client === 'Claude Code').length,
      },
    },
    policy: {
      mode: 'read-only',
      health: 'Konfigurationserkennung ohne automatischen Serverstart',
      cost: 'MCP selbst ist kostenlos; Remote-Dienste können eigene Kosten verursachen.',
    },
  };
}

module.exports = {
  getMcpInventory,
  normalizeMcpServer,
  parseCodexMcpServers,
  redactUrl,
};
