'use strict';

const elements = {
  connection: document.getElementById('connectionState'), refresh: document.getElementById('refreshButton'),
  projectSelect: document.getElementById('projectSelect'), addProject: document.getElementById('addProjectButton'),
  providerList: document.getElementById('providerList'), componentList: document.getElementById('componentList'),
  taskHeading: document.getElementById('taskHeading'), form: document.getElementById('taskForm'), task: document.getElementById('taskText'),
  provider: document.getElementById('providerSelect'), mode: document.getElementById('modeSelect'),
  useSubscriptionTokens: document.getElementById('useSubscriptionTokens'),
  start: document.getElementById('startButton'), formMessage: document.getElementById('formMessage'), jobs: document.getElementById('jobList'),
  knowledgeProjectName: document.getElementById('knowledgeProjectName'), graphSearch: document.getElementById('graphSearch'),
  graphRefresh: document.getElementById('graphRefreshButton'), graphStats: document.getElementById('graphStats'),
  graphCanvas: document.getElementById('graphCanvas'), graphDetails: document.getElementById('graphDetails'),
  obsidianSearch: document.getElementById('obsidianSearch'), obsidianRefresh: document.getElementById('obsidianRefreshButton'),
  obsidianStats: document.getElementById('obsidianStats'), noteList: document.getElementById('noteList'),
  noteTitle: document.getElementById('noteTitle'), noteContent: document.getElementById('noteContent'),
  history: document.getElementById('conversationHistory'), historyRefresh: document.getElementById('historyRefreshButton'),
  memoryForm: document.getElementById('memoryForm'), memoryText: document.getElementById('memoryText'), memoryMessage: document.getElementById('memoryMessage'),
  systemsRefresh: document.getElementById('systemsRefreshButton'), projectSystems: document.getElementById('projectSystems'),
  globalSystems: document.getElementById('globalSystems'), systemForm: document.getElementById('systemForm'),
  systemName: document.getElementById('systemName'), systemType: document.getElementById('systemType'), systemPath: document.getElementById('systemPath'),
  systemScope: document.getElementById('systemScope'), systemNote: document.getElementById('systemNote'), systemMessage: document.getElementById('systemMessage'),
  provisionForm: document.getElementById('provisionForm'), provisionName: document.getElementById('provisionName'),
  provisionSlug: document.getElementById('provisionSlug'), provisionParent: document.getElementById('provisionParent'),
  provisionDescription: document.getElementById('provisionDescription'), provisionGitHub: document.getElementById('provisionGitHub'),
  provisionVisibility: document.getElementById('provisionVisibility'), provisionMessage: document.getElementById('provisionMessage'),
  projectMessage: document.getElementById('projectMessage'),
  projectList: document.getElementById('projectList'),
};

let config = null;
let registry = null;
let activeProject = null;
let refreshing = false;
let graphData = null;
let graphPositions = new Map();
let selectedGraphNodeId = null;
let graphSearchTimer = null;
let obsidianSearchTimer = null;

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function projectQuery() {
  return `projectId=${encodeURIComponent(activeProject.id)}`;
}

function statusClass(ok, available) {
  if (!ok) return 'fail';
  return available ? 'ok' : 'warn';
}

function providerRow(name, provider, detail, percent = null) {
  const row = document.createElement('div'); row.className = 'provider-row';
  const line = document.createElement('div'); line.className = 'row-line';
  const label = document.createElement('span'); label.className = 'row-name'; label.textContent = name;
  const state = document.createElement('span'); state.className = `status ${statusClass(true, provider.available)}`;
  state.textContent = provider.available ? 'bereit' : 'wartet'; line.append(label, state);
  const description = document.createElement('div'); description.className = 'row-detail'; description.textContent = detail;
  row.append(line, description);
  if (percent !== null) {
    const meter = document.createElement('div'); meter.className = 'meter';
    const fill = document.createElement('span'); fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    fill.className = percent >= 100 ? 'full' : percent >= 80 ? 'high' : ''; meter.append(fill); row.append(meter);
  }
  return row;
}

function renderProviders(status) {
  elements.providerList.replaceChildren();
  const codex = status.codex;
  const creditNote = codex.credits?.has_credits ? ` · Zusatz-Credits ${Number(codex.credits.balance).toFixed(2)} (gesperrt)` : ' · keine abrechenbaren API-Credits verwendet';
  const codexDetail = codex.quota_known
    ? `${codex.primary_used_percent}% im 5h-Fenster · Reset ${codex.primary_resets_local} · Woche ${codex.secondary_used_percent}%${creditNote}`
    : codex.reason || 'Kontingent unbekannt';
  elements.providerList.append(providerRow('1. Codex', codex, codexDetail, codex.primary_used_percent ?? null));
  const claude = status.claude;
  const claudeDetail = claude.available ? `${claude.subscription_type || 'Subscription'} · Restkontingent wird von Claude nicht numerisch bereitgestellt · API-Abrechnung gesperrt`
    : claude.retry_not_before_local ? `Nächste Prüfung ab ${claude.retry_not_before_local}` : claude.reason || 'Nicht verfügbar';
  elements.providerList.append(providerRow('2. Claude Code', claude, claudeDetail));
  const ollama = status.ollama;
  elements.providerList.append(providerRow('3. Ollama', ollama, ollama.available ? `${ollama.model} · lokal` : ollama.reason || 'Nicht verfügbar'));
}

function componentRow(name, ok, detail) {
  const row = document.createElement('div'); row.className = 'component-row';
  const line = document.createElement('div'); line.className = 'row-line';
  const label = document.createElement('span'); label.className = 'row-name'; label.textContent = name;
  const state = document.createElement('span'); state.className = `status ${ok ? 'ok' : 'fail'}`; state.textContent = ok ? 'ok' : 'fehlt';
  line.append(label, state);
  const description = document.createElement('div'); description.className = 'row-detail'; description.textContent = detail;
  row.append(line, description); return row;
}

function renderComponents(data) {
  elements.componentList.replaceChildren();
  elements.componentList.append(componentRow('Provider Router', data.router.ok, data.router.path));
  elements.componentList.append(componentRow('Codex CLI', data.codex.ok, data.codex.text));
  elements.componentList.append(componentRow('Claude Code', data.claude.ok, data.claude.text));
  elements.componentList.append(componentRow('Hermes', data.hermes.ok, data.hermes.text));
  elements.componentList.append(componentRow('Ollama', data.ollama.ok, data.ollama.text));
  elements.componentList.append(componentRow('Graphify', data.graphify.ok, data.graphify.text));
  elements.componentList.append(componentRow('ECC', data.ecc.ok, `Commit ${data.ecc.commit}`));
  elements.componentList.append(componentRow('MCP', data.mcp.ok, data.mcp.text));
  elements.componentList.append(componentRow('Obsidian', data.obsidian.ok, data.obsidian.path));
  elements.componentList.append(componentRow('Repository', data.repository.ok && data.repository.clean, `${data.repository.branch} · ${data.repository.clean ? 'clean' : 'Änderungen vorhanden'}`));
}

function formatTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
}

function renderJobs(jobs) {
  elements.jobs.replaceChildren();
  if (!jobs.length) {
    const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Noch keine Jobs in dieser Dashboard-Sitzung.';
    elements.jobs.append(empty); return;
  }
  for (const job of jobs) {
    const container = document.createElement('article'); container.className = 'job';
    const head = document.createElement('div'); head.className = 'job-head';
    const title = document.createElement('div'); const heading = document.createElement('h3'); heading.textContent = `${job.projectName || 'Projekt'} · ${job.provider}`;
    const meta = document.createElement('div'); meta.className = 'job-meta'; meta.textContent = `${formatTime(job.startedAt)} · ${job.workingDirectory}`;
    title.append(heading, meta);
    const state = document.createElement('span');
    const stateClass = job.status === 'completed' ? 'ok' : job.status === 'failed' ? 'fail' : job.status === 'stopped' ? 'warn' : 'info';
    state.className = `status ${stateClass}`; state.textContent = job.status; head.append(title, state);
    const task = document.createElement('div'); task.className = 'job-task'; task.textContent = `${job.phase || job.mode} · ${job.taskPreview}`;
    container.append(head, task);
    if (job.status === 'running') {
      const stop = document.createElement('button'); stop.className = 'button danger'; stop.type = 'button';
      stop.dataset.stopJob = job.id; stop.textContent = 'Stoppen'; container.append(stop);
    }
    const feed = document.createElement('div'); feed.className = 'feed-log';
    const stdoutLines = String(job.stdout || '').split(/\r?\n/).filter(Boolean).map((line) => ({ line, kind: line.includes('AI_EVENT') || /^\[\d{4}-/.test(line) ? 'event' : '' }));
    const stderrLines = String(job.stderr || '').split(/\r?\n/).filter(Boolean).map((line) => ({ line, kind: 'error' }));
    const lines = [...stdoutLines, ...stderrLines].slice(-80);
    if (!lines.length) {
      const waiting = document.createElement('div'); waiting.className = 'feed-line'; waiting.textContent = 'Warte auf Agentenausgabe…'; feed.append(waiting);
    } else {
      for (const entry of lines) {
        const line = document.createElement('div'); line.className = `feed-line ${entry.kind}`; line.textContent = summarizeFeedLine(entry.line); feed.append(line);
      }
    }
    container.append(feed); elements.jobs.append(container);
  }
}

function summarizeFeedLine(line) {
  if (line.includes('AI_EVENT')) return line.replace(/^.*?AI_EVENT\s*/, '');
  const stream = line.match(/AI_STREAM provider=([^\s]+)\s+(.+)/);
  if (stream) {
    try {
      const event = JSON.parse(stream[2]);
      const type = event.type || event.item?.type || 'event';
      const detail = event.item?.command || event.item?.text || event.item?.name || event.message || '';
      return `${stream[1]} · ${type}${detail ? ` · ${String(detail).slice(0, 280)}` : ''}`;
    } catch { return `${stream[1]} · ${stream[2].slice(0, 320)}`; }
  }
  return line.slice(0, 500);
}

function showView(name) {
  document.querySelectorAll('[data-view-panel]').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.viewPanel !== name));
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
  if (name === 'knowledge') loadActiveKnowledge();
  if (name === 'tasks') { refreshHistory(); refreshJobs(); }
  if (name === 'systems') loadSystems();
}

function renderProjectSelector() {
  elements.projectSelect.replaceChildren();
  for (const project of registry.projects) {
    const option = document.createElement('option'); option.value = project.id; option.textContent = project.name;
    option.selected = project.id === activeProject.id; elements.projectSelect.append(option);
  }
  elements.taskHeading.textContent = `Gespräch mit ${activeProject.name}`;
  elements.knowledgeProjectName.textContent = activeProject.name;
}

function renderProjectList() {
  elements.projectList.replaceChildren();
  for (const project of registry.projects) {
    const row = document.createElement('div'); row.className = 'project-row';
    const info = document.createElement('div'); const title = document.createElement('h3'); title.textContent = project.name;
    const repository = document.createElement('div'); repository.className = 'project-path'; repository.textContent = project.repository;
    const graph = document.createElement('div'); graph.className = 'project-path'; graph.textContent = `Graphify: ${project.graphPath}`;
    const obsidian = document.createElement('div'); obsidian.className = 'project-path'; obsidian.textContent = `Obsidian: ${project.obsidianPath}`;
    info.append(title, repository, graph, obsidian);
    const actions = document.createElement('div'); actions.className = 'project-actions';
    if (project.id !== activeProject.id) {
      const select = document.createElement('button'); select.type = 'button'; select.className = 'button secondary';
      select.dataset.selectProject = project.id; select.textContent = 'Auswählen'; actions.append(select);
    }
    if (registry.projects.length > 1) {
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button danger';
      remove.dataset.removeProject = project.id; remove.textContent = 'Entfernen'; actions.append(remove);
    }
    row.append(info, actions); elements.projectList.append(row);
  }
}

function renderSystemRows(container, systems) {
  container.replaceChildren();
  for (const system of systems) {
    const item = document.createElement('article'); item.className = 'system-item';
    const head = document.createElement('div'); head.className = 'system-head';
    const name = document.createElement('h3'); name.textContent = system.name;
    const state = document.createElement('span'); state.className = `status ${system.ok ? 'ok' : 'warn'}`; state.textContent = system.status;
    head.append(name, state);
    const category = document.createElement('div'); category.className = 'system-category'; category.textContent = system.category;
    const detail = document.createElement('div'); detail.className = 'system-detail'; detail.textContent = system.detail || system.path || '—';
    item.append(head, category, detail);
    if (!system.autoDetected) {
      const actions = document.createElement('div'); actions.className = 'system-actions';
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button danger table-button';
      remove.dataset.removeSystem = system.id; remove.textContent = 'Entfernen'; actions.append(remove); item.append(actions);
    }
    container.append(item);
  }
}

async function loadSystems(force = false) {
  if (!activeProject) return;
  try {
    const inventory = await api(`/api/systems?${projectQuery()}${force ? '&force=1' : ''}`);
    renderSystemRows(elements.projectSystems, inventory.project);
    renderSystemRows(elements.globalSystems, inventory.global);
  } catch (error) { elements.systemMessage.textContent = error.message; }
}

async function activateProject(projectId) {
  await api(`/api/projects/${encodeURIComponent(projectId)}/select`, { method: 'POST', body: '{}' });
  registry = await api('/api/projects');
  activeProject = registry.projects.find((project) => project.id === registry.activeProjectId);
  graphData = null; selectedGraphNodeId = null;
  renderProjectSelector(); renderProjectList(); resetKnowledge();
  await refreshAll(true);
}

function resetKnowledge() {
  elements.graphStats.textContent = '';
  elements.graphDetails.innerHTML = '<p class="empty">Wähle einen Knoten im Graphen.</p>';
  const context = elements.graphCanvas.getContext('2d'); context.clearRect(0, 0, elements.graphCanvas.width, elements.graphCanvas.height);
  elements.noteList.replaceChildren(); elements.noteTitle.textContent = 'Keine Notiz ausgewählt'; elements.noteContent.textContent = 'Wähle links eine Notiz aus.';
}

function graphColor(value) {
  const palette = ['#54c985', '#6eadd8', '#e3b957', '#d67b9c', '#9a8bd4', '#74b9a5', '#d88762', '#a5b66f'];
  let hash = 0; for (const character of String(value)) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

function layoutGraph(width, height) {
  graphPositions = new Map();
  if (!graphData?.nodes.length) return;
  const groups = new Map();
  for (const node of graphData.nodes) {
    const key = node.community || node.type || 'Other';
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(node);
  }
  const groupEntries = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const centerX = width / 2; const centerY = height / 2; const orbit = Math.max(40, Math.min(width, height) * 0.32);
  groupEntries.forEach(([name, nodes], groupIndex) => {
    const groupAngle = (Math.PI * 2 * groupIndex) / Math.max(1, groupEntries.length) - Math.PI / 2;
    const groupX = groupEntries.length === 1 ? centerX : centerX + Math.cos(groupAngle) * orbit;
    const groupY = groupEntries.length === 1 ? centerY : centerY + Math.sin(groupAngle) * orbit;
    const radius = Math.max(18, Math.min(90, 10 + Math.sqrt(nodes.length) * 10));
    nodes.sort((a, b) => b.degree - a.degree).forEach((node, index) => {
      const angle = index * 2.3999632297;
      const distance = radius * Math.sqrt((index + 0.5) / nodes.length);
      graphPositions.set(node.id, { x: groupX + Math.cos(angle) * distance, y: groupY + Math.sin(angle) * distance, color: graphColor(name) });
    });
  });
}

function drawGraph() {
  const canvas = elements.graphCanvas; const rect = canvas.getBoundingClientRect(); const ratio = window.devicePixelRatio || 1;
  const width = Math.max(320, rect.width); const height = Math.max(280, rect.height);
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  const context = canvas.getContext('2d'); context.scale(ratio, ratio); context.clearRect(0, 0, width, height);
  if (!graphData?.nodes.length) {
    context.fillStyle = '#a8b0ac'; context.font = '13px Segoe UI'; context.fillText('Kein Graph geladen.', 18, 28); return;
  }
  layoutGraph(width, height);
  context.lineWidth = 0.7; context.strokeStyle = 'rgba(143, 154, 149, 0.24)'; context.beginPath();
  for (const link of graphData.links) {
    const source = graphPositions.get(link.source); const target = graphPositions.get(link.target);
    if (!source || !target) continue; context.moveTo(source.x, source.y); context.lineTo(target.x, target.y);
  }
  context.stroke();
  const selectedNeighbors = new Set();
  if (selectedGraphNodeId) {
    for (const link of graphData.links) {
      if (link.source === selectedGraphNodeId) selectedNeighbors.add(link.target);
      if (link.target === selectedGraphNodeId) selectedNeighbors.add(link.source);
    }
  }
  for (const node of graphData.nodes) {
    const position = graphPositions.get(node.id); const selected = node.id === selectedGraphNodeId;
    const neighbor = selectedNeighbors.has(node.id); const radius = selected ? 8 : neighbor ? 6 : Math.min(5.5, 2.5 + Math.sqrt(node.degree) * 0.32);
    context.beginPath(); context.arc(position.x, position.y, radius, 0, Math.PI * 2);
    context.fillStyle = selected ? '#eef1ee' : position.color; context.globalAlpha = selectedGraphNodeId && !selected && !neighbor ? 0.35 : 0.9; context.fill();
  }
  context.globalAlpha = 1;
  const selectedNode = graphData.nodes.find((node) => node.id === selectedGraphNodeId);
  if (selectedNode) {
    const position = graphPositions.get(selectedNode.id); context.fillStyle = '#eef1ee'; context.font = '600 12px Segoe UI';
    context.fillText(selectedNode.label.slice(0, 42), Math.min(position.x + 11, width - 220), Math.max(18, position.y - 10));
  }
}

function renderGraphDetails(nodeId) {
  selectedGraphNodeId = nodeId; elements.graphDetails.replaceChildren();
  const node = graphData?.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) { elements.graphDetails.innerHTML = '<p class="empty">Wähle einen Knoten im Graphen.</p>'; drawGraph(); return; }
  const title = document.createElement('h3'); title.textContent = node.label; const list = document.createElement('dl');
  for (const [label, value] of [['Typ', node.type || '—'], ['Community', node.community || '—'], ['Quelle', `${node.sourceFile || '—'}${node.sourceLocation ? ` · ${node.sourceLocation}` : ''}`], ['Verbindungen', String(node.degree)]]) {
    const term = document.createElement('dt'); term.textContent = label; const detail = document.createElement('dd'); detail.textContent = value; list.append(term, detail);
  }
  const neighborIds = [];
  for (const link of graphData.links) {
    if (link.source === node.id) neighborIds.push(link.target); else if (link.target === node.id) neighborIds.push(link.source);
  }
  const neighbors = [...new Set(neighborIds)].map((id) => graphData.nodes.find((candidate) => candidate.id === id)).filter(Boolean).slice(0, 12);
  if (neighbors.length) {
    const term = document.createElement('dt'); term.textContent = 'Nachbarn'; const detail = document.createElement('dd');
    const items = document.createElement('ul'); items.className = 'neighbor-list';
    for (const neighbor of neighbors) { const item = document.createElement('li'); item.textContent = neighbor.label; items.append(item); }
    detail.append(items); list.append(term, detail);
  }
  elements.graphDetails.append(title, list); drawGraph();
}

async function loadGraph() {
  elements.graphStats.textContent = 'Graph wird geladen…';
  try {
    const query = elements.graphSearch.value.trim();
    graphData = await api(`/api/graph?${projectQuery()}&q=${encodeURIComponent(query)}`);
    selectedGraphNodeId = null;
    elements.graphStats.textContent = `${graphData.totals.nodes} Knoten · ${graphData.totals.links} Beziehungen${graphData.truncated ? ' · fokussierte Ansicht' : ''}${graphData.builtAtCommit ? ` · Commit ${graphData.builtAtCommit.slice(0, 8)}` : ''}`;
    renderGraphDetails(null); drawGraph();
  } catch (error) {
    graphData = null; elements.graphStats.textContent = error.message; drawGraph();
  }
}

function renderNoteList(data) {
  elements.noteList.replaceChildren(); elements.obsidianStats.textContent = `${data.total} Notizen · ${data.root}`;
  if (!data.files.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Keine passenden Notizen.'; elements.noteList.append(empty); return; }
  for (const file of data.files) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'note-button';
    button.dataset.notePath = file; button.textContent = file; elements.noteList.append(button);
  }
}

async function loadObsidian(selectedFile = null) {
  elements.obsidianStats.textContent = 'Notizen werden geladen…';
  try {
    const query = elements.obsidianSearch.value.trim();
    const filePart = selectedFile ? `&file=${encodeURIComponent(selectedFile)}` : '';
    const data = await api(`/api/obsidian?${projectQuery()}&q=${encodeURIComponent(query)}${filePart}`);
    renderNoteList(data);
    if (data.note) {
      elements.noteTitle.textContent = data.note.path; elements.noteContent.textContent = data.note.content;
      document.querySelectorAll('.note-button').forEach((button) => button.classList.toggle('active', button.dataset.notePath === data.note.path));
    }
  } catch (error) { elements.obsidianStats.textContent = error.message; elements.noteList.replaceChildren(); }
}

function activeKnowledgeType() {
  return document.querySelector('.segment.active')?.dataset.knowledge || 'graphify';
}

function loadActiveKnowledge() {
  if (activeKnowledgeType() === 'graphify') loadGraph(); else loadObsidian();
}

function messageElement(role, label, text) {
  const message = document.createElement('div'); message.className = `message ${role}`;
  const heading = document.createElement('div'); heading.className = 'message-label'; heading.textContent = label;
  const body = document.createElement('div'); body.className = 'message-body'; body.textContent = text || 'Keine gespeicherte Ausgabe.';
  message.append(heading, body); return message;
}

function renderHistory(runs) {
  elements.history.replaceChildren();
  if (!runs.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Noch kein Lauf für dieses Projekt.'; elements.history.append(empty); return; }
  for (const run of runs) {
    const article = document.createElement('article'); article.className = 'conversation-run';
    const meta = document.createElement('div'); meta.className = 'conversation-meta';
    const identity = document.createElement('span'); identity.textContent = `${formatTime(run.modifiedAt)} · ${run.provider || run.status}`;
    const state = document.createElement('span'); state.className = `status ${run.status === 'PASS' ? 'ok' : run.status === 'external' ? 'info' : 'warn'}`; state.textContent = run.status;
    meta.append(identity, state); article.append(meta);
    if (run.task) article.append(messageElement('user', 'Auftrag', run.task));
    article.append(messageElement('assistant', 'Rückmeldung', run.response));
    const actions = document.createElement('div'); actions.className = 'run-actions';
    const follow = document.createElement('button'); follow.type = 'button'; follow.className = 'button secondary'; follow.dataset.continueRun = run.path; follow.textContent = 'Folgeauftrag';
    const open = document.createElement('button'); open.type = 'button'; open.className = 'button secondary'; open.dataset.openRun = run.path; open.textContent = 'Ordner';
    actions.append(follow, open); article.append(actions); elements.history.append(article);
  }
}

async function refreshStatus(force = false) {
  const [status, components] = await Promise.all([
    api(`/api/status${force ? '?force=1' : ''}`),
    api(`/api/components?${projectQuery()}${force ? '&force=1' : ''}`),
  ]);
  renderProviders(status); renderComponents(components);
}

async function refreshJobs() {
  if (!activeProject) return;
  const rows = await api(`/api/jobs?${projectQuery()}`);
  renderJobs(rows);
  if (rows.some((job) => job.status === 'completed' && job.projectId && !registry.projects.some((project) => project.id === job.projectId))) {
    registry = await api('/api/projects');
    activeProject = registry.projects.find((project) => project.id === registry.activeProjectId) || activeProject;
    renderProjectSelector(); renderProjectList();
  }
}
async function refreshHistory() { if (activeProject) renderHistory(await api(`/api/runs?${projectQuery()}`)); }

async function refreshAll(force = false) {
  if (refreshing || !activeProject) return;
  refreshing = true;
  try {
    await Promise.all([refreshStatus(force), refreshJobs(), refreshHistory()]);
    elements.connection.className = 'connection ok'; elements.connection.textContent = 'Lokal verbunden';
  } catch (error) {
    elements.connection.className = 'connection error'; elements.connection.textContent = error.message;
  } finally { refreshing = false; }
}

async function initialize() {
  try {
    [config, registry] = await Promise.all([api('/api/config'), api('/api/projects')]);
    activeProject = registry.projects.find((project) => project.id === registry.activeProjectId) || registry.projects[0];
    elements.provisionParent.value = config.defaultProjectParent;
    renderProjectSelector(); renderProjectList(); await refreshAll(true);
  } catch (error) { elements.connection.className = 'connection error'; elements.connection.textContent = error.message; }
}

document.querySelector('.view-tabs').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-view]'); if (button) showView(button.dataset.view);
});

document.querySelector('.segmented').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-knowledge]'); if (!button) return;
  document.querySelectorAll('[data-knowledge]').forEach((candidate) => candidate.classList.toggle('active', candidate === button));
  document.querySelectorAll('[data-knowledge-panel]').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.knowledgePanel !== button.dataset.knowledge));
  loadActiveKnowledge();
});

elements.refresh.addEventListener('click', () => refreshAll(true));
elements.historyRefresh.addEventListener('click', refreshHistory);
elements.systemsRefresh.addEventListener('click', () => loadSystems(true));
elements.graphRefresh.addEventListener('click', loadGraph);
elements.obsidianRefresh.addEventListener('click', () => loadObsidian());
elements.addProject.addEventListener('click', () => { showView('projects'); elements.provisionName.focus(); });
elements.projectSelect.addEventListener('change', () => activateProject(elements.projectSelect.value));

elements.memoryForm.addEventListener('submit', async (event) => {
  event.preventDefault(); elements.memoryMessage.textContent = 'Lernnotiz wird gespeichert…';
  try {
    await api('/api/memory', { method: 'POST', body: JSON.stringify({ projectId: activeProject.id, text: elements.memoryText.value }) });
    elements.memoryText.value = ''; elements.memoryMessage.textContent = 'Für künftige Aufgaben gespeichert.';
  } catch (error) { elements.memoryMessage.textContent = error.message; }
});

elements.systemForm.addEventListener('submit', async (event) => {
  event.preventDefault(); elements.systemMessage.textContent = 'System wird registriert…';
  try {
    await api('/api/systems', { method: 'POST', body: JSON.stringify({
      name: elements.systemName.value, type: elements.systemType.value, path: elements.systemPath.value,
      scope: elements.systemScope.value, projectId: activeProject.id, note: elements.systemNote.value,
    }) });
    elements.systemForm.reset(); elements.systemMessage.textContent = 'System wurde registriert.'; await loadSystems(true);
  } catch (error) { elements.systemMessage.textContent = error.message; }
});

elements.provisionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const githubText = elements.provisionGitHub.checked ? ` und als ${elements.provisionVisibility.value} GitHub-Repository` : '';
  if (!window.confirm(`Projekt lokal mit initialem Git-Commit${githubText} erstellen?`)) return;
  elements.provisionMessage.textContent = 'Projektaufbau wurde gestartet. Fortschritt erscheint im Live-Feed.';
  try {
    await api('/api/projects/provision', { method: 'POST', body: JSON.stringify({
      name: elements.provisionName.value, slug: elements.provisionSlug.value,
      parentDirectory: elements.provisionParent.value, description: elements.provisionDescription.value,
      createGitHub: elements.provisionGitHub.checked, visibility: elements.provisionVisibility.value,
    }) });
    showView('tasks'); await refreshJobs();
  } catch (error) { elements.provisionMessage.textContent = error.message; }
});

elements.graphSearch.addEventListener('input', () => {
  clearTimeout(graphSearchTimer); graphSearchTimer = setTimeout(loadGraph, 350);
});
elements.obsidianSearch.addEventListener('input', () => {
  clearTimeout(obsidianSearchTimer); obsidianSearchTimer = setTimeout(() => loadObsidian(), 350);
});

elements.graphCanvas.addEventListener('click', (event) => {
  if (!graphData) return;
  const rect = elements.graphCanvas.getBoundingClientRect(); const x = event.clientX - rect.left; const y = event.clientY - rect.top;
  let closest = null; let closestDistance = 14;
  for (const [id, position] of graphPositions) {
    const distance = Math.hypot(position.x - x, position.y - y);
    if (distance < closestDistance) { closest = id; closestDistance = distance; }
  }
  if (closest) renderGraphDetails(closest);
});

elements.noteList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-note-path]'); if (button) loadObsidian(button.dataset.notePath);
});

elements.form.addEventListener('submit', async (event) => {
  event.preventDefault(); elements.start.disabled = true; elements.formMessage.textContent = 'Task wird gestartet…';
  try {
    const job = await api('/api/tasks', { method: 'POST', body: JSON.stringify({
      projectId: activeProject.id, task: elements.task.value, provider: elements.provider.value,
      mode: elements.mode.value, useSubscriptionTokens: elements.useSubscriptionTokens.checked,
    }) });
    elements.formMessage.textContent = `Job ${job.id.slice(0, 8)} läuft.`; elements.task.value = ''; await refreshJobs();
  } catch (error) { elements.formMessage.textContent = error.message; }
  finally { elements.start.disabled = false; }
});

elements.jobs.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-stop-job]'); if (!button) return; button.disabled = true;
  try { await api(`/api/jobs/${button.dataset.stopJob}/stop`, { method: 'POST', body: '{}' }); await refreshJobs(); }
  catch (error) { elements.formMessage.textContent = error.message; }
});

elements.history.addEventListener('click', async (event) => {
  const open = event.target.closest('button[data-open-run]');
  if (open) { open.disabled = true; try { await api('/api/open-run', { method: 'POST', body: JSON.stringify({ path: open.dataset.openRun }) }); } finally { open.disabled = false; } return; }
  const follow = event.target.closest('button[data-continue-run]');
  if (follow) {
    elements.task.value = `Lies zuerst den vorherigen Lauf unter ${follow.dataset.continueRun} und führe danach folgenden Folgeauftrag aus:\n\n`;
    showView('tasks'); elements.task.focus();
  }
});

elements.projectList.addEventListener('click', async (event) => {
  const select = event.target.closest('button[data-select-project]'); if (select) { await activateProject(select.dataset.selectProject); return; }
  const remove = event.target.closest('button[data-remove-project]'); if (!remove) return;
  const project = registry.projects.find((candidate) => candidate.id === remove.dataset.removeProject);
  if (!window.confirm(`${project.name} nur aus dem Dashboard entfernen? Dateien werden nicht gelöscht.`)) return;
  try {
    await api(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' });
    registry = await api('/api/projects'); activeProject = registry.projects.find((candidate) => candidate.id === registry.activeProjectId);
    renderProjectSelector(); renderProjectList(); resetKnowledge(); await refreshAll(true);
  } catch (error) { elements.projectMessage.textContent = error.message; }
});

document.getElementById('systemsView').addEventListener('click', async (event) => {
  const remove = event.target.closest('button[data-remove-system]'); if (!remove) return;
  if (!window.confirm('System nur aus dem Dashboard entfernen? Dateien werden nicht gelöscht.')) return;
  try { await api(`/api/systems/${encodeURIComponent(remove.dataset.removeSystem)}`, { method: 'DELETE' }); await loadSystems(true); }
  catch (error) { elements.systemMessage.textContent = error.message; }
});

new ResizeObserver(() => { if (graphData) drawGraph(); }).observe(elements.graphCanvas);

initialize();
setInterval(refreshJobs, 3000);
setInterval(refreshStatus, 15000);
setInterval(refreshHistory, 15000);
