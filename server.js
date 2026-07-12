'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { randomUUID } = require('crypto');

const HOST = process.env.AI_PROJECT_CONTROL_HOST || '127.0.0.1';
const PORT = Number(process.env.AI_PROJECT_CONTROL_PORT || 8765);
const HOME = os.homedir();
const PUBLIC_ROOT = path.join(__dirname, 'public');
const DATA_ROOT = process.env.AI_PROJECT_CONTROL_DATA || path.join(process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local'), 'AI Project Control');
const PROJECTS_PATH = path.join(DATA_ROOT, 'projects.json');
const SYSTEMS_PATH = path.join(DATA_ROOT, 'systems.json');
const MEMORY_ROOT = path.join(DATA_ROOT, 'memory');
const ROUTER_ROOT = path.join(__dirname, 'router');
const STATUS_SCRIPT = path.join(ROUTER_ROOT, 'Get-AiProviderStatus.ps1');
const TASK_SCRIPT = path.join(ROUTER_ROOT, 'Invoke-ProjectAiTask.ps1');
const RUN_ROOT = process.env.AI_PROJECT_CONTROL_RUN_ROOT || path.join(HOME, 'Documents', 'AI-Runs');
const TASK_ROOT = path.join(RUN_ROOT, '_dashboard_tasks');
const WORKTREE_ROOT = process.env.AI_PROJECT_CONTROL_WORKTREE_ROOT || path.join(HOME, 'Documents', 'AI-Worktrees');
const ECC_ROOT = path.join(HOME, 'Documents', 'Local-AI-Workspace-Tools', 'ECC');
const OBSIDIAN_VAULT = process.env.AI_PROJECT_CONTROL_OBSIDIAN_VAULT || path.join(HOME, 'Documents', 'Obsidian', 'Project-Knowledge');
const GRAPHIFY_PYTHON = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe');
const CC_SWITCH_EXE = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'CC-Switch', 'cc-switch.exe');
const COMFY_EXE = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Comfy Desktop', 'Comfy Desktop.exe');
const COMFY_SETTINGS = path.join(process.env.APPDATA || '', 'Comfy Desktop', 'settings.json');
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_JOB_LOG_CHARS = 2 * 1024 * 1024;
const MAX_KNOWLEDGE_FILE_BYTES = 512 * 1024;

const jobs = new Map();
let statusCache = null;
let statusCacheAt = 0;
const componentCache = new Map();
let systemCache = null;
let systemCacheAt = 0;

function defaultRegistry() {
  const projects = [];
  const selfRepository = path.resolve(__dirname);
  projects.push({
    id: 'ai-project-control', name: 'AI Project Control', repository: selfRepository,
    graphPath: path.join(selfRepository, 'graphify-out', 'graph.json'),
    obsidianPath: path.join(OBSIDIAN_VAULT, '10 Projects', 'AI Project Control'),
  });
  const polisRepository = 'C:\\Repos\\Polis';
  if (fs.existsSync(polisRepository) && polisRepository.toLowerCase() !== selfRepository.toLowerCase()) {
    projects.push({
      id: 'polis', name: 'Polis', repository: polisRepository,
      graphPath: path.join(polisRepository, 'graphify-out', 'graph.json'),
      obsidianPath: path.join(OBSIDIAN_VAULT, '10 Projects', 'Polis'),
    });
  }
  return { activeProjectId: projects.some((project) => project.id === 'polis') ? 'polis' : projects[0].id, projects };
}

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  });
  response.end(body);
}

function sendError(response, statusCode, message) {
  sendJson(response, statusCode, { error: message });
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      resolve({
        exitCode: error && Number.isInteger(error.code) ? error.code : error ? 1 : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
      });
    });
  });
}

function parseJsonOutput(text) {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('Command returned no JSON object.');
  return JSON.parse(text.slice(start));
}

async function readJsonFile(filePath) {
  const text = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(text.replace(/^\uFEFF/, ''));
}

function safeId(value) {
  const base = String(value || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return base || 'project';
}

function normalizedProject(project) {
  return {
    id: String(project.id),
    name: String(project.name),
    repository: path.resolve(String(project.repository)),
    graphPath: path.resolve(String(project.graphPath)),
    obsidianPath: path.resolve(String(project.obsidianPath)),
  };
}

async function loadProjects() {
  if (!fs.existsSync(PROJECTS_PATH)) {
    const initial = defaultRegistry();
    await saveProjects(initial);
    return initial;
  }
  const registry = await readJsonFile(PROJECTS_PATH);
  if (!Array.isArray(registry.projects) || registry.projects.length === 0) throw new Error('Project registry is invalid.');
  registry.projects = registry.projects.map(normalizedProject);
  if (!registry.projects.some((project) => project.id === registry.activeProjectId)) {
    registry.activeProjectId = registry.projects[0].id;
  }
  return registry;
}

async function saveProjects(registry) {
  await fsp.mkdir(DATA_ROOT, { recursive: true });
  const temporary = `${PROJECTS_PATH}.tmp`;
  await fsp.writeFile(temporary, JSON.stringify(registry, null, 2), 'utf8');
  await fsp.rename(temporary, PROJECTS_PATH);
}

async function getProject(projectId) {
  const registry = await loadProjects();
  const id = projectId || registry.activeProjectId;
  const project = registry.projects.find((candidate) => candidate.id === id);
  if (!project) throw new Error('Unknown project.');
  return { registry, project };
}

async function ensureObsidianProjectArea(project) {
  const directories = ['Working Notes', 'Research', 'Design Drafts', 'Review Notes', 'Prompt Library', 'Lessons Learned', 'AI Runs'];
  for (const directory of directories) await fsp.mkdir(path.join(project.obsidianPath, directory), { recursive: true });
  const dashboardPath = path.join(project.obsidianPath, project.name + ' Dashboard.md');
  if (!fs.existsSync(dashboardPath)) {
    const dashboard = [
      '---', 'title: ' + project.name + ' Dashboard', 'tags:', '  - project', '  - active', '---', '',
      '# ' + project.name + ' Dashboard', '',
      '> [!important] Source of truth',
      '> Official information remains in the Git repository. This area contains working notes and run links.', '',
      '- Repository: ' + project.repository,
      '- Agent rules: ' + path.join(project.repository, 'AGENTS.md'),
      '- Current task: ' + path.join(project.repository, 'Docs', 'CURRENT_TASK.md'),
      '- Graphify index: ' + project.graphPath, '',
    ].join('\n');
    await fsp.writeFile(dashboardPath, dashboard, 'utf8');
  }
}

async function addProject(payload) {
  const name = String(payload.name || '').trim();
  const repository = path.resolve(String(payload.repository || '').trim());
  if (!name || name.length > 80) throw new Error('Project name must contain between 1 and 80 characters.');
  if (!fs.existsSync(repository) || !fs.statSync(repository).isDirectory()) throw new Error('Repository directory does not exist.');
  const registry = await loadProjects();
  if (registry.projects.some((project) => project.repository.toLowerCase() === repository.toLowerCase())) {
    throw new Error('This repository is already registered.');
  }
  const baseId = safeId(name);
  let id = baseId;
  let suffix = 2;
  while (registry.projects.some((project) => project.id === id)) id = `${baseId}-${suffix++}`;
  const graphPath = path.resolve(String(payload.graphPath || path.join(repository, 'graphify-out', 'graph.json')).trim());
  const obsidianPath = path.resolve(String(payload.obsidianPath || path.join(OBSIDIAN_VAULT, '10 Projects', name)).trim());
  const project = normalizedProject({ id, name, repository, graphPath, obsidianPath });
  await ensureObsidianProjectArea(project);
  registry.projects.push(project);
  registry.activeProjectId = id;
  await saveProjects(registry);
  return project;
}

async function selectProject(projectId) {
  const registry = await loadProjects();
  if (!registry.projects.some((project) => project.id === projectId)) throw new Error('Unknown project.');
  registry.activeProjectId = projectId;
  await saveProjects(registry);
  return registry.projects.find((project) => project.id === projectId);
}

async function removeProject(projectId) {
  const registry = await loadProjects();
  if (registry.projects.length === 1) throw new Error('At least one project must remain registered.');
  const index = registry.projects.findIndex((project) => project.id === projectId);
  if (index < 0) throw new Error('Unknown project.');
  const [removed] = registry.projects.splice(index, 1);
  if (registry.activeProjectId === projectId) registry.activeProjectId = registry.projects[0].id;
  await saveProjects(registry);
  return removed;
}

async function loadSystems() {
  if (!fs.existsSync(SYSTEMS_PATH)) {
    const initial = { systems: [] };
    await saveSystems(initial);
    return initial;
  }
  const registry = await readJsonFile(SYSTEMS_PATH);
  if (!Array.isArray(registry.systems)) registry.systems = [];
  return registry;
}

async function saveSystems(registry) {
  await fsp.mkdir(DATA_ROOT, { recursive: true });
  const temporary = `${SYSTEMS_PATH}.tmp`;
  await fsp.writeFile(temporary, JSON.stringify(registry, null, 2), 'utf8');
  await fsp.rename(temporary, SYSTEMS_PATH);
}

async function addSystem(payload) {
  const name = String(payload.name || '').trim();
  const type = String(payload.type || 'Tool').trim();
  const configuredPath = path.resolve(String(payload.path || '').trim());
  const scope = payload.scope === 'project' ? 'project' : 'global';
  const projectId = scope === 'project' ? String(payload.projectId || '') : null;
  if (!name || name.length > 100) throw new Error('System name must contain between 1 and 100 characters.');
  if (!fs.existsSync(configuredPath)) throw new Error('System path does not exist.');
  if (scope === 'project') await getProject(projectId);
  const registry = await loadSystems();
  const system = { id: randomUUID(), name, type, path: configuredPath, scope, projectId, note: String(payload.note || '').trim().slice(0, 500) };
  registry.systems.push(system);
  await saveSystems(registry);
  systemCacheAt = 0;
  return system;
}

async function removeSystem(systemId) {
  const registry = await loadSystems();
  const index = registry.systems.findIndex((system) => system.id === systemId);
  if (index < 0) throw new Error('Unknown registered system.');
  const [removed] = registry.systems.splice(index, 1);
  await saveSystems(registry);
  systemCacheAt = 0;
  return removed;
}

async function loadMemory(projectId) {
  await fsp.mkdir(MEMORY_ROOT, { recursive: true });
  const memoryPath = path.join(MEMORY_ROOT, `${safeId(projectId)}.json`);
  if (!fs.existsSync(memoryPath)) return { projectId, notes: [] };
  const memory = await readJsonFile(memoryPath);
  if (!Array.isArray(memory.notes)) memory.notes = [];
  return memory;
}

async function addMemory(project, payload) {
  const text = String(payload.text || '').trim();
  if (!text || text.length > 4000) throw new Error('Learning note must contain between 1 and 4,000 characters.');
  const memory = await loadMemory(project.id);
  const note = { id: randomUUID(), createdAt: new Date().toISOString(), text, sourceRun: payload.sourceRun ? String(payload.sourceRun) : null };
  memory.notes.unshift(note);
  memory.notes = memory.notes.slice(0, 100);
  await fsp.writeFile(path.join(MEMORY_ROOT, `${safeId(project.id)}.json`), JSON.stringify(memory, null, 2), 'utf8');
  if (fs.existsSync(project.obsidianPath)) {
    const lessonDirectory = path.join(project.obsidianPath, 'Lessons Learned');
    await fsp.mkdir(lessonDirectory, { recursive: true });
    const lines = ['# AI Project Control Memory', '', '> Working memory for agent tasks. Repository files remain authoritative.', ''];
    for (const item of [...memory.notes].reverse()) {
      lines.push(`## ${item.createdAt}`, '', item.text, '');
    }
    await fsp.writeFile(path.join(lessonDirectory, 'AI Project Control Memory.md'), lines.join('\n'), 'utf8');
  }
  return note;
}

async function getProviderStatus(force = false) {
  if (!force && statusCache && Date.now() - statusCacheAt < 5000) return statusCache;
  const result = await execFileAsync('pwsh.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', STATUS_SCRIPT, '-Json']);
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || 'Provider status command failed.');
  statusCache = parseJsonOutput(result.stdout);
  statusCacheAt = Date.now();
  return statusCache;
}

async function commandSummary(command, args) {
  const result = await execFileAsync(command, args, { timeout: 15000 });
  const text = (result.stdout || result.stderr).trim();
  return { ok: result.exitCode === 0, text: text.split(/\r?\n/).find(Boolean) || 'not available' };
}

async function mcpSummary() {
  let codexServers = 0;
  let claudeServers = 0;
  const codexConfig = path.join(HOME, '.codex', 'config.toml');
  const claudeConfig = path.join(HOME, '.claude.json');
  if (fs.existsSync(codexConfig)) {
    const text = await fsp.readFile(codexConfig, 'utf8');
    codexServers = new Set([...text.matchAll(/^\[mcp_servers\.([^.\]]+)\]$/gm)].map((match) => match[1])).size;
  }
  if (fs.existsSync(claudeConfig)) {
    try {
      const config = JSON.parse(await fsp.readFile(claudeConfig, 'utf8'));
      const roots = [config.mcpServers, ...Object.values(config.projects || {}).map((project) => project?.mcpServers)];
      claudeServers = new Set(roots.flatMap((servers) => servers && typeof servers === 'object' ? Object.keys(servers) : [])).size;
    } catch { claudeServers = 0; }
  }
  const total = codexServers + claudeServers;
  return {
    ok: total > 0,
    codexServers,
    claudeServers,
    total,
    text: total ? `${total} Konfiguration(en) erkannt · MCP selbst ist kostenlos; angebundene Dienste können separat kosten` : 'Keine aktiven MCP-Server erkannt',
  };
}

async function graphSummary(graphPath) {
  if (!fs.existsSync(graphPath)) return { ok: false, text: `Graph missing: ${graphPath}` };
  try {
    const graph = JSON.parse(await fsp.readFile(graphPath, 'utf8'));
    return { ok: true, text: `${graph.nodes?.length || 0} nodes · ${graph.links?.length || 0} links` };
  } catch (error) {
    return { ok: false, text: error.message };
  }
}

async function getComponents(project, force = false) {
  const cached = componentCache.get(project.id);
  if (!force && cached && Date.now() - cached.at < 15000) return cached.value;
  const graphifyCommand = fs.existsSync(GRAPHIFY_PYTHON) ? GRAPHIFY_PYTHON : 'python.exe';
  const [codex, claude, hermes, ollama, graphifyCli, graph, branch, gitStatus, eccCommit, mcp] = await Promise.all([
    commandSummary('codex.exe', ['--version']),
    commandSummary('claude.exe', ['--version']),
    commandSummary('hermes.exe', ['--version']),
    commandSummary('ollama.exe', ['--version']),
    commandSummary(graphifyCommand, ['-m', 'graphify', '--version']),
    graphSummary(project.graphPath),
    commandSummary('git.exe', ['-C', project.repository, 'branch', '--show-current']),
    commandSummary('git.exe', ['-C', project.repository, 'status', '--short']),
    commandSummary('git.exe', ['-C', ECC_ROOT, 'rev-parse', '--short', 'HEAD']),
    mcpSummary(),
  ]);
  const value = {
    codex, claude, hermes, ollama,
    graphify: { ok: graphifyCli.ok && graph.ok, text: graphifyCli.ok ? `${graphifyCli.text} · ${graph.text}` : graphifyCli.text },
    repository: {
      ok: branch.ok && gitStatus.ok,
      branch: branch.text,
      clean: gitStatus.ok && gitStatus.text === 'not available',
      statusText: gitStatus.text === 'not available' ? '' : gitStatus.text,
      path: project.repository,
    },
    ecc: { ok: eccCommit.ok, commit: eccCommit.text, path: ECC_ROOT },
    mcp,
    obsidian: { ok: fs.existsSync(project.obsidianPath), path: project.obsidianPath },
    router: { ok: fs.existsSync(STATUS_SCRIPT) && fs.existsSync(TASK_SCRIPT), path: ROUTER_ROOT },
  };
  componentCache.set(project.id, { at: Date.now(), value });
  return value;
}

async function findMatchingFiles(root, pattern, result = []) {
  if (!root || !fs.existsSync(root) || result.length >= 40) return result;
  let entries = [];
  try { entries = await fsp.readdir(root, { withFileTypes: true }); } catch { return result; }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) await findMatchingFiles(fullPath, pattern, result);
    else if (entry.isFile() && pattern.test(entry.name)) result.push(fullPath);
    if (result.length >= 40) break;
  }
  return result;
}

function systemRow(name, category, ok, status, detail, configuredPath = null, scope = 'global') {
  return { id: `auto-${safeId(name)}`, name, category, ok, status, detail, path: configuredPath, scope, autoDetected: true };
}

async function getSystemInventory(project, force = false) {
  if (force || !systemCache || Date.now() - systemCacheAt > 60000) {
    const graphifyCommand = fs.existsSync(GRAPHIFY_PYTHON) ? GRAPHIFY_PYTHON : 'python.exe';
    const [codex, claude, hermes, ollama, graphify, node, uv, gh, git, mcp] = await Promise.all([
      commandSummary('codex.exe', ['--version']), commandSummary('claude.exe', ['--version']),
      commandSummary('hermes.exe', ['--version']), commandSummary('ollama.exe', ['--version']),
      commandSummary(graphifyCommand, ['-m', 'graphify', '--version']), commandSummary('node.exe', ['--version']),
      commandSummary('uv.exe', ['--version']), commandSummary('gh.exe', ['--version']), commandSummary('git.exe', ['--version']), mcpSummary(),
    ]);
    let ollamaModels = '';
    if (ollama.ok) {
      const result = await execFileAsync('ollama.exe', ['list']);
      ollamaModels = result.stdout.split(/\r?\n/).slice(1).filter(Boolean).map((line) => line.trim().split(/\s{2,}/)[0]).join(', ');
    }
    let comfySettings = null;
    let comfyCloud = false;
    if (fs.existsSync(COMFY_SETTINGS)) {
      try { comfySettings = JSON.parse(await fsp.readFile(COMFY_SETTINGS, 'utf8')); } catch { comfySettings = null; }
      const installationsPath = path.join(path.dirname(COMFY_SETTINGS), 'installations.json');
      if (fs.existsSync(installationsPath)) {
        try { comfyCloud = JSON.parse(await fsp.readFile(installationsPath, 'utf8')).some((entry) => entry.sourceId === 'cloud' && entry.status === 'installed'); } catch { comfyCloud = false; }
      }
    }
    const modelRoots = Array.isArray(comfySettings?.modelsDirs) ? comfySettings.modelsDirs : [];
    const fluxFiles = [];
    for (const root of modelRoots) await findMatchingFiles(root, /flux|schnell|flux1|flux2/i, fluxFiles);
    systemCache = [
      systemRow('Codex CLI', 'KI-Agent', codex.ok, codex.ok ? 'installiert' : 'fehlt', codex.text),
      systemRow('Claude Code', 'KI-Agent', claude.ok, claude.ok ? 'installiert' : 'fehlt', claude.text),
      systemRow('Hermes Agent', 'Orchestrierung', hermes.ok, hermes.ok ? 'installiert' : 'fehlt', hermes.text),
      systemRow('Ollama', 'Lokale KI', ollama.ok, ollama.ok ? 'bereit' : 'fehlt', ollamaModels || ollama.text),
      systemRow('Graphify', 'Kontext', graphify.ok, graphify.ok ? 'installiert' : 'fehlt', graphify.text),
      systemRow('Obsidian', 'Wissen', fs.existsSync(OBSIDIAN_VAULT), fs.existsSync(OBSIDIAN_VAULT) ? 'konfiguriert' : 'fehlt', OBSIDIAN_VAULT, OBSIDIAN_VAULT),
      systemRow('ECC', 'Kontext', fs.existsSync(ECC_ROOT), fs.existsSync(ECC_ROOT) ? 'installiert' : 'fehlt', ECC_ROOT, ECC_ROOT),
      systemRow('MCP', 'Werkzeugverbindung', mcp.ok, mcp.ok ? 'aktiv' : 'nicht aktiv', mcp.text),
      systemRow('CC Switch', 'Provider', fs.existsSync(CC_SWITCH_EXE), fs.existsSync(CC_SWITCH_EXE) ? 'installiert' : 'fehlt', CC_SWITCH_EXE, CC_SWITCH_EXE),
      systemRow('Comfy Desktop', 'Bildgenerierung', fs.existsSync(COMFY_EXE), fs.existsSync(COMFY_EXE) ? 'installiert' : 'fehlt', fs.existsSync(COMFY_EXE) ? COMFY_EXE : 'Nicht gefunden', COMFY_EXE),
      systemRow('Comfy Cloud', 'Bildgenerierung', comfyCloud, comfyCloud ? 'konfiguriert' : 'nicht konfiguriert', comfyCloud ? 'Comfy-Cloud-Installation erkannt; wird vom Dashboard nicht automatisch verwendet' : 'Keine aktive Cloud-Installation'),
      systemRow('Flux lokal', 'Bildmodell', fluxFiles.length > 0, fluxFiles.length > 0 ? 'vorhanden' : 'nicht vorhanden', fluxFiles.length ? fluxFiles.join(', ') : 'Keine Flux-Modelldateien in den konfigurierten ComfyUI-Modellordnern', fluxFiles[0] || null),
      systemRow('GitHub CLI', 'Entwicklung', gh.ok, gh.ok ? 'installiert' : 'fehlt', gh.text),
      systemRow('Git', 'Entwicklung', git.ok, git.ok ? 'installiert' : 'fehlt', git.text),
      systemRow('Node.js', 'Runtime', node.ok, node.ok ? 'installiert' : 'fehlt', node.text),
      systemRow('uv', 'Runtime', uv.ok, uv.ok ? 'installiert' : 'fehlt', uv.text),
    ];
    systemCacheAt = Date.now();
  }
  const registered = (await loadSystems()).systems
    .filter((system) => system.scope === 'global' || system.projectId === project.id)
    .map((system) => ({ ...system, category: system.type, ok: fs.existsSync(system.path), status: fs.existsSync(system.path) ? 'registriert' : 'Pfad fehlt', detail: system.note || system.path, autoDetected: false }));
  const projectSystems = [
    systemRow(`${project.name} Repository`, 'Projekt', fs.existsSync(project.repository), 'projektspezifisch', project.repository, project.repository, 'project'),
    systemRow(`${project.name} Graphify`, 'Projektkontext', fs.existsSync(project.graphPath), fs.existsSync(project.graphPath) ? 'verbunden' : 'Graph fehlt', project.graphPath, project.graphPath, 'project'),
    systemRow(`${project.name} Obsidian`, 'Projektwissen', fs.existsSync(project.obsidianPath), fs.existsSync(project.obsidianPath) ? 'verbunden' : 'Bereich fehlt', project.obsidianPath, project.obsidianPath, 'project'),
    systemRow(`${project.name} AGENTS.md`, 'Projektregeln', fs.existsSync(path.join(project.repository, 'AGENTS.md')), fs.existsSync(path.join(project.repository, 'AGENTS.md')) ? 'vorhanden' : 'fehlt', path.join(project.repository, 'AGENTS.md'), path.join(project.repository, 'AGENTS.md'), 'project'),
  ];
  return { global: [...systemCache, ...registered.filter((system) => system.scope === 'global')], project: [...projectSystems, ...registered.filter((system) => system.scope === 'project')] };
}

function snapshotJob(job) {
  return {
    id: job.id, kind: job.kind || 'task', phase: job.phase || null,
    projectId: job.projectId, projectName: job.projectName,
    status: job.status, provider: job.provider, mode: job.mode,
    workingDirectory: job.workingDirectory, taskPreview: job.taskPreview,
    createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt,
    exitCode: job.exitCode, runDirectory: job.runDirectory, pid: job.pid,
    stdout: job.stdout, stderr: job.stderr,
  };
}

function appendLog(job, key, chunk) {
  const text = chunk.toString('utf8');
  job[key] = (job[key] + text).slice(-MAX_JOB_LOG_CHARS);
  const events = [...text.matchAll(/AI_EVENT\s+provider=([^\s]+)\s+state=([^\s]+)/g)];
  if (events.length) {
    const latest = events[events.length - 1];
    job.phase = `${latest[1]} · ${latest[2]}`;
  }
}

function projectPathFromChat(task) {
  if (!/(?:projekt|repo(?:sitory)?).*(?:hinzuf(?:ü|u)gen|registrieren)|(?:hinzuf(?:ü|u)gen|registrieren).*(?:projekt|repo(?:sitory)?)/i.test(task)) return null;
  const match = task.match(/(?:"([A-Za-z]:\\[^"]+)"|([A-Za-z]:\\[^\s\r\n]+))/);
  if (!match) return null;
  return (match[1] || match[2]).replace(/[.!?]+$/, '').trim();
}

async function registerProjectFromChat(task) {
  const repository = projectPathFromChat(task);
  if (!repository) return null;
  const name = path.basename(repository);
  return addProject({ name, repository });
}

async function createTaskWorktree(project, task, id) {
  const branch = `ai/${safeId(task).slice(0, 28)}-${id.slice(0, 8)}`;
  const workingDirectory = path.join(WORKTREE_ROOT, safeId(project.name), `${new Date().toISOString().replace(/[:.]/g, '-')}-${id.slice(0, 8)}`);
  await fsp.mkdir(path.dirname(workingDirectory), { recursive: true });
  const result = await execFileAsync('git.exe', ['-C', project.repository, 'worktree', 'add', '-b', branch, workingDirectory, 'HEAD'], { timeout: 60000 });
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || 'Automatic task worktree creation failed.');
  return { workingDirectory, branch };
}

async function startTask(payload) {
  const { project } = await getProject(String(payload.projectId || ''));
  const task = String(payload.task || '').trim();
  const provider = String(payload.provider || 'Auto');
  const mode = String(payload.mode || 'ReadOnly');
  const useSubscriptionTokens = payload.useSubscriptionTokens !== false;
  if (!task || task.length > 200000) throw new Error('Task text must contain between 1 and 200,000 characters.');
  if (!['Auto', 'Codex', 'Claude', 'Ollama'].includes(provider)) throw new Error('Unknown provider selection.');
  if (!['ReadOnly', 'Write'].includes(mode)) throw new Error('Unknown execution mode.');

  const registeredProject = await registerProjectFromChat(task);
  if (registeredProject) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const job = {
      id, kind: 'dashboard-command', phase: 'knowledge setup', projectId: registeredProject.id, projectName: registeredProject.name,
      status: 'running', provider: 'Dashboard', mode: 'Write', workingDirectory: registeredProject.repository,
      taskPreview: task.slice(0, 160), createdAt: now, startedAt: now, finishedAt: null, exitCode: null,
      runDirectory: null, pid: null, stdout: 'Projekt ' + registeredProject.name + ' wurde registriert. Obsidian ist verbunden.\n', stderr: '', child: null,
    };
    jobs.set(id, job);
    (async () => {
      try {
        if (!fs.existsSync(registeredProject.graphPath)) {
          emitJob(job, 'graphify', 'Graphify-Index wird lokal mit Ollama aufgebaut');
          const graphifyCommand = fs.existsSync(GRAPHIFY_PYTHON) ? GRAPHIFY_PYTHON : 'python.exe';
          await runStreamingCommand(job, graphifyCommand, ['-m', 'graphify', 'extract', registeredProject.repository, '--backend', 'ollama', '--model', 'polis-coder', '--max-concurrency', '1', '--out', registeredProject.repository], registeredProject.repository, 'graphify');
        }
        job.phase = 'complete'; job.status = 'completed'; job.exitCode = 0; job.finishedAt = new Date().toISOString();
        emitJob(job, 'complete', 'Projekt, Graphify und Obsidian sind verbunden');
      } catch (error) {
        job.status = 'failed'; job.exitCode = 1; job.finishedAt = new Date().toISOString();
        appendLog(job, 'stderr', error.message + '\nDas Projekt bleibt registriert; Graphify kann später erneut aufgebaut werden.\n');
      }
    })();
    return snapshotJob(job);
  }

  await fsp.mkdir(TASK_ROOT, { recursive: true });
  const memory = await loadMemory(project.id);
  const memoryText = memory.notes.slice(0, 12).map((note) => `- ${note.text}`).join('\n') || '- No reviewed learning notes yet.';
  const registeredSystems = (await loadSystems()).systems.filter((system) => system.scope === 'global' || system.projectId === project.id);
  const systemText = registeredSystems.map((system) => `- ${system.name} (${system.type}): ${system.path}${system.note ? ` — ${system.note}` : ''}`).join('\n') || '- No additional systems registered for agent use.';
  const id = randomUUID();
  const worktree = mode === 'Write' ? await createTaskWorktree(project, task, id) : { workingDirectory: project.repository, branch: null };
  const workingDirectory = worktree.workingDirectory;
  const taskPath = path.join(TASK_ROOT, `${id}.md`);
  const taskPackage = `# Dashboard Task\n\nCreated: ${new Date().toISOString()}\nProject-ID: ${project.id}\nProject: ${project.name}\nRepository: ${project.repository}\nProvider request: ${provider}\nUse subscription tokens: ${useSubscriptionTokens}\nMode: ${mode}\nWorking directory: ${workingDirectory}\nTask branch: ${worktree.branch || 'none (read-only)'}\nGraphify: ${project.graphPath}\nObsidian: ${project.obsidianPath}\n\n## Reviewed project memory\n\n${memoryText}\n\n## Registered systems\n\n${systemText}\n\n## Goal\n\n${task}\n`;
  await fsp.writeFile(taskPath, taskPackage, 'utf8');

  const args = [
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', TASK_SCRIPT,
    '-TaskFile', taskPath, '-WorkingDirectory', workingDirectory,
    '-ProjectName', project.name, '-Provider', provider, '-Mode', mode, '-RunRoot', RUN_ROOT,
  ];
  if (!useSubscriptionTokens) args.push('-LocalOnly');
  const child = spawn('pwsh.exe', args, { cwd: workingDirectory, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  const job = {
    id, kind: 'task', phase: 'routing', projectId: project.id, projectName: project.name, status: 'running', provider, mode,
    workingDirectory, taskPreview: task.slice(0, 160), taskPath,
    createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), finishedAt: null,
    exitCode: null, runDirectory: null, pid: child.pid, stdout: '', stderr: '', child,
  };
  jobs.set(id, job);
  child.stdout.on('data', (chunk) => appendLog(job, 'stdout', chunk));
  child.stderr.on('data', (chunk) => appendLog(job, 'stderr', chunk));
  child.on('error', (error) => {
    job.status = 'failed'; job.finishedAt = new Date().toISOString(); appendLog(job, 'stderr', error.message);
  });
  child.on('close', (code) => {
    job.exitCode = code; job.finishedAt = new Date().toISOString();
    job.status = code === 0 ? 'completed' : job.status === 'stopping' ? 'stopped' : 'failed';
    const match = job.stdout.match(/AI_PROJECT_ROUTER_OK\s+provider=([^\s]+)\s+run=(.+)/);
    if (match) { job.provider = match[1]; job.runDirectory = match[2].trim(); }
    job.child = null; statusCacheAt = 0;
  });
  return snapshotJob(job);
}

function emitJob(job, phase, message) {
  job.phase = phase;
  appendLog(job, 'stdout', `[${new Date().toISOString()}] ${message}\n`);
}

function runStreamingCommand(job, command, args, cwd, label) {
  return new Promise((resolve, reject) => {
    emitJob(job, label, `${label} gestartet`);
    const child = spawn(command, args, { cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    job.pid = child.pid; job.child = child;
    child.stdout.on('data', (chunk) => appendLog(job, 'stdout', `[${label}] ${chunk.toString('utf8')}`));
    child.stderr.on('data', (chunk) => appendLog(job, 'stderr', `[${label}] ${chunk.toString('utf8')}`));
    child.on('error', reject);
    child.on('close', (code) => {
      job.child = null; job.pid = null;
      if (code === 0) { emitJob(job, label, `${label} abgeschlossen`); resolve(); }
      else reject(new Error(`${label} failed with exit code ${code}.`));
    });
  });
}

async function provisionProject(payload) {
  const name = String(payload.name || '').trim();
  const slug = safeId(payload.slug || name);
  const parentDirectory = path.resolve(String(payload.parentDirectory || path.join(HOME, 'Documents', 'Projects')).trim());
  const repository = path.join(parentDirectory, slug);
  const createGitHub = Boolean(payload.createGitHub);
  const visibility = payload.visibility === 'public' ? 'public' : 'private';
  const description = String(payload.description || '').trim().slice(0, 300);
  if (!name || name.length > 80) throw new Error('Project name must contain between 1 and 80 characters.');
  if (!fs.existsSync(parentDirectory) || !fs.statSync(parentDirectory).isDirectory()) throw new Error('Parent directory does not exist.');
  if (fs.existsSync(repository)) throw new Error('Target project directory already exists.');

  const id = randomUUID();
  const job = {
    id, kind: 'provision', phase: 'queued', projectId: null, projectName: name, status: 'running', provider: 'Local setup', mode: 'Write',
    workingDirectory: repository, taskPreview: `Create project ${name}`, createdAt: new Date().toISOString(), startedAt: new Date().toISOString(),
    finishedAt: null, exitCode: null, runDirectory: null, pid: null, stdout: '', stderr: '', child: null,
  };
  jobs.set(id, job);

  (async () => {
    try {
      emitJob(job, 'filesystem', `Projektordner wird erstellt: ${repository}`);
      await fsp.mkdir(path.join(repository, 'Docs'), { recursive: true });
      const readme = `# ${name}\n\n${description || 'Project initialized by AI Project Control.'}\n`;
      const agents = `# Agent Instructions\n\n1. Read README.md and Docs/CURRENT_TASK.md before project work.\n2. Treat Git and repository files as the source of truth.\n3. Use Graphify for discovery, then read relevant original files.\n4. Use Obsidian as working memory, not as competing official documentation.\n5. Keep code modular and document architectural changes.\n6. Do not add paid services or API-key billing without explicit owner approval.\n7. Do not commit, push or merge unless the owner explicitly requests it.\n`;
      const gitignore = `graphify-out/\n.env\n.env.*\nnode_modules/\n__pycache__/\n`;
      await Promise.all([
        fsp.writeFile(path.join(repository, 'README.md'), readme, 'utf8'),
        fsp.writeFile(path.join(repository, 'AGENTS.md'), agents, 'utf8'),
        fsp.writeFile(path.join(repository, '.gitignore'), gitignore, 'utf8'),
        fsp.writeFile(path.join(repository, 'Docs', 'CURRENT_TASK.md'), '# Current Task\n\nNo active task yet.\n', 'utf8'),
        fsp.writeFile(path.join(repository, 'Docs', 'ARCHITECTURE.md'), '# Architecture\n\nDocument system boundaries and ownership here.\n', 'utf8'),
        fsp.writeFile(path.join(repository, 'Docs', 'CHANGELOG.md'), '# Changelog\n\n## Initial setup\n\n- Project created by AI Project Control.\n', 'utf8'),
        fsp.writeFile(path.join(repository, 'Docs', 'DECISION_LOG.md'), '# Decision Log\n\nRecord permanent decisions and supersessions here.\n', 'utf8'),
      ]);
      await runStreamingCommand(job, 'git.exe', ['init', '-b', 'main'], repository, 'git init');
      await runStreamingCommand(job, 'git.exe', ['add', '.'], repository, 'git add');
      await runStreamingCommand(job, 'git.exe', ['commit', '-m', 'Initial project setup'], repository, 'initial commit');

      const obsidianPath = path.join(OBSIDIAN_VAULT, '10 Projects', name);
      emitJob(job, 'obsidian', `Obsidian-Bereich wird erstellt: ${obsidianPath}`);
      for (const directory of ['Working Notes', 'Research', 'Design Drafts', 'Review Notes', 'Prompt Library', 'Lessons Learned', 'AI Runs']) {
        await fsp.mkdir(path.join(obsidianPath, directory), { recursive: true });
      }
      await fsp.writeFile(path.join(obsidianPath, `${name} Dashboard.md`), `---\ntitle: ${name} Dashboard\ntags:\n  - project\n  - active\n---\n\n# ${name} Dashboard\n\n> [!important] Source of truth\n> Official project information remains in the Git repository. This area contains working knowledge only.\n\n- Repository: ${repository}\n- Agent rules: ${path.join(repository, 'AGENTS.md')}\n- Current task: ${path.join(repository, 'Docs', 'CURRENT_TASK.md')}\n- Architecture: ${path.join(repository, 'Docs', 'ARCHITECTURE.md')}\n- Changelog: ${path.join(repository, 'Docs', 'CHANGELOG.md')}\n\n## Workspace\n\n- [[Working Notes]]\n- [[Research]]\n- [[Review Notes]]\n- [[Lessons Learned]]\n`, 'utf8');

      const graphPath = path.join(repository, 'graphify-out', 'graph.json');
      emitJob(job, 'graphify', 'Lokaler Graphify-Index wird mit Ollama aufgebaut');
      await runStreamingCommand(job, GRAPHIFY_PYTHON, ['-m', 'graphify', 'extract', repository, '--backend', 'ollama', '--model', 'polis-coder', '--max-concurrency', '1', '--out', repository], repository, 'graphify');

      if (createGitHub) {
        emitJob(job, 'github', `GitHub-Repository wird ${visibility} erstellt`);
        const ghArgs = ['repo', 'create', slug, `--${visibility}`, '--source', repository, '--remote', 'origin', '--push'];
        if (description) ghArgs.push('--description', description);
        await runStreamingCommand(job, 'gh.exe', ghArgs, repository, 'github');
      }

      const project = await addProject({ name, repository, graphPath, obsidianPath });
      job.projectId = project.id; job.phase = 'complete'; job.status = 'completed'; job.exitCode = 0; job.finishedAt = new Date().toISOString();
      emitJob(job, 'complete', `${name} ist registriert und einsatzbereit`);
    } catch (error) {
      job.status = 'failed'; job.exitCode = 1; job.finishedAt = new Date().toISOString();
      appendLog(job, 'stderr', `${error.message}\nBestehende Dateien wurden zur Diagnose nicht gelöscht.\n`);
    }
  })();
  return snapshotJob(job);
}

async function stopJob(id) {
  const job = jobs.get(id);
  if (!job || job.status !== 'running' || !job.pid) throw new Error('Running job not found.');
  job.status = 'stopping';
  const result = await execFileAsync('taskkill.exe', ['/PID', String(job.pid), '/T', '/F'], { timeout: 15000 });
  if (result.exitCode !== 0) { job.status = 'running'; throw new Error(result.stderr.trim() || 'Could not stop the job.'); }
  return snapshotJob(job);
}

async function readBounded(filePath, maxBytes = MAX_KNOWLEDGE_FILE_BYTES) {
  const stat = await fsp.stat(filePath);
  const handle = await fsp.open(filePath, 'r');
  try {
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

function runProjectId(taskPackage) {
  const match = taskPackage.match(/^Project-ID:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

function extractGoal(taskPackage) {
  const marker = taskPackage.indexOf('## Goal');
  return marker >= 0 ? taskPackage.slice(marker + 7).trim() : taskPackage.trim();
}

function friendlyOutput(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed.result === 'string') return parsed.result;
    if (typeof parsed.message === 'string') return parsed.message;
  } catch {}
  const messages = [];
  for (const line of text.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      const candidate = event.item?.content || event.item?.text || event.message?.content || event.message;
      if (typeof candidate === 'string') messages.push(candidate);
    } catch {}
  }
  return (messages.length ? messages.join('\n\n') : text).slice(-120000);
}

async function runRecord(directory, projectId) {
  const taskPath = path.join(directory, 'task-package.md');
  let taskPackage = '';
  if (fs.existsSync(taskPath)) taskPackage = await readBounded(taskPath);
  const taggedProject = runProjectId(taskPackage);
  if (taggedProject && taggedProject !== projectId) return null;
  if (!taggedProject && projectId !== 'polis') return null;
  const stat = await fsp.stat(directory);
  let result = null;
  const resultPath = path.join(directory, 'routing-result.json');
  if (fs.existsSync(resultPath)) {
    try { result = JSON.parse(await fsp.readFile(resultPath, 'utf8')); } catch { result = null; }
  }
  const attemptDirectories = (await fsp.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('attempt-'))
    .map((entry) => path.join(directory, entry.name)).sort();
  let responseText = '';
  if (attemptDirectories.length) {
    const outputPath = path.join(attemptDirectories[attemptDirectories.length - 1], 'stdout.log');
    if (fs.existsSync(outputPath)) responseText = friendlyOutput(await readBounded(outputPath, 2 * 1024 * 1024));
  }
  if (!responseText) {
    for (const fallbackName of ['final-summary.md', 'codex-output.md', 'reviewer-output.md']) {
      const fallbackPath = path.join(directory, fallbackName);
      if (fs.existsSync(fallbackPath)) {
        responseText = await readBounded(fallbackPath);
        break;
      }
    }
  }
  return {
    name: path.basename(directory), path: directory, modifiedAt: stat.mtime.toISOString(),
    status: result ? result.status : 'external', provider: result ? result.selected_provider || null : null,
    mode: result?.mode || null, task: extractGoal(taskPackage), response: responseText,
  };
}

async function listRuns(projectId) {
  if (!fs.existsSync(RUN_ROOT)) return [];
  const entries = await fsp.readdir(RUN_ROOT, { withFileTypes: true });
  const records = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => runRecord(path.join(RUN_ROOT, entry.name), projectId)));
  return records.filter(Boolean).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)).slice(0, 40);
}

function endpointId(value) {
  return typeof value === 'object' && value ? String(value.id || value.label || '') : String(value || '');
}

async function getGraph(project, query) {
  if (!fs.existsSync(project.graphPath)) throw new Error('Graphify graph does not exist for this project.');
  const stat = await fsp.stat(project.graphPath);
  if (stat.size > 50 * 1024 * 1024) throw new Error('Graph is larger than the dashboard safety limit.');
  const graph = JSON.parse(await fsp.readFile(project.graphPath, 'utf8'));
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const links = Array.isArray(graph.links) ? graph.links : [];
  const degree = new Map(nodes.map((node) => [String(node.id), 0]));
  for (const link of links) {
    const source = endpointId(link.source); const target = endpointId(link.target);
    degree.set(source, (degree.get(source) || 0) + 1); degree.set(target, (degree.get(target) || 0) + 1);
  }
  const needle = String(query || '').trim().toLowerCase();
  let selectedNodes = nodes;
  if (needle) {
    const matches = nodes.filter((node) => `${node.label || ''} ${node.source_file || ''} ${node.community_name || ''}`.toLowerCase().includes(needle)).slice(0, 120);
    const selectedIds = new Set(matches.map((node) => String(node.id)));
    for (const link of links) {
      const source = endpointId(link.source); const target = endpointId(link.target);
      if (selectedIds.has(source)) selectedIds.add(target);
      if (selectedIds.has(target)) selectedIds.add(source);
      if (selectedIds.size >= 250) break;
    }
    selectedNodes = nodes.filter((node) => selectedIds.has(String(node.id)));
  } else if (nodes.length > 300) {
    selectedNodes = [...nodes].sort((a, b) => (degree.get(String(b.id)) || 0) - (degree.get(String(a.id)) || 0)).slice(0, 300);
  }
  const selectedIds = new Set(selectedNodes.map((node) => String(node.id)));
  const selectedLinks = links.filter((link) => selectedIds.has(endpointId(link.source)) && selectedIds.has(endpointId(link.target))).slice(0, 1200);
  return {
    builtAtCommit: graph.built_at_commit || null,
    totals: { nodes: nodes.length, links: links.length },
    truncated: selectedNodes.length < nodes.length,
    nodes: selectedNodes.map((node) => ({
      id: String(node.id), label: String(node.label || node.id), type: String(node.file_type || ''),
      sourceFile: String(node.source_file || ''), sourceLocation: String(node.source_location || ''),
      community: String(node.community_name || node.community || ''), degree: degree.get(String(node.id)) || 0,
    })),
    links: selectedLinks.map((link) => ({ source: endpointId(link.source), target: endpointId(link.target), relation: String(link.relation || '') })),
  };
}

async function walkMarkdown(root, current = root, result = []) {
  if (result.length >= 1500) return result;
  const entries = await fsp.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) await walkMarkdown(root, fullPath, result);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) result.push(path.relative(root, fullPath));
    if (result.length >= 1500) break;
  }
  return result;
}

function withinRoot(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function getObsidian(project, query, selectedFile) {
  if (!fs.existsSync(project.obsidianPath)) throw new Error('Obsidian project area does not exist.');
  const files = await walkMarkdown(project.obsidianPath);
  const needle = String(query || '').trim().toLowerCase();
  const filtered = [];
  for (const relative of files) {
    if (!needle || relative.toLowerCase().includes(needle)) {
      filtered.push(relative);
    } else if (filtered.length < 100) {
      const content = await readBounded(path.join(project.obsidianPath, relative), 96 * 1024);
      if (content.toLowerCase().includes(needle)) filtered.push(relative);
    }
    if (filtered.length >= 100) break;
  }
  let note = null;
  if (selectedFile) {
    const candidate = path.resolve(project.obsidianPath, String(selectedFile));
    if (!withinRoot(project.obsidianPath, candidate) || !fs.existsSync(candidate) || path.extname(candidate).toLowerCase() !== '.md') {
      throw new Error('Requested note is outside the configured Obsidian project area.');
    }
    note = { path: path.relative(project.obsidianPath, candidate), content: await readBounded(candidate) };
  }
  return { root: project.obsidianPath, files: filtered, total: files.length, note };
}

async function openRun(runPath) {
  const resolved = path.resolve(String(runPath || ''));
  if (!withinRoot(RUN_ROOT, resolved) || resolved === path.resolve(RUN_ROOT) || !fs.existsSync(resolved)) throw new Error('Run path is outside the allowed AI-Runs directory.');
  const child = spawn('explorer.exe', [resolved], { detached: true, windowsHide: false, stdio: 'ignore' });
  child.unref();
}

async function serveStatic(requestPath, response) {
  const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const resolved = path.resolve(PUBLIC_ROOT, relative);
  if (!withinRoot(PUBLIC_ROOT, resolved) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    sendError(response, 404, 'Not found'); return;
  }
  const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8' }[path.extname(resolved).toLowerCase()] || 'application/octet-stream';
  const body = await fsp.readFile(resolved);
  response.writeHead(200, {
    'Content-Type': mime, 'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  });
  response.end(body);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${HOST}:${PORT}`);
    if (request.method === 'GET' && url.pathname === '/api/health') return sendJson(response, 200, { status: 'ok', pid: process.pid, host: HOST, port: PORT });
    if (request.method === 'GET' && url.pathname === '/api/projects') return sendJson(response, 200, await loadProjects());
    if (request.method === 'POST' && url.pathname === '/api/projects') return sendJson(response, 201, await addProject(await readJsonBody(request)));
    const selectMatch = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/select$/);
    if (request.method === 'POST' && selectMatch) return sendJson(response, 200, await selectProject(selectMatch[1]));
    const projectMatch = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)$/);
    if (request.method === 'DELETE' && projectMatch) return sendJson(response, 200, await removeProject(projectMatch[1]));
    const projectId = url.searchParams.get('projectId');
    if (request.method === 'GET' && url.pathname === '/api/status') return sendJson(response, 200, await getProviderStatus(url.searchParams.get('force') === '1'));
    if (request.method === 'GET' && url.pathname === '/api/components') {
      const { project } = await getProject(projectId); return sendJson(response, 200, await getComponents(project, url.searchParams.get('force') === '1'));
    }
    if (request.method === 'GET' && url.pathname === '/api/systems') {
      const { project } = await getProject(projectId); return sendJson(response, 200, await getSystemInventory(project, url.searchParams.get('force') === '1'));
    }
    if (request.method === 'POST' && url.pathname === '/api/systems') return sendJson(response, 201, await addSystem(await readJsonBody(request)));
    const systemMatch = url.pathname.match(/^\/api\/systems\/([a-f0-9-]+)$/);
    if (request.method === 'DELETE' && systemMatch) return sendJson(response, 200, await removeSystem(systemMatch[1]));
    if (request.method === 'GET' && url.pathname === '/api/memory') {
      const { project } = await getProject(projectId); return sendJson(response, 200, await loadMemory(project.id));
    }
    if (request.method === 'POST' && url.pathname === '/api/memory') {
      const body = await readJsonBody(request); const { project } = await getProject(body.projectId); return sendJson(response, 201, await addMemory(project, body));
    }
    if (request.method === 'GET' && url.pathname === '/api/graph') {
      const { project } = await getProject(projectId); return sendJson(response, 200, await getGraph(project, url.searchParams.get('q')));
    }
    if (request.method === 'GET' && url.pathname === '/api/obsidian') {
      const { project } = await getProject(projectId); return sendJson(response, 200, await getObsidian(project, url.searchParams.get('q'), url.searchParams.get('file')));
    }
    if (request.method === 'GET' && url.pathname === '/api/jobs') {
      const rows = Array.from(jobs.values()).map(snapshotJob).filter((job) => !projectId || job.projectId === projectId || job.kind === 'provision' || job.kind === 'dashboard-command').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return sendJson(response, 200, rows);
    }
    if (request.method === 'GET' && url.pathname === '/api/runs') {
      const { project } = await getProject(projectId); return sendJson(response, 200, await listRuns(project.id));
    }
    if (request.method === 'GET' && url.pathname === '/api/config') return sendJson(response, 200, { runRoot: RUN_ROOT, worktreeRoot: WORKTREE_ROOT, routerRoot: ROUTER_ROOT, dataRoot: DATA_ROOT, obsidianVault: OBSIDIAN_VAULT, defaultProjectParent: fs.existsSync('C:\\Repos') ? 'C:\\Repos' : path.join(HOME, 'Documents', 'Projects') });
    if (request.method === 'POST' && url.pathname === '/api/tasks') return sendJson(response, 202, await startTask(await readJsonBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/projects/provision') return sendJson(response, 202, await provisionProject(await readJsonBody(request)));
    const stopMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)\/stop$/);
    if (request.method === 'POST' && stopMatch) return sendJson(response, 200, await stopJob(stopMatch[1]));
    if (request.method === 'POST' && url.pathname === '/api/open-run') {
      const body = await readJsonBody(request); await openRun(body.path); return sendJson(response, 200, { status: 'opened' });
    }
    if (request.method === 'GET' && !url.pathname.startsWith('/api/')) return serveStatic(url.pathname, response);
    sendError(response, 404, 'Not found');
  } catch (error) {
    sendError(response, 400, error.message || 'Request failed');
  }
});

server.listen(PORT, HOST, async () => {
  await fsp.mkdir(RUN_ROOT, { recursive: true });
  await loadProjects();
  process.stdout.write(`AI_PROJECT_CONTROL_READY http://${HOST}:${PORT}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
