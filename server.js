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
const GIT_DRAFTS_PATH = path.join(DATA_ROOT, 'git-drafts.json');
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
const SYSTEM_CATALOG_PATH = path.join(__dirname, 'config', 'systems.json');
const CODEX_CONFIG_PATH = path.join(HOME, '.codex', 'config.toml');
const CODEX_MODEL_CACHE_PATH = path.join(HOME, '.codex', 'models_cache.json');
const PROVIDER_NAMES = ['Codex', 'Claude', 'Ollama'];
const DEFAULT_PROVIDER_ORDER = ['Codex', 'Claude', 'Ollama'];
const SAFE_MODEL_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/;
const MAX_BODY_BYTES = 24 * 1024 * 1024;
const MAX_JOB_LOG_CHARS = 2 * 1024 * 1024;
const MAX_KNOWLEDGE_FILE_BYTES = 512 * 1024;
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES = 15 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Map([
  ['image/png', '.png'], ['image/jpeg', '.jpg'], ['image/webp', '.webp'], ['image/gif', '.gif'],
]);
const GIT_IMAGE_TYPES = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.gif', 'image/gif'],
]);
const MAX_GIT_IMAGE_BYTES = 20 * 1024 * 1024;
const jobs = new Map();
const liveClients = new Set();
let statusCache = null;
let statusCacheAt = 0;
const componentCache = new Map();
let systemCache = null;
let systemCacheAt = 0;
let providerModelCache = null;
let providerModelCacheAt = 0;
let gitDraftWriteChain = Promise.resolve();

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

function safeAttachmentName(value, index, mime) {
  const extension = IMAGE_EXTENSIONS.get(mime);
  const original = path.basename(String(value || `image-${index + 1}`));
  const stem = original.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || `image-${index + 1}`;
  return `${String(index + 1).padStart(2, '0')}-${stem}${extension}`;
}

async function saveTaskAttachments(taskId, values) {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) throw new Error('Attachments must be a list.');
  if (values.length > MAX_ATTACHMENTS) throw new Error(`No more than ${MAX_ATTACHMENTS} images may be attached.`);
  const prepared = [];
  let totalBytes = 0;
  for (let index = 0; index < values.length; index += 1) {
    const attachment = values[index] || {};
    const mime = String(attachment.type || '').toLowerCase();
    if (!IMAGE_EXTENSIONS.has(mime)) throw new Error('Only PNG, JPEG, WebP and GIF images are supported.');
    const match = String(attachment.dataUrl || '').match(/^data:([^;,]+);base64,([a-zA-Z0-9+/=\r\n]+)$/);
    if (!match || match[1].toLowerCase() !== mime) throw new Error('An attachment contains invalid image data.');
    const data = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    if (!data.length || data.length > MAX_ATTACHMENT_BYTES) throw new Error('Each image must be between 1 byte and 5 MB.');
    totalBytes += data.length;
    if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) throw new Error('Attached images exceed the 15 MB total limit.');
    prepared.push({ name: String(attachment.name || `image-${index + 1}`).slice(0, 160), file: safeAttachmentName(attachment.name, index, mime), type: mime, data });
  }
  if (!prepared.length) return [];
  const directory = path.join(TASK_ROOT, `${taskId}-attachments`);
  await fsp.mkdir(directory, { recursive: false });
  for (const attachment of prepared) await fsp.writeFile(path.join(directory, attachment.file), attachment.data, { flag: 'wx' });
  const manifest = prepared.map(({ name, file, type, data }) => ({ name, file, type, size: data.length }));
  await fsp.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return manifest.map((entry) => ({ ...entry, path: path.join(directory, entry.file), url: `/api/task-attachment?id=${encodeURIComponent(taskId)}&file=${encodeURIComponent(entry.file)}` }));
}

async function taskAttachmentsFromPackage(taskPackage) {
  const match = taskPackage.match(/^Attachment-ID:\s*([a-f0-9-]+)$/m);
  if (!match) return [];
  const taskId = match[1];
  const directory = path.join(TASK_ROOT, `${taskId}-attachments`);
  const manifestPath = path.join(directory, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return [];
  try {
    const manifest = await readJsonFile(manifestPath);
    return manifest.filter((entry) => IMAGE_EXTENSIONS.has(entry.type) && path.basename(entry.file) === entry.file).map((entry) => ({
      name: entry.name, type: entry.type, size: entry.size,
      url: `/api/task-attachment?id=${encodeURIComponent(taskId)}&file=${encodeURIComponent(entry.file)}`,
    }));
  } catch { return []; }
}

async function serveTaskAttachment(url, response) {
  const taskId = String(url.searchParams.get('id') || '');
  const file = String(url.searchParams.get('file') || '');
  if (!/^[a-f0-9-]{36}$/.test(taskId) || !file || path.basename(file) !== file) throw new Error('Invalid attachment path.');
  const directory = path.join(TASK_ROOT, `${taskId}-attachments`);
  const manifestPath = path.join(directory, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('Attachment not found.');
  const manifest = await readJsonFile(manifestPath);
  const entry = manifest.find((candidate) => candidate.file === file && IMAGE_EXTENSIONS.has(candidate.type));
  if (!entry) throw new Error('Attachment not found.');
  const filePath = path.join(directory, file);
  const data = await fsp.readFile(filePath);
  response.writeHead(200, {
    'Content-Type': entry.type, 'Content-Length': data.length, 'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `inline; filename="${file.replace(/"/g, '')}"`,
  });
  response.end(data);
}

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
        resolve({
          exitCode: error && Number.isInteger(error.code) ? error.code : error ? 1 : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        });
      });
    } catch (error) {
      resolve({ exitCode: 1, stdout: '', stderr: String(error?.message || error) });
    }
  });
}

async function getProviderModelCatalog(force = false) {
  if (!force && providerModelCache && Date.now() - providerModelCacheAt < 60000) return providerModelCache;

  let configuredCodexModel = null;
  if (fs.existsSync(CODEX_CONFIG_PATH)) {
    const source = await fsp.readFile(CODEX_CONFIG_PATH, 'utf8');
    configuredCodexModel = source.match(/^model\s*=\s*["']([^"']+)["']/m)?.[1] || null;
  }

  let codexModels = [];
  if (fs.existsSync(CODEX_MODEL_CACHE_PATH)) {
    try {
      const cache = await readJsonFile(CODEX_MODEL_CACHE_PATH);
      codexModels = (Array.isArray(cache.models) ? cache.models : [])
        .filter((model) => model.visibility === 'list' && SAFE_MODEL_NAME.test(String(model.slug || '')))
        .map((model) => ({ value: model.slug, label: model.display_name || model.slug }));
    } catch { codexModels = []; }
  }
  if (configuredCodexModel && SAFE_MODEL_NAME.test(configuredCodexModel) && !codexModels.some((model) => model.value === configuredCodexModel)) {
    codexModels.unshift({ value: configuredCodexModel, label: configuredCodexModel });
  }

  const ollamaResult = await execFileAsync('ollama.exe', ['list']);
  const ollamaModels = ollamaResult.exitCode === 0
    ? ollamaResult.stdout.split(/\r?\n/).slice(1).map((line) => line.trim().split(/\s{2,}/)[0]).filter((name) => SAFE_MODEL_NAME.test(name) && !/embed/i.test(name))
    : [];

  providerModelCache = {
    Codex: [{ value: 'default', label: configuredCodexModel ? `Standard (${configuredCodexModel})` : 'Codex-Standard' }, ...codexModels],
    Claude: [
      { value: 'default', label: 'Claude-Standard' },
      { value: 'sonnet', label: 'Sonnet' },
      { value: 'opus', label: 'Opus' },
      { value: 'haiku', label: 'Haiku' },
    ],
    Ollama: ollamaModels.map((model) => ({ value: model, label: model })),
  };
  providerModelCacheAt = Date.now();
  return providerModelCache;
}

function normalizeProviderOrder(value, legacyProvider = 'Auto') {
  const source = Array.isArray(value) ? value : legacyProvider === 'Auto' ? DEFAULT_PROVIDER_ORDER : [legacyProvider];
  const order = [];
  for (const item of source) {
    const provider = String(item || '');
    if (!PROVIDER_NAMES.includes(provider)) throw new Error(`Unknown provider in routing order: ${provider || '(empty)'}.`);
    if (!order.includes(provider)) order.push(provider);
  }
  if (!order.length) throw new Error('Select at least one provider.');
  return order;
}

function normalizeProviderModels(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const models = {};
  for (const provider of PROVIDER_NAMES) {
    const model = String(source[provider] || 'default');
    if (!SAFE_MODEL_NAME.test(model)) throw new Error(`Invalid model selection for ${provider}.`);
    models[provider] = model;
  }
  return models;
}

function parseJsonOutput(text) {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('Command returned no JSON object.');
  return JSON.parse(text.slice(start));
}

function stripAnsi(value) {
  return String(value || '').replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
}

async function readJsonFile(filePath) {
  const text = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(text.replace(/^\uFEFF/, ''));
}

function safeId(value) {
  const base = String(value || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return base || 'project';
}

function taskBranchSlug(task) {
  const text = String(task || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  const concepts = [];
  const addConcept = (name, pattern) => { if (pattern.test(text) && !concepts.includes(name)) concepts.push(name); };
  addConcept('branch-names', /branch(?:es|e)?[^\n.!?]{0,80}(?:titel|name)|(?:titel|name)[^\n.!?]{0,80}branch/);
  addConcept('commit-drafts', /commit[^\n.!?]{0,60}(?:nachricht|message|text|entwurf)|(?:nachricht|message|entwurf)[^\n.!?]{0,60}commit/);
  addConcept('chat-workspace', /chat|gespraech|conversation/);
  addConcept('live-progress', /live[- ]?feed|fortschritt|progress|stream/);
  addConcept('git-workflow', /\bgit\b|worktree|merge|push|pull request/);
  addConcept('knowledge-workspace', /graphify|obsidian|wissen|knowledge/);
  addConcept('provider-routing', /provider|codex|claude|ollama|hermes/);
  addConcept('responsive-ui', /responsive|bildschirm|viewport|skalier/);
  addConcept('image-support', /bild|image|screenshot|asset/);
  addConcept('documentation', /dokument|documentation|readme|changelog/);
  addConcept('tests', /\btest|validier|smoke|regression/);

  if (!concepts.length) {
    const stopWords = new Set([
      'aber', 'alle', 'alles', 'auch', 'bitte', 'dann', 'dass', 'dies', 'diese', 'diesem', 'dieser', 'eine', 'einen', 'einer',
      'etwas', 'fuer', 'gerne', 'habe', 'hier', 'ich', 'immer', 'kann', 'kannst', 'machen', 'meine', 'meinen', 'mir', 'moechte',
      'noch', 'oder', 'sind', 'soll', 'sollen', 'sollte', 'ueber', 'und', 'uns', 'unser', 'von', 'was', 'wenn', 'werden', 'wird',
      'with', 'this', 'that', 'from', 'into', 'please', 'should', 'would', 'could', 'have', 'will', 'your', 'the', 'and', 'for',
      'okay', 'gleich', 'direkt', 'zudem', 'ebenfalls', 'wichtig', 'momentan', 'jeweilig', 'jeweilige', 'jeweiligen',
      'ueberarbeiten', 'ueberarbeite', 'fortfahren', 'weitermachen', 'weiter',
    ]);
    const words = text.replace(/[^a-z0-9]+/g, ' ').split(/\s+/)
      .filter((word) => word.length > 2 && !stopWords.has(word) && !/^\d+$/.test(word));
    concepts.push(...[...new Set(words)].slice(0, 4));
  }

  const action = /fehler|bug|kaputt|funktioniert nicht|failed|fix|repair/.test(text) ? 'fix'
    : /hinzuf|ergaenz|einbau|install|create|add|implement/.test(text) ? 'add'
      : /pruef|analys|review|audit/.test(text) ? 'review'
        : /verbesser|ueberarbeit|optimier|anpass|schlecht|nicht aussagend|besser|improve|refactor/.test(text) ? 'improve' : 'update';
  return safeId([action, ...concepts.slice(0, 2)].join('-')).slice(0, 48);
}

function defaultCommitMessage(task) {
  const words = taskBranchSlug(task).split('-');
  const action = { add: 'Add', fix: 'Fix', improve: 'Improve', review: 'Review', update: 'Update' }[words.shift()] || 'Update';
  return `${action} ${words.join(' ') || 'project task'}`.slice(0, 72);
}

function gitDraftKey(projectId, branch) {
  return `${safeId(projectId)}::${String(branch || '')}`;
}

async function loadGitDrafts() {
  if (!fs.existsSync(GIT_DRAFTS_PATH)) return { schemaVersion: 1, drafts: {} };
  try {
    const store = await readJsonFile(GIT_DRAFTS_PATH);
    return store && store.schemaVersion === 1 && store.drafts && typeof store.drafts === 'object' ? store : { schemaVersion: 1, drafts: {} };
  } catch { return { schemaVersion: 1, drafts: {} }; }
}

async function saveGitDrafts(store) {
  await fsp.mkdir(DATA_ROOT, { recursive: true });
  await fsp.writeFile(GIT_DRAFTS_PATH, JSON.stringify(store, null, 2), 'utf8');
}

async function setCommitDraft(projectId, branch, message) {
  const cleanMessage = String(message || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  if (!branch || !cleanMessage) return null;
  const operation = gitDraftWriteChain.catch(() => {}).then(async () => {
    const store = await loadGitDrafts();
    store.drafts[gitDraftKey(projectId, branch)] = { message: cleanMessage, updatedAt: new Date().toISOString() };
    await saveGitDrafts(store);
    return cleanMessage;
  });
  gitDraftWriteChain = operation;
  return operation;
}

async function getCommitDraft(projectId, branch) {
  if (!branch) return null;
  await gitDraftWriteChain.catch(() => {});
  const store = await loadGitDrafts();
  return store.drafts[gitDraftKey(projectId, branch)]?.message || null;
}

async function clearCommitDraft(projectId, branch) {
  if (!branch) return;
  const operation = gitDraftWriteChain.catch(() => {}).then(async () => {
    const store = await loadGitDrafts();
    delete store.drafts[gitDraftKey(projectId, branch)];
    await saveGitDrafts(store);
  });
  gitDraftWriteChain = operation;
  return operation;
}

function taskIntent(task, mode) {
  if (mode === 'Write') return /review|prüf|audit/i.test(task) ? 'review-and-fix' : 'implementation';
  if (/review|prüf|audit/i.test(task)) return 'review';
  if (/warum|wieso|wie|was|welche|\?$/i.test(task.trim())) return 'question';
  return 'analysis';
}

function deterministicTaskStrategy(task, mode, project) {
  const intent = taskIntent(task, mode);
  const codeSignals = /code|implement|refactor|symbol|class|function|method|bug|test|script|server|router|api|godot|gdscript|javascript|typescript|python|powershell/i.test(task);
  const serenaStep = codeSignals || mode === 'Write'
    ? ' -> Serena symbol discovery for code relationships'
    : '';
  return `Intent: ${intent}\nContext budget: focused\nRetrieval order: AGENTS.md -> Graphify discovery (${project.graphPath})${serenaStep} -> relevant repository originals -> Obsidian working context only when needed\nPrompt policy: preserve the owner's request; do not use a second LLM to rewrite it\nScope policy: avoid broad repository scans when targeted retrieval answers the task\nHandoff policy: task package and Git state are authoritative; cli-continues may add a minimal local session extract only after a verified provider quota failure`;
}

function relevantMemoryText(notes, task) {
  const terms = new Set(String(task).toLowerCase().match(/[a-zäöüß0-9_-]{5,}/g) || []);
  const ranked = notes.map((note, index) => {
    const text = String(note.text || '');
    const score = [...terms].reduce((total, term) => total + (text.toLowerCase().includes(term) ? 1 : 0), 0);
    return { text, score, index };
  }).sort((left, right) => right.score - left.score || left.index - right.index);
  const matched = ranked.filter((entry) => entry.score > 0).slice(0, 4);
  const selected = matched.length ? matched : ranked.slice(0, 2);
  return selected.map((entry) => `- ${entry.text}`).join('\n') || '- No reviewed learning notes relevant to this task.';
}

function normalizedProject(project) {
  return {
    id: String(project.id),
    name: String(project.name),
    repository: path.resolve(String(project.repository)),
    graphPath: path.resolve(String(project.graphPath)),
    obsidianPath: path.resolve(String(project.obsidianPath)),
    integrationBranch: project.integrationBranch ? String(project.integrationBranch) : null,
  };
}

async function getIntegrationBranch(project) {
  const candidates = [];
  if (project.integrationBranch) candidates.push(project.integrationBranch);
  candidates.push('develop');
  const remoteHead = await execFileAsync('git.exe', ['-C', project.repository, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (remoteHead.exitCode === 0) candidates.push(remoteHead.stdout.trim().replace(/^origin\//, ''));
  candidates.push('main');
  const current = await execFileAsync('git.exe', ['-C', project.repository, 'branch', '--show-current']);
  if (current.exitCode === 0) candidates.push(current.stdout.trim());
  for (const branch of [...new Set(candidates.filter(Boolean))]) {
    if (!/^[A-Za-z0-9._\/-]+$/.test(branch)) continue;
    const exists = await execFileAsync('git.exe', ['-C', project.repository, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
    if (exists.exitCode === 0) return branch;
  }
  throw new Error('No local integration branch is available for this project.');
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
  const indexes = [
    ['Working Notes', 'Inbox.md', 'Working Notes Inbox', 'Kurze Arbeitsnotizen und ungeklärte Gedanken für das Projekt.'],
    ['Research', 'Research Index.md', 'Research Index', 'Recherchelinks und noch nicht verbindliche Erkenntnisse.'],
    ['Design Drafts', 'Draft Index.md', 'Design Drafts', 'Entwürfe, die erst nach bewusster Übernahme ins Repository verbindlich werden.'],
    ['Review Notes', 'Review Queue.md', 'Review Queue', 'Offene Prüfungen, Findings und Owner-Entscheidungen.'],
    ['Prompt Library', 'Prompt Library.md', 'Prompt Library', 'Bewährte Aufgabenpakete und projektspezifische Arbeitsabläufe.'],
    ['Lessons Learned', 'Lessons Learned.md', 'Lessons Learned', 'Bestätigte Erfahrungen für spätere Aufgaben und Projekte.'],
    ['AI Runs', 'AI Runs Index.md', 'AI Runs', 'Links zu lokalen Run-Artefakten und ihren Ergebnissen.'],
  ];
  for (const [directory, file, title, purpose] of indexes) {
    const target = path.join(project.obsidianPath, directory, file);
    if (fs.existsSync(target)) continue;
    const note = [
      '---', `title: ${title}`, `project: ${project.name}`, 'status: working', '---', '', `# ${title}`, '',
      '> [!info] Arbeitskontext',
      `> ${purpose} Das Git-Repository bleibt die verbindliche Quelle.`, '',
      '## Offen', '', '- ', '', '## Verweise', '', `- Repository: ${project.repository}`, '',
    ].join('\n');
    await fsp.writeFile(target, note, 'utf8');
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
  try {
    const result = await execFileAsync(command, args, { timeout: 15000 });
    const text = (result.stdout || result.stderr).trim();
    return { ok: result.exitCode === 0, text: text.split(/\r?\n/).find(Boolean) || 'not available' };
  } catch (error) {
    return { ok: false, text: error.message || 'not available' };
  }
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

async function loadSystemCatalog() {
  const catalog = await readJsonFile(SYSTEM_CATALOG_PATH);
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.systems)) throw new Error('System catalog is invalid.');
  for (const definition of catalog.systems) {
    if (!definition.id || !definition.name || !definition.detect || !['required', 'recommended', 'project'].includes(definition.tier)) {
      throw new Error(`Invalid system definition: ${definition.id || definition.name || 'unknown'}`);
    }
  }
  return catalog.systems;
}

function expandSystemPath(value) {
  const variables = {
    HOME, LOCALAPPDATA: process.env.LOCALAPPDATA || '', APPDATA: process.env.APPDATA || '',
    PROGRAMFILES: process.env.ProgramFiles || 'C:\\Program Files', OBSIDIAN_VAULT, ECC_ROOT,
  };
  return String(value || '').replace(/\{([A-Z_]+)\}/g, (_, key) => variables[key] || '');
}

async function detectSystem(definition) {
  const detection = definition.detect;
  if (detection.type === 'command') return commandSummary(detection.command, detection.args || []);
  if (detection.type === 'commandOrSearch') {
    const command = await commandSummary(detection.command, detection.args || []);
    if (command.ok) return command;
    let pattern;
    try { pattern = new RegExp(detection.filePattern, 'i'); } catch { return { ok: false, text: 'Ungültiges Suchmuster im Systemkatalog' }; }
    for (const rootValue of detection.roots || []) {
      const matches = await findMatchingFiles(expandSystemPath(rootValue), pattern, []);
      if (matches.length) return { ok: true, text: matches[0], path: matches[0] };
    }
    return command;
  }
  if (detection.type === 'pythonModule') {
    const python = fs.existsSync(GRAPHIFY_PYTHON) ? GRAPHIFY_PYTHON : 'python.exe';
    return commandSummary(python, ['-m', detection.module, '--version']);
  }
  if (detection.type === 'path' || detection.type === 'pathOrCommand') {
    const found = (detection.paths || []).map(expandSystemPath).find((candidate) => fs.existsSync(candidate));
    if (found) return { ok: true, text: found, path: found };
    if (detection.type === 'pathOrCommand') return commandSummary(detection.command, detection.args || []);
    return { ok: false, text: 'Nicht gefunden' };
  }
  if (detection.type === 'mcp') return mcpSummary();
  if (detection.type === 'ollama') {
    const summary = await commandSummary('ollama.exe', ['--version']);
    if (!summary.ok) return summary;
    const models = await execFileAsync('ollama.exe', ['list']);
    const names = models.stdout.split(/\r?\n/).slice(1).filter(Boolean).map((line) => line.trim().split(/\s{2,}/)[0]);
    return { ok: true, text: names.length ? names.join(', ') : summary.text };
  }
  if (detection.type === 'comfyCloud') {
    const installationsPath = path.join(path.dirname(COMFY_SETTINGS), 'installations.json');
    if (!fs.existsSync(installationsPath)) return { ok: false, text: 'Keine Cloud-Installation erkannt' };
    try {
      const entries = JSON.parse(await fsp.readFile(installationsPath, 'utf8'));
      const ok = entries.some((entry) => entry.sourceId === 'cloud' && entry.status === 'installed');
      return { ok, text: ok ? 'Cloud-Installation erkannt; wird nicht automatisch verwendet' : 'Keine aktive Cloud-Installation' };
    } catch { return { ok: false, text: 'Comfy-Konfiguration ist nicht lesbar' }; }
  }
  if (detection.type === 'flux') {
    const matches = [];
    const roots = (detection.roots || []).map(expandSystemPath);
    if (fs.existsSync(COMFY_SETTINGS)) {
      try {
        const settings = JSON.parse(await fsp.readFile(COMFY_SETTINGS, 'utf8'));
        roots.push(...(Array.isArray(settings.modelsDirs) ? settings.modelsDirs : []));
      } catch {
        // Explicit catalog roots remain valid even when optional Comfy Desktop settings are unreadable.
      }
    }
    for (const root of [...new Set(roots)]) await findMatchingFiles(root, /flux|schnell|flux1|flux2/i, matches);
    return { ok: matches.length > 0, text: matches.length ? matches.join(', ') : 'Keine Flux-Modelldatei gefunden', path: matches[0] || null };
  }
  return { ok: false, text: `Unbekannte Erkennung: ${detection.type}` };
}

async function detectProjectCapabilities(project) {
  const capabilities = new Set();
  const direct = (name) => fs.existsSync(path.join(project.repository, name));
  if (direct('project.godot') || (await findMatchingFiles(project.repository, /^project\.godot$/i, [])).length) capabilities.add('godot');
  if (direct('package.json')) capabilities.add('node-development');
  if (direct('pyproject.toml') || direct('requirements.txt')) capabilities.add('python-development');
  const assetSignals = ['Pics', 'Assets', 'Art', 'art', 'assets'].some(direct)
    || (await findMatchingFiles(project.repository, /(?:asset|image|texture|sprite).*(?:workflow|pipeline)|(?:workflow|pipeline).*(?:asset|image|texture|sprite)/i, [])).length > 0;
  if (assetSignals) { capabilities.add('image-generation'); capabilities.add('asset-pipeline'); }
  const mediaSignals = ['Audio', 'Video', 'Media', 'audio', 'video', 'media'].some(direct)
    || (await findMatchingFiles(project.repository, /\.(?:mp3|wav|ogg|mp4|webm)$/i, [])).length > 0;
  if (mediaSignals) capabilities.add('media');
  return [...capabilities];
}

function catalogSystemRow(definition, detection, usedByProjects, activeProjectId) {
  return {
    id: `auto-${definition.id}`, name: definition.name, category: definition.category,
    ok: Boolean(detection.ok), status: detection.ok ? 'vorhanden' : 'fehlt', detail: detection.text,
    path: detection.path || null, scope: 'global', autoDetected: true, tier: definition.tier,
    installKey: definition.install ? definition.id : null, reason: definition.reason || null,
    workflowRole: definition.workflowRole || null, activation: definition.activation || null,
    costPolicy: definition.costPolicy || null,
    capabilities: definition.capabilities || [], usedByProjects,
    relevantToCurrentProject: usedByProjects.some((item) => item.id === activeProjectId),
  };
}

async function getSystemInventory(project, force = false) {
  const registry = await loadProjects();
  const definitions = await loadSystemCatalog();
  if (force || !systemCache || Date.now() - systemCacheAt > 60000) {
    const projectCapabilities = new Map();
    await Promise.all(registry.projects.map(async (candidate) => projectCapabilities.set(candidate.id, await detectProjectCapabilities(candidate))));
    const detections = await Promise.all(definitions.map(detectSystem));
    systemCache = definitions.map((definition, index) => {
      const required = definition.capabilities || [];
      const usedByProjects = required.length ? registry.projects
        .filter((candidate) => required.some((capability) => projectCapabilities.get(candidate.id).includes(capability)))
        .map((candidate) => ({ id: candidate.id, name: candidate.name })) : [];
      return catalogSystemRow(definition, detections[index], usedByProjects, project.id);
    });
    systemCacheAt = Date.now();
  }
  const registered = (await loadSystems()).systems
    .filter((system) => system.scope === 'global' || system.projectId === project.id)
    .map((system) => ({ ...system, category: system.type, ok: fs.existsSync(system.path), status: fs.existsSync(system.path) ? 'registriert' : 'Pfad fehlt', detail: system.note || system.path, autoDetected: false, tier: system.scope === 'project' ? 'project' : 'recommended', usedByProjects: system.scope === 'project' ? [{ id: project.id, name: project.name }] : [] }));
  const projectCapabilities = await detectProjectCapabilities(project);
  const projectSystem = (id, name, category, configuredPath, statusOk, reason) => ({
    id, name, category, ok: statusOk, status: statusOk ? 'verbunden' : 'fehlt', detail: configuredPath,
    path: configuredPath, scope: 'project', autoDetected: true, tier: 'project', installKey: null, reason,
    relevantToCurrentProject: true, usedByProjects: [{ id: project.id, name: project.name }],
  });
  const projectSystems = [
    projectSystem(`project-${project.id}-repository`, `${project.name} Repository`, 'Projekt', project.repository, fs.existsSync(project.repository), 'Verbindliche Projektquelle.'),
    projectSystem(`project-${project.id}-graphify`, `${project.name} Graphify`, 'Projektkontext', project.graphPath, fs.existsSync(project.graphPath), 'Lokaler Discovery-Index; Originaldateien bleiben maßgeblich.'),
    projectSystem(`project-${project.id}-obsidian`, `${project.name} Obsidian`, 'Arbeitswissen', project.obsidianPath, fs.existsSync(project.obsidianPath), 'Notizen, Runs und Entwürfe für dieses Projekt.'),
    projectSystem(`project-${project.id}-agents`, `${project.name} AGENTS.md`, 'Projektregeln', path.join(project.repository, 'AGENTS.md'), fs.existsSync(path.join(project.repository, 'AGENTS.md')), 'Verbindliche Agentenregeln des Repositorys.'),
  ];
  return {
    global: [...systemCache.map((system) => ({ ...system, relevantToCurrentProject: system.usedByProjects.some((item) => item.id === project.id) })), ...registered.filter((system) => system.scope === 'global')],
    project: [...projectSystems, ...registered.filter((system) => system.scope === 'project')],
    projectCapabilities,
    catalogPath: SYSTEM_CATALOG_PATH,
  };
}

function snapshotJob(job) {
  return {
    id: job.id, kind: job.kind || 'task', phase: job.phase || null,
    projectId: job.projectId, projectName: job.projectName,
    status: job.status, provider: job.provider, providerOrder: job.providerOrder || null, models: job.models || null,
    mode: job.mode, useSubscriptionTokens: job.useSubscriptionTokens,
    workingDirectory: job.workingDirectory, branch: job.branch || null, taskPreview: job.taskPreview,
    createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt,
    exitCode: job.exitCode, runDirectory: job.runDirectory, pid: job.pid,
    stdout: job.stdout, stderr: job.stderr,
  };
}

function broadcastJob(job) {
  const payload = `event: job\ndata: ${JSON.stringify(snapshotJob(job))}\n\n`;
  for (const client of liveClients) {
    try { client.write(payload); }
    catch { liveClients.delete(client); }
  }
}

function serveLiveEvents(request, response) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.write('retry: 1000\n\n');
  liveClients.add(response);
  for (const job of jobs.values()) response.write(`event: job\ndata: ${JSON.stringify(snapshotJob(job))}\n\n`);
  const keepAlive = setInterval(() => {
    try { response.write(`: keep-alive ${Date.now()}\n\n`); }
    catch { clearInterval(keepAlive); liveClients.delete(response); }
  }, 15000);
  request.on('close', () => { clearInterval(keepAlive); liveClients.delete(response); });
}

function appendLog(job, key, chunk) {
  const text = stripAnsi(chunk.toString('utf8'));
  job[key] = (job[key] + text).slice(-MAX_JOB_LOG_CHARS);
  const runMatch = text.match(/AI_RUN_DIRECTORY\s+(.+)/);
  if (runMatch) job.runDirectory = runMatch[1].trim();
  const events = [...text.matchAll(/AI_EVENT\s+provider=([^\s]+)\s+state=([^\s]+)/g)];
  if (events.length) {
    const latest = events[events.length - 1];
    job.phase = `${latest[1]} · ${latest[2]}`;
  }
  broadcastJob(job);
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
  const baseBranch = `ai/${taskBranchSlug(task)}`;
  const [localExists, remoteExists] = await Promise.all([
    execFileAsync('git.exe', ['-C', project.repository, 'show-ref', '--verify', '--quiet', `refs/heads/${baseBranch}`]),
    execFileAsync('git.exe', ['-C', project.repository, 'show-ref', '--verify', '--quiet', `refs/remotes/origin/${baseBranch}`]),
  ]);
  const branch = localExists.exitCode === 0 || remoteExists.exitCode === 0 ? `${baseBranch}-${id.slice(0, 8)}` : baseBranch;
  const integrationBranch = await getIntegrationBranch(project);
  const workingDirectory = path.join(WORKTREE_ROOT, safeId(project.name), `${new Date().toISOString().replace(/[:.]/g, '-')}-${id.slice(0, 8)}`);
  await fsp.mkdir(path.dirname(workingDirectory), { recursive: true });
  const result = await execFileAsync('git.exe', ['-C', project.repository, 'worktree', 'add', '-b', branch, workingDirectory, integrationBranch], { timeout: 60000 });
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || 'Automatic task worktree creation failed.');
  await setCommitDraft(project.id, branch, defaultCommitMessage(task));
  return { workingDirectory, branch, integrationBranch };
}

async function finalizeTaskGitMetadata(project, job, originalBranch, task) {
  if (!originalBranch || !job.runDirectory || !fs.existsSync(path.join(job.runDirectory, 'routing-result.json'))) return;
  let result;
  try { result = await readJsonFile(path.join(job.runDirectory, 'routing-result.json')); } catch { return; }
  let branch = originalBranch;
  const suggestedBranch = String(result.suggested_branch_name || '').trim();
  if (job.status === 'completed' && /^ai\/[a-z0-9][a-z0-9-]{1,63}$/.test(suggestedBranch) && suggestedBranch !== branch) {
    const current = await execFileAsync('git.exe', ['-C', job.workingDirectory, 'branch', '--show-current']);
    const upstream = await execFileAsync('git.exe', ['-C', job.workingDirectory, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    const [localExists, remoteExists] = await Promise.all([
      execFileAsync('git.exe', ['-C', project.repository, 'show-ref', '--verify', '--quiet', `refs/heads/${suggestedBranch}`]),
      execFileAsync('git.exe', ['-C', project.repository, 'show-ref', '--verify', '--quiet', `refs/remotes/origin/${suggestedBranch}`]),
    ]);
    if (current.exitCode === 0 && current.stdout.trim() === branch && upstream.exitCode !== 0 && localExists.exitCode !== 0 && remoteExists.exitCode !== 0) {
      const renamed = await execFileAsync('git.exe', ['-C', job.workingDirectory, 'branch', '-m', suggestedBranch]);
      if (renamed.exitCode === 0) {
        const previousDraft = await getCommitDraft(project.id, branch);
        await clearCommitDraft(project.id, branch);
        branch = suggestedBranch;
        if (previousDraft) await setCommitDraft(project.id, branch, previousDraft);
      }
    }
  }
  const message = String(result.suggested_commit_message || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200) || defaultCommitMessage(task);
  await setCommitDraft(project.id, branch, message);
  job.branch = branch;
}

async function startTask(payload) {
  const { project } = await getProject(String(payload.projectId || ''));
  const task = String(payload.task || '').trim();
  const legacyProvider = String(payload.provider || 'Auto');
  const mode = String(payload.mode || 'ReadOnly');
  const useSubscriptionTokens = payload.useSubscriptionTokens !== false;
  let providerOrder = normalizeProviderOrder(payload.providerOrder, legacyProvider);
  const models = normalizeProviderModels(payload.models);
  if (!task || task.length > 200000) throw new Error('Task text must contain between 1 and 200,000 characters.');
  if (!['Auto', 'Codex', 'Claude', 'Ollama'].includes(legacyProvider)) throw new Error('Unknown provider selection.');
  if (!['ReadOnly', 'Write'].includes(mode)) throw new Error('Unknown execution mode.');
  if (!useSubscriptionTokens) providerOrder = ['Ollama'];
  if (mode === 'Write') {
    providerOrder = providerOrder.filter((provider) => provider !== 'Ollama');
    if (!providerOrder.length) throw new Error('Hermes lokal ist derzeit nicht für Schreibaufgaben freigegeben. Aktiviere Codex oder Claude.');
  }
  const provider = providerOrder.length === 1 ? providerOrder[0] : 'Auto';

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
          await runStreamingCommand(job, graphifyCommand, ['-m', 'graphify', 'extract', registeredProject.repository, '--backend', 'ollama', '--model', 'polis-coder', '--token-budget', '4096', '--max-concurrency', '1', '--out', registeredProject.repository], registeredProject.repository, 'graphify');
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
  const memoryText = relevantMemoryText(memory.notes, task);
  const registeredSystems = (await loadSystems()).systems.filter((system) => system.scope === 'global' || system.projectId === project.id);
  const systemText = registeredSystems.map((system) => `- ${system.name} (${system.type}): ${system.path}${system.note ? ` — ${system.note}` : ''}`).join('\n') || '- No additional systems registered for agent use.';
  const id = randomUUID();
  const attachments = await saveTaskAttachments(id, payload.attachments);
  const worktree = mode === 'Write' ? await createTaskWorktree(project, task, id) : { workingDirectory: project.repository, branch: null, integrationBranch: await getIntegrationBranch(project) };
  const workingDirectory = worktree.workingDirectory;
  const taskPath = path.join(TASK_ROOT, `${id}.md`);
  const attachmentSection = attachments.length
    ? `\nAttachment-ID: ${id}\n\n## Attachments\n\n${attachments.map((attachment) => `- ${attachment.name} (${attachment.type}): ${attachment.path}`).join('\n')}\n`
    : '';
  const strategy = deterministicTaskStrategy(task, mode, project);
  const promotionRule = worktree.integrationBranch === 'main'
    ? 'task branch -> main (only because no separate integration branch is available)'
    : `task branch -> ${worktree.integrationBranch} -> main; never task branch -> main`;
  const modelSummary = providerOrder.map((name) => `${name}=${models[name]}`).join(', ');
  const taskPackage = `# Dashboard Task\n\nCreated: ${new Date().toISOString()}\nProject-ID: ${project.id}\nProject: ${project.name}\nRepository: ${project.repository}\nProvider order: ${providerOrder.join(' -> ')}\nProvider models: ${modelSummary}\nUse subscription tokens: ${useSubscriptionTokens}\nMode: ${mode}\nWorking directory: ${workingDirectory}\nTask branch: ${worktree.branch || 'none (read-only)'}\nIntegration branch: ${worktree.integrationBranch}\nPromotion rule: ${promotionRule}\nGraphify: ${project.graphPath}\nObsidian: ${project.obsidianPath}\n${attachmentSection}\n## Execution strategy\n\n${strategy}\n\n## Reviewed project memory\n\n${memoryText}\n\n## Registered systems\n\n${systemText}\n\n## Goal\n\n${task}\n`;
  await fsp.writeFile(taskPath, taskPackage, 'utf8');

  const args = [
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', TASK_SCRIPT,
    '-TaskFile', taskPath, '-WorkingDirectory', workingDirectory,
    '-ProjectName', project.name, '-Provider', provider, '-ProviderOrder', providerOrder.join(','), '-Mode', mode,
    '-CodexModel', models.Codex, '-ClaudeModel', models.Claude, '-OllamaModel', models.Ollama, '-RunRoot', RUN_ROOT,
  ];
  if (!useSubscriptionTokens) args.push('-LocalOnly');
  const child = spawn('pwsh.exe', args, { cwd: workingDirectory, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  const job = {
    id, kind: 'task', phase: 'routing', projectId: project.id, projectName: project.name, status: 'running', provider, providerOrder, models, mode, useSubscriptionTokens,
    workingDirectory, branch: worktree.branch, taskPreview: task.slice(0, 160), taskPath,
    createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), finishedAt: null,
    exitCode: null, runDirectory: null, pid: child.pid, stdout: '', stderr: '', child,
  };
  jobs.set(id, job);
  broadcastJob(job);
  child.stdout.on('data', (chunk) => appendLog(job, 'stdout', chunk));
  child.stderr.on('data', (chunk) => appendLog(job, 'stderr', chunk));
  child.on('error', (error) => {
    job.status = 'failed'; job.finishedAt = new Date().toISOString(); appendLog(job, 'stderr', error.message); broadcastJob(job);
  });
  child.on('close', async (code) => {
    job.exitCode = code; job.finishedAt = new Date().toISOString();
    const blockedMatch = job.stdout.match(/AI_PROJECT_ROUTER_BLOCKED\s+provider=([^\s]+)\s+run=(.+)/);
    job.status = blockedMatch ? 'blocked' : code === 0 ? 'completed' : job.status === 'stopping' ? 'stopped' : 'failed';
    job.phase = blockedMatch ? 'blocked' : job.phase;
    const match = job.stdout.match(/AI_PROJECT_ROUTER_(?:OK|BLOCKED)\s+provider=([^\s]+)\s+run=(.+)/);
    if (match) { job.provider = match[1]; job.runDirectory = match[2].trim(); }
    const runMatch = job.stdout.match(/AI_RUN_DIRECTORY\s+(.+)/);
    if (!job.runDirectory && runMatch) job.runDirectory = runMatch[1].trim();
    if (mode === 'Write') {
      try { await finalizeTaskGitMetadata(project, job, worktree.branch, task); }
      catch (error) { appendLog(job, 'stderr', `Git-Metadaten konnten nicht aktualisiert werden: ${error.message}\n`); }
    }
    job.child = null; statusCacheAt = 0; broadcastJob(job);
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
    const needsWindowsCommandShell = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command);
    const child = spawn(command, args, { cwd, windowsHide: true, shell: needsWindowsCommandShell, stdio: ['ignore', 'pipe', 'pipe'] });
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

async function installSystem(payload) {
  const { project } = await getProject(String(payload.projectId || ''));
  const installKey = String(payload.installKey || '');
  const definition = (await loadSystemCatalog()).find((candidate) => candidate.id === installKey);
  const installer = definition?.install;
  if (!installer) throw new Error('This system has no approved automatic installer.');
  const id = randomUUID();
  const now = new Date().toISOString();
  const job = {
    id, kind: 'install', phase: 'queued', projectId: project.id, projectName: project.name,
    status: 'running', provider: 'Local setup', mode: 'Install', workingDirectory: project.repository,
    taskPreview: `${installer.name} installieren`, createdAt: now, startedAt: now, finishedAt: null,
    exitCode: null, runDirectory: null, pid: null, stdout: '', stderr: '', child: null,
  };
  jobs.set(id, job);
  (async () => {
    try {
      await runStreamingCommand(job, installer.command, installer.args, project.repository, `Installation ${installer.name}`);
      job.phase = 'complete'; job.status = 'completed'; job.exitCode = 0; job.finishedAt = new Date().toISOString();
      emitJob(job, 'complete', `${installer.name} wurde installiert. Ein Neustart des Dashboards kann erforderlich sein.`);
    } catch (error) {
      job.status = 'failed'; job.exitCode = 1; job.finishedAt = new Date().toISOString();
      appendLog(job, 'stderr', `${error.message}\nInstallation wurde nicht als erfolgreich markiert.\n`);
    } finally {
      systemCache = null; systemCacheAt = 0; componentCache.clear();
    }
  })();
  return snapshotJob(job);
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
      const agents = `# Agent Instructions\n\n1. Read README.md and Docs/CURRENT_TASK.md before project work.\n2. Treat Git and repository files as the source of truth.\n3. Use Graphify for repository discovery, then read relevant original files.\n4. Use Serena for symbol-level code navigation when it reduces file reads; activate the current worktree first.\n5. Use Obsidian as working memory, not as competing official documentation.\n6. Keep code modular and document architectural changes.\n7. New AI tools, repositories and integrations require a defined role, activation rule, cost boundary, validation and rollback; installation alone is not integration.\n8. Use cli-continues only for an explicit provider handoff after a verified interruption.\n9. Do not add paid services or API-key billing without explicit owner approval.\n10. Do not commit, push or merge unless the owner explicitly requests it.\n`;
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
      await runStreamingCommand(job, GRAPHIFY_PYTHON, ['-m', 'graphify', 'extract', repository, '--backend', 'ollama', '--model', 'polis-coder', '--token-budget', '4096', '--max-concurrency', '1', '--out', repository], repository, 'graphify');

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

function packageField(taskPackage, name) {
  const match = taskPackage.match(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : null;
}

function runSummary(responseText, result, status) {
  const testMatch = String(responseText || '').match(/(?:tests?|npm test|pytest|GUT)[^\r\n]{0,100}(?:PASS|passed|green|erfolgreich)/i);
  const changedFiles = Array.isArray(result?.changed_files) ? result.changed_files.length : Number.isInteger(result?.files_changed) ? result.files_changed : null;
  return {
    tests: testMatch ? testMatch[0].slice(0, 120) : null,
    filesChanged: changedFiles === null ? null : `${changedFiles} Datei(en) geändert`,
    gate: status === 'PASS' ? 'Ergebnis bereit zur Prüfung' : status === 'FAIL' ? 'Blockiert: Lauf fehlgeschlagen' : null,
  };
}

function friendlyOutput(raw) {
  const text = stripAnsi(raw).trim();
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
  const response = messages.length ? messages[messages.length - 1] : text;
  return response
    .replace(/^Suggested branch name:\s*ai\/[a-z0-9-]+\s*$/gim, '')
    .replace(/^Suggested commit message:\s*.+$/gim, '')
    .replace(/\r?\n?AI_PROJECT_TASK_COMPLETE\s*$/m, '').trim().slice(-120000);
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
  let errorText = '';
  if (attemptDirectories.length) {
    const latestAttempt = attemptDirectories[attemptDirectories.length - 1];
    const outputPath = path.join(latestAttempt, 'stdout.log');
    if (fs.existsSync(outputPath)) responseText = friendlyOutput(await readBounded(outputPath, 2 * 1024 * 1024));
    const errorPath = path.join(latestAttempt, 'stderr.log');
    if (fs.existsSync(errorPath)) errorText = friendlyOutput(await readBounded(errorPath, 2 * 1024 * 1024));
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
  if (!responseText && errorText) responseText = errorText;
  const controlledBlocked = /^AI_PROJECT_TASK_BLOCKED:\s*.+$/im.test(responseText);
  const status = controlledBlocked ? 'BLOCKED' : result ? result.status : errorText ? 'FAIL' : 'external';
  const summary = runSummary(responseText, result, status);
  return {
    name: path.basename(directory), path: directory, modifiedAt: stat.mtime.toISOString(),
    status, provider: result ? result.selected_provider || null : null,
    mode: result?.mode || packageField(taskPackage, 'Mode'), task: extractGoal(taskPackage), response: responseText,
    attachments: await taskAttachmentsFromPackage(taskPackage), ...summary,
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

async function portfolioProject(project) {
  const [components, runs, head] = await Promise.all([
    getComponents(project), listRuns(project.id), commandSummary('git.exe', ['-C', project.repository, 'rev-parse', 'HEAD']),
  ]);
  const latest = runs[0] || null;
  const running = Array.from(jobs.values()).find((job) => job.projectId === project.id && job.status === 'running');
  const currentTaskPath = path.join(project.repository, 'Docs', 'CURRENT_TASK.md');
  let currentTask = null;
  if (fs.existsSync(currentTaskPath)) {
    const text = await readBounded(currentTaskPath, 64 * 1024);
    currentTask = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#') && !line.startsWith('>')).slice(0, 3).join(' ').slice(0, 600) || null;
  }
  let obsidianNotes = 0;
  if (fs.existsSync(project.obsidianPath)) {
    try { obsidianNotes = (await walkMarkdown(project.obsidianPath)).length; } catch { obsidianNotes = 0; }
  }
  let graphStatus = components.graphify.ok ? 'aktuell' : 'fehlt';
  if (components.graphify.ok && head.ok) {
    try {
      const graph = JSON.parse(await fsp.readFile(project.graphPath, 'utf8'));
      const builtAt = String(graph.built_at_commit || '');
      if (builtAt && !head.text.startsWith(builtAt) && !builtAt.startsWith(head.text)) graphStatus = 'veraltet';
    } catch { graphStatus = 'fehlerhaft'; }
  }
  let state = 'Wartet'; let stateClass = 'attention'; let nextAction = 'Neue Aufgabe definieren';
  if (!components.repository.ok || latest?.status === 'FAIL' || latest?.status === 'BLOCKED') {
    state = 'Blockiert'; stateClass = 'blocked'; nextAction = latest?.status === 'FAIL' ? 'Fehlgeschlagenen Lauf prüfen' : 'Repository-Verbindung prüfen';
    if (latest?.status === 'BLOCKED') nextAction = 'Gemeldete Blockade prüfen';
  } else if (running) {
    state = 'Aktiv'; stateClass = 'active'; nextAction = 'Lauf im Live-Feed beobachten';
  } else if (latest?.status === 'PASS') {
    state = 'Aufgabe abgeschlossen'; stateClass = 'ready'; nextAction = 'Ergebnis und Änderungen im Aufgabenbranch prüfen';
  } else if (latest) {
    state = 'Wartet'; stateClass = 'attention'; nextAction = 'Letzten Lauf prüfen';
  }
  return {
    id: project.id, name: project.name, state, stateClass,
    currentTask,
    lastTask: latest ? `${latest.provider || latest.status} · ${String(latest.task || 'Lauf ohne gespeicherten Auftrag').slice(0, 150)}` : null,
    latestStatus: latest?.status || null, provider: running?.provider || latest?.provider || null,
    running: running ? { provider: running.provider, phase: running.phase, startedAt: running.startedAt } : null,
    repository: components.repository, graph: { status: graphStatus, ok: graphStatus === 'aktuell' },
    obsidian: { ok: components.obsidian.ok, notes: obsidianNotes }, nextAction,
  };
}

async function getPortfolio() {
  const registry = await loadProjects();
  const selected = registry.projects.find((project) => project.id === registry.activeProjectId) || registry.projects[0];
  const project = await portfolioProject(selected);
  const attention = [];
  if (!project.repository.ok) attention.push({ severity: 'error', message: 'Repository ist nicht erreichbar.', target: 'git' });
  if (project.latestStatus === 'FAIL') attention.push({ severity: 'error', message: 'Der letzte Task ist fehlgeschlagen.', target: 'tasks' });
  if (project.repository.ok && !project.repository.clean) attention.push({ severity: 'warning', message: 'Das Repository enthält noch nicht eingeordnete Änderungen.', target: 'git' });
  if (project.graph.status === 'fehlt' || project.graph.status === 'fehlerhaft') attention.push({ severity: 'warning', message: 'Der Graphify-Index fehlt oder ist nicht lesbar.', target: 'knowledge' });
  if (project.graph.status === 'veraltet') attention.push({ severity: 'warning', message: 'Der Graphify-Index basiert nicht auf dem aktuellen Commit.', target: 'knowledge' });
  return { generatedAt: new Date().toISOString(), activeProjectId: registry.activeProjectId, attention, project };
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
  await ensureObsidianProjectArea(project);
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

function parseGitStatus(output) {
  const records = output.split('\0');
  const files = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    const staged = record[0]; const working = record[1]; const filePath = record.slice(3);
    let originalPath = null;
    if (staged === 'R' || staged === 'C' || working === 'R' || working === 'C') originalPath = records[++index] || null;
    files.push({ path: filePath, originalPath, staged, working, untracked: staged === '?' && working === '?' });
  }
  return files;
}

function parseGitWorktrees(output) {
  return String(output || '').trim().split(/\r?\n\r?\n/).filter(Boolean).map((block) => {
    const entry = { path: null, head: null, branch: null, detached: false, locked: false, prunable: false };
    for (const line of block.split(/\r?\n/)) {
      const separator = line.indexOf(' ');
      const key = separator < 0 ? line : line.slice(0, separator);
      const value = separator < 0 ? '' : line.slice(separator + 1);
      if (key === 'worktree') entry.path = path.resolve(value);
      else if (key === 'HEAD') entry.head = value;
      else if (key === 'branch') entry.branch = value.replace(/^refs\/heads\//, '');
      else if (key === 'detached') entry.detached = true;
      else if (key === 'locked') entry.locked = true;
      else if (key === 'prunable') entry.prunable = true;
    }
    return entry;
  }).filter((entry) => entry.path);
}

async function getProjectWorktrees(project) {
  const result = await execFileAsync('git.exe', ['-C', project.repository, 'worktree', 'list', '--porcelain']);
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || 'Git worktree list failed.');
  const mainPath = path.resolve(project.repository);
  const entries = parseGitWorktrees(result.stdout);
  const targets = await Promise.all(entries.map(async (entry) => {
    const status = await execFileAsync('git.exe', ['-C', entry.path, 'status', '--porcelain=v1', '-z', '--untracked-files=all']);
    const files = status.exitCode === 0 ? parseGitStatus(status.stdout) : [];
    let updatedAt = null;
    try { updatedAt = (await fsp.stat(entry.path)).mtime.toISOString(); } catch {}
    const mainCheckout = entry.path.toLowerCase() === mainPath.toLowerCase();
    return {
      path: entry.path, branch: entry.branch || (entry.detached ? 'detached HEAD' : ''), head: entry.head,
      mainCheckout, kind: mainCheckout ? 'Haupt-Checkout' : entry.branch?.startsWith('ai/') ? 'Aufgaben-Worktree' : 'Zusätzlicher Worktree',
      clean: files.length === 0, changedCount: files.length, updatedAt,
      available: status.exitCode === 0 && !entry.prunable, locked: entry.locked, prunable: entry.prunable,
    };
  }));
  return targets.sort((left, right) => {
    const leftPriority = !left.mainCheckout && !left.clean ? 0 : left.mainCheckout && !left.clean ? 1 : !left.mainCheckout ? 2 : 3;
    const rightPriority = !right.mainCheckout && !right.clean ? 0 : right.mainCheckout && !right.clean ? 1 : !right.mainCheckout ? 2 : 3;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
  });
}

async function resolveGitTarget(project, requestedWorktree) {
  const targets = await getProjectWorktrees(project);
  if (!targets.length) throw new Error('No Git worktree is registered for this project.');
  let target = null;
  if (requestedWorktree) {
    const resolved = path.resolve(String(requestedWorktree));
    target = targets.find((candidate) => candidate.path.toLowerCase() === resolved.toLowerCase());
    if (!target) throw new Error('Requested worktree is not registered with this project repository.');
  } else {
    target = targets.find((candidate) => candidate.available && !candidate.mainCheckout && !candidate.clean)
      || targets.find((candidate) => candidate.available && !candidate.mainCheckout && candidate.branch.startsWith('ai/'))
      || targets.find((candidate) => candidate.available && candidate.mainCheckout);
  }
  if (!target?.available) throw new Error('Selected worktree is not currently available.');
  return { target, targets };
}

async function getGitState(project, requestedWorktree = null) {
  const { target, targets } = await resolveGitTarget(project, requestedWorktree);
  const workingDirectory = target.path;
  const integrationBranch = await getIntegrationBranch(project);
  const integrationTarget = targets.find((candidate) => candidate.branch === integrationBranch && candidate.available) || null;
  const branch = await execFileAsync('git.exe', ['-C', workingDirectory, 'branch', '--show-current']);
  const status = await execFileAsync('git.exe', ['-C', workingDirectory, 'status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (status.exitCode !== 0 || branch.exitCode !== 0) throw new Error(status.stderr.trim() || branch.stderr.trim() || 'Git status failed.');
  const remote = await execFileAsync('git.exe', ['-C', workingDirectory, 'remote', 'get-url', 'origin']);
  const head = await execFileAsync('git.exe', ['-C', workingDirectory, 'log', '-1', '--pretty=format:%h%x00%s%x00%aI']);
  const upstream = await execFileAsync('git.exe', ['-C', workingDirectory, 'rev-list', '--left-right', '--count', '@{upstream}...HEAD']);
  const ghAuth = await execFileAsync('gh.exe', ['auth', 'status', '--active']);
  const files = parseGitStatus(status.stdout);
  const currentBranch = branch.stdout.trim();
  const [behind = 0, ahead = 0] = upstream.exitCode === 0 ? upstream.stdout.trim().split(/\s+/).map(Number) : [0, 0];
  const [hash = '', subject = '', committedAt = ''] = head.stdout.split('\0');
  let alreadyIntegrated = target.branch === integrationBranch;
  let integrationIsAncestor = target.branch === integrationBranch;
  if (target.branch && target.branch !== 'detached HEAD' && target.branch !== integrationBranch) {
    const integrated = await execFileAsync('git.exe', ['-C', project.repository, 'merge-base', '--is-ancestor', target.branch, integrationBranch]);
    const basedOnIntegration = await execFileAsync('git.exe', ['-C', project.repository, 'merge-base', '--is-ancestor', integrationBranch, target.branch]);
    alreadyIntegrated = integrated.exitCode === 0;
    integrationIsAncestor = basedOnIntegration.exitCode === 0;
  }
  const canFastForward = Boolean(
    integrationTarget && !target.mainCheckout && target.branch && target.branch !== 'detached HEAD'
    && target.branch !== integrationBranch && files.length === 0 && integrationTarget.clean
    && integrationIsAncestor && !alreadyIntegrated
  );
  const canCleanup = Boolean(
    integrationTarget && !target.mainCheckout && target.branch && target.branch !== 'detached HEAD'
    && target.branch !== integrationBranch && files.length === 0 && alreadyIntegrated
  );
  const cleanupCandidates = [];
  for (const candidate of targets) {
    if (!candidate.available || candidate.mainCheckout || !candidate.clean || candidate.path === workingDirectory
      || !candidate.branch?.startsWith('ai/') || candidate.branch === integrationBranch) continue;
    const integrated = await execFileAsync('git.exe', ['-C', project.repository, 'merge-base', '--is-ancestor', candidate.branch, integrationBranch]);
    if (integrated.exitCode === 0) cleanupCandidates.push({ path: candidate.path, branch: candidate.branch });
  }
  return {
    projectId: project.id, projectName: project.name, repository: project.repository,
    worktree: workingDirectory, worktreeKind: target.kind, mainCheckout: target.mainCheckout, targets,
    branch: currentBranch, commitDraft: await getCommitDraft(project.id, currentBranch), remote: remote.exitCode === 0 ? remote.stdout.trim() : null,
    githubAuthenticated: ghAuth.exitCode === 0, clean: files.length === 0, files,
    ahead, behind, hasUpstream: upstream.exitCode === 0,
    lastCommit: hash ? { hash, subject, committedAt } : null, cleanupCandidates,
    integration: {
      branch: integrationBranch, worktree: integrationTarget?.path || null,
      selectedIsIntegration: target.branch === integrationBranch,
      alreadyIntegrated, canFastForward, canCleanup,
      reason: canFastForward || canCleanup ? null
        : target.branch === integrationBranch ? 'Der Integrationsbranch ist bereits ausgewählt.'
          : files.length ? 'Committe zuerst die ausgewählten Änderungen.'
            : alreadyIntegrated ? `Dieser Aufgabenstand ist bereits in ${integrationBranch} enthalten.`
              : !integrationTarget ? `Für ${integrationBranch} ist kein verfügbarer Worktree geöffnet.`
                : !integrationTarget.clean ? `${integrationBranch} enthält lokale Änderungen.`
                  : !integrationIsAncestor ? `Der Aufgabenbranch basiert nicht mehr direkt auf ${integrationBranch}.`
                    : 'Der Aufgabenstand kann nicht automatisch integriert werden.',
    },
  };
}

async function removeIntegratedTaskWorktree(project, state) {
  const remoteBranch = await execFileAsync('git.exe', ['-C', project.repository, 'show-ref', '--verify', '--quiet', `refs/remotes/origin/${state.branch}`]);
  if (remoteBranch.exitCode === 0) {
    const remoteDelete = await execFileAsync('git.exe', ['-C', state.integration.worktree, 'push', 'origin', '--delete', state.branch], { timeout: 180000 });
    if (remoteDelete.exitCode !== 0) throw new Error(`Deleting remote task branch ${state.branch} failed: ${remoteDelete.stderr.trim() || remoteDelete.stdout.trim()}`);
  }
  const removeWorktree = await execFileAsync('git.exe', ['-C', project.repository, 'worktree', 'remove', state.worktree], { timeout: 120000 });
  if (removeWorktree.exitCode !== 0) throw new Error(`Removing task worktree ${state.worktree} failed: ${removeWorktree.stderr.trim() || removeWorktree.stdout.trim()}`);
  const deleteBranch = await execFileAsync('git.exe', ['-C', project.repository, 'branch', '-d', state.branch]);
  if (deleteBranch.exitCode !== 0) throw new Error(`Deleting local task branch ${state.branch} failed: ${deleteBranch.stderr.trim() || deleteBranch.stdout.trim()}`);
  await clearCommitDraft(project.id, state.branch);
  return { branch: state.branch, remoteDeleted: remoteBranch.exitCode === 0 };
}

async function updateCommitDraft(payload) {
  const { project } = await getProject(String(payload.projectId || ''));
  const state = await getGitState(project, payload.worktree);
  const message = String(payload.message || '').replace(/[\r\n]+/g, ' ').trim();
  if (message.length > 200) throw new Error('Commit draft must not exceed 200 characters.');
  if (message) await setCommitDraft(project.id, state.branch, message);
  else await clearCommitDraft(project.id, state.branch);
  return { branch: state.branch, message: message || null };
}

async function integrateGitWorktree(payload) {
  const { project } = await getProject(String(payload.projectId || ''));
  const state = await getGitState(project, payload.worktree);
  if ((!state.integration.canFastForward && !state.integration.canCleanup) || !state.integration.worktree) {
    throw new Error(state.integration.reason || 'The selected task branch cannot be integrated safely.');
  }
  const merge = state.integration.canFastForward
    ? await execFileAsync('git.exe', ['-C', state.integration.worktree, 'merge', '--ff-only', state.branch], { timeout: 120000 })
    : { exitCode: 0, stdout: `Branch ${state.branch} is already contained in ${state.integration.branch}.`, stderr: '' };
  if (merge.exitCode !== 0) throw new Error(merge.stderr.trim() || merge.stdout.trim() || `Fast-forward into ${state.integration.branch} failed.`);
  const cleanup = await removeIntegratedTaskWorktree(project, state);
  componentCache.delete(project.id);
  return {
    ok: true,
    output: (merge.stdout || merge.stderr).trim(),
    deletedBranch: cleanup.branch,
    deletedRemoteBranch: cleanup.remoteDeleted,
    alreadyIntegrated: state.integration.alreadyIntegrated,
    state: await getGitState(project, state.integration.worktree),
  };
}

async function cleanupMergedGitWorktrees(payload) {
  const { project } = await getProject(String(payload.projectId || ''));
  const requested = [...new Set(Array.isArray(payload.worktrees) ? payload.worktrees.map((entry) => path.resolve(String(entry))) : [])];
  if (!requested.length || requested.length > 20) throw new Error('Select between 1 and 20 completed task worktrees for cleanup.');
  const integrationBranch = await getIntegrationBranch(project);
  const integrationTargets = await getProjectWorktrees(project);
  const integrationWorktree = integrationTargets.find((candidate) => candidate.branch === integrationBranch && candidate.available)?.path;
  if (!integrationWorktree) throw new Error(`No available checkout for ${integrationBranch}.`);
  const cleaned = [];
  for (const worktree of requested) {
    const state = await getGitState(project, worktree);
    if (!state.integration.canCleanup) throw new Error(`${state.branch} is not a clean, already-integrated task branch.`);
    cleaned.push(await removeIntegratedTaskWorktree(project, state));
  }
  componentCache.delete(project.id);
  return { ok: true, cleaned, state: await getGitState(project, integrationWorktree) };
}

async function getGitFileDiff(project, requestedPath, requestedWorktree = null) {
  const filePath = String(requestedPath || '');
  const state = await getGitState(project, requestedWorktree);
  const file = state.files.find((candidate) => candidate.path === filePath);
  if (!file || path.isAbsolute(filePath) || filePath.split(/[\\/]/).includes('..')) throw new Error('Requested file is no longer part of the current Git status.');
  const imageType = GIT_IMAGE_TYPES.get(path.extname(filePath).toLowerCase());
  const imageUrl = imageType && file.staged !== 'D' && file.working !== 'D'
    ? `/api/git/image?projectId=${encodeURIComponent(project.id)}&worktree=${encodeURIComponent(state.worktree)}&path=${encodeURIComponent(filePath)}` : null;
  const limit = 400000;
  let text = '';
  if (file.untracked) {
    const absolute = path.join(state.worktree, filePath);
    const stat = await fsp.stat(absolute);
    if (stat.size > limit) return { path: filePath, diff: `Neue Datei · ${stat.size} Bytes`, truncated: false, binary: Boolean(imageType), imageUrl };
    const buffer = await fsp.readFile(absolute);
    if (buffer.includes(0)) return { path: filePath, diff: `Neue Binärdatei · ${stat.size} Bytes`, truncated: false, binary: true, imageUrl };
    text = `--- /dev/null\n+++ b/${filePath.replace(/\\/g, '/')}\n@@ Neue Datei @@\n` + buffer.toString('utf8').split(/\r?\n/).map((line) => `+${line}`).join('\n');
  } else {
    const cached = await execFileAsync('git.exe', ['-C', state.worktree, 'diff', '--cached', '--no-ext-diff', '--unified=3', '--', filePath]);
    const working = await execFileAsync('git.exe', ['-C', state.worktree, 'diff', '--no-ext-diff', '--unified=3', '--', filePath]);
    text = [cached.stdout && '# Bereits gestaged\n' + cached.stdout, working.stdout && '# Arbeitsverzeichnis\n' + working.stdout].filter(Boolean).join('\n');
    if (!text && file.originalPath) text = `Umbenannt: ${file.originalPath} -> ${filePath}`;
  }
  return { path: filePath, diff: text.slice(0, limit) || (imageUrl ? 'Bilddatei · Vorschau oben' : 'Für diese Datei ist kein Text-Diff verfügbar.'), truncated: text.length > limit, binary: Boolean(imageType), imageUrl };
}

async function serveGitFileImage(project, requestedPath, requestedWorktree, response) {
  const filePath = String(requestedPath || '');
  const state = await getGitState(project, requestedWorktree);
  const file = state.files.find((candidate) => candidate.path === filePath);
  const mime = GIT_IMAGE_TYPES.get(path.extname(filePath).toLowerCase());
  if (!file || !mime || file.staged === 'D' || file.working === 'D' || path.isAbsolute(filePath) || filePath.split(/[\\/]/).includes('..')) throw new Error('Requested image is not an available changed file.');
  const root = await fsp.realpath(state.worktree);
  const absolute = await fsp.realpath(path.resolve(state.worktree, filePath));
  if (!withinRoot(root, absolute)) throw new Error('Requested image resolves outside the selected worktree.');
  const stat = await fsp.stat(absolute);
  if (!stat.isFile() || stat.size > MAX_GIT_IMAGE_BYTES) throw new Error('Changed image is unavailable or exceeds the 20 MB preview limit.');
  response.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(absolute).pipe(response);
}

async function commitGitChanges(payload) {
  const { project } = await getProject(String(payload.projectId || ''));
  const message = String(payload.message || '').trim();
  const requestedPaths = [...new Set(Array.isArray(payload.paths) ? payload.paths.map(String) : [])];
  if (!message || message.length > 200) throw new Error('Commit message must contain between 1 and 200 characters.');
  if (!requestedPaths.length) throw new Error('Select at least one changed file.');
  const state = await getGitState(project, payload.worktree);
  const currentPaths = new Set(state.files.map((file) => file.path));
  if (requestedPaths.some((candidate) => !currentPaths.has(candidate) || path.isAbsolute(candidate) || candidate.split(/[\\/]/).includes('..'))) {
    throw new Error('A selected path is no longer part of the current Git status. Reload the review.');
  }
  const alreadyStaged = state.files.filter((file) => file.staged !== ' ' && file.staged !== '?').map((file) => file.path);
  if (alreadyStaged.some((candidate) => !requestedPaths.includes(candidate))) {
    throw new Error('There are already staged files outside the selection. Select them too or unstage them before committing.');
  }
  const add = await execFileAsync('git.exe', ['-C', state.worktree, 'add', '--', ...requestedPaths], { timeout: 60000 });
  if (add.exitCode !== 0) throw new Error(add.stderr.trim() || 'Git add failed.');
  const commit = await execFileAsync('git.exe', ['-C', state.worktree, 'commit', '-m', message], { timeout: 120000 });
  if (commit.exitCode !== 0) throw new Error(commit.stderr.trim() || commit.stdout.trim() || 'Git commit failed.');
  await clearCommitDraft(project.id, state.branch);
  componentCache.delete(project.id);
  return { ok: true, output: commit.stdout.trim(), state: await getGitState(project, state.worktree) };
}

async function pushGitBranch(payload) {
  const { project } = await getProject(String(payload.projectId || ''));
  const state = await getGitState(project, payload.worktree);
  if (!state.branch || !/^[A-Za-z0-9._\/-]+$/.test(state.branch)) throw new Error('Current branch name is not safe to push.');
  if (!state.remote) throw new Error('No origin remote is configured.');
  const push = await execFileAsync('git.exe', ['-C', state.worktree, 'push', '-u', 'origin', state.branch], { timeout: 180000 });
  if (push.exitCode !== 0) throw new Error(push.stderr.trim() || push.stdout.trim() || 'Git push failed.');
  return { ok: true, output: (push.stdout || push.stderr).trim(), state: await getGitState(project, state.worktree) };
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
    if (request.method === 'GET' && url.pathname === '/api/events') return serveLiveEvents(request, response);
    if (request.method === 'GET' && url.pathname === '/api/projects') return sendJson(response, 200, await loadProjects());
    if (request.method === 'GET' && url.pathname === '/api/portfolio') return sendJson(response, 200, await getPortfolio());
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
    if (request.method === 'POST' && url.pathname === '/api/systems/install') return sendJson(response, 202, await installSystem(await readJsonBody(request)));
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
    if (request.method === 'GET' && url.pathname === '/api/git') {
      const { project } = await getProject(projectId); return sendJson(response, 200, await getGitState(project, url.searchParams.get('worktree')));
    }
    if (request.method === 'GET' && url.pathname === '/api/git/diff') {
      const { project } = await getProject(projectId); return sendJson(response, 200, await getGitFileDiff(project, url.searchParams.get('path'), url.searchParams.get('worktree')));
    }
    if (request.method === 'GET' && url.pathname === '/api/git/image') {
      const { project } = await getProject(projectId); return serveGitFileImage(project, url.searchParams.get('path'), url.searchParams.get('worktree'), response);
    }
    if (request.method === 'POST' && url.pathname === '/api/git/commit') return sendJson(response, 200, await commitGitChanges(await readJsonBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/git/commit-draft') return sendJson(response, 200, await updateCommitDraft(await readJsonBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/git/push') return sendJson(response, 200, await pushGitBranch(await readJsonBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/git/integrate') return sendJson(response, 200, await integrateGitWorktree(await readJsonBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/git/cleanup-merged') return sendJson(response, 200, await cleanupMergedGitWorktrees(await readJsonBody(request)));
    if (request.method === 'GET' && url.pathname === '/api/jobs') {
      const rows = Array.from(jobs.values()).map(snapshotJob).filter((job) => !projectId || job.projectId === projectId || job.kind === 'provision' || job.kind === 'dashboard-command').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return sendJson(response, 200, rows);
    }
    if (request.method === 'GET' && url.pathname === '/api/runs') {
      const { project } = await getProject(projectId); return sendJson(response, 200, await listRuns(project.id));
    }
    if (request.method === 'GET' && url.pathname === '/api/task-attachment') return serveTaskAttachment(url, response);
    if (request.method === 'GET' && url.pathname === '/api/config') return sendJson(response, 200, {
      runRoot: RUN_ROOT, worktreeRoot: WORKTREE_ROOT, routerRoot: ROUTER_ROOT, dataRoot: DATA_ROOT, obsidianVault: OBSIDIAN_VAULT,
      defaultProjectParent: fs.existsSync('C:\\Repos') ? 'C:\\Repos' : path.join(HOME, 'Documents', 'Projects'),
      providerModels: await getProviderModelCatalog(url.searchParams.get('force') === '1'), defaultProviderOrder: DEFAULT_PROVIDER_ORDER,
    });
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

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000).unref();
}

if (require.main === module) {
  server.listen(PORT, HOST, async () => {
    await fsp.mkdir(RUN_ROOT, { recursive: true });
    await loadProjects();
    process.stdout.write(`AI_PROJECT_CONTROL_READY http://${HOST}:${PORT}\n`);
  });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { defaultCommitMessage, taskBranchSlug, normalizeProviderOrder, normalizeProviderModels };
