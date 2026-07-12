'use strict';

const elements = {
  connection: document.getElementById('connectionState'),
  backgroundActivity: document.getElementById('backgroundActivity'),
  projectSelect: document.getElementById('projectSelect'), addProject: document.getElementById('addProjectButton'),
  providerList: document.getElementById('providerList'), componentList: document.getElementById('componentList'), workflowContext: document.getElementById('workflowContext'),
  taskHeading: document.getElementById('taskHeading'), form: document.getElementById('taskForm'), task: document.getElementById('taskText'),
  attachmentInput: document.getElementById('attachmentInput'), attachmentButton: document.getElementById('attachmentButton'),
  attachmentPreview: document.getElementById('attachmentPreview'),
  provider: document.getElementById('providerSelect'), mode: document.getElementById('modeSelect'),
  useSubscriptionTokens: document.getElementById('useSubscriptionTokens'),
  start: document.getElementById('startButton'), formMessage: document.getElementById('formMessage'), jobs: document.getElementById('jobList'),
  knowledgeProjectName: document.getElementById('knowledgeProjectName'), knowledgeSearch: document.getElementById('knowledgeSearch'),
  knowledgeLoadState: document.getElementById('knowledgeLoadState'), graphStats: document.getElementById('graphStats'),
  graphCanvas: document.getElementById('graphCanvas'), graphDetails: document.getElementById('graphDetails'),
  obsidianStats: document.getElementById('obsidianStats'), noteList: document.getElementById('noteList'),
  noteTitle: document.getElementById('noteTitle'), noteContent: document.getElementById('noteContent'),
  history: document.getElementById('conversationHistory'),
  memoryForm: document.getElementById('memoryForm'), memoryText: document.getElementById('memoryText'), memoryMessage: document.getElementById('memoryMessage'),
  systemsRefresh: document.getElementById('systemsRefreshButton'), systemSetupSummary: document.getElementById('systemSetupSummary'), projectSystems: document.getElementById('projectSystems'),
  globalSystems: document.getElementById('globalSystems'), systemForm: document.getElementById('systemForm'),
  systemName: document.getElementById('systemName'), systemType: document.getElementById('systemType'), systemPath: document.getElementById('systemPath'),
  systemScope: document.getElementById('systemScope'), systemNote: document.getElementById('systemNote'), systemMessage: document.getElementById('systemMessage'),
  provisionForm: document.getElementById('provisionForm'), provisionName: document.getElementById('provisionName'),
  provisionSlug: document.getElementById('provisionSlug'), provisionParent: document.getElementById('provisionParent'),
  provisionDescription: document.getElementById('provisionDescription'), provisionGitHub: document.getElementById('provisionGitHub'),
  provisionVisibility: document.getElementById('provisionVisibility'), provisionMessage: document.getElementById('provisionMessage'),
  attentionList: document.getElementById('attentionList'),
  portfolioProjectName: document.getElementById('portfolioProjectName'), portfolioState: document.getElementById('portfolioState'),
  portfolioNextAction: document.getElementById('portfolioNextAction'), portfolioCurrentTask: document.getElementById('portfolioCurrentTask'),
  portfolioLastRun: document.getElementById('portfolioLastRun'), portfolioRepository: document.getElementById('portfolioRepository'), portfolioKnowledge: document.getElementById('portfolioKnowledge'),
  gitProjectName: document.getElementById('gitProjectName'), gitTarget: document.getElementById('gitTargetSelect'), gitState: document.getElementById('gitState'), gitSummary: document.getElementById('gitSummary'),
  gitFileList: document.getElementById('gitFileList'), gitDiff: document.getElementById('gitDiffContent'), gitSelectAll: document.getElementById('gitSelectAll'),
  gitDiffFileName: document.getElementById('gitDiffFileName'), gitCommitMessage: document.getElementById('gitCommitMessage'),
  gitBranchFlow: document.getElementById('gitBranchFlow'), gitCommit: document.getElementById('gitCommitButton'), gitCommitPush: document.getElementById('gitCommitPushButton'),
  gitIntegrate: document.getElementById('gitIntegrateButton'), gitPush: document.getElementById('gitPushButton'), gitMessage: document.getElementById('gitMessage'),
  busyOverlay: document.getElementById('busyOverlay'), busyTitle: document.getElementById('busyTitle'), busyMessage: document.getElementById('busyMessage'),
};

let config = null;
let registry = null;
let activeProject = null;
let refreshing = false;
let graphData = null;
let graphPositions = new Map();
let selectedGraphNodeId = null;
let graphZoom = 1;
let graphPanX = 0;
let graphPanY = 0;
let graphDrag = null;
let graphDidDrag = false;
let knowledgeSearchTimer = null;
let gitData = null;
let selectedGitFile = null;
let selectedAttachments = [];
let feedFilter = 'important';
let liveJobs = new Map();
let jobEventSource = null;
let jobRenderPending = false;
let componentStatus = null;

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function projectQuery() {
  return `projectId=${encodeURIComponent(activeProject.id)}`;
}

function setBusy(active, title = 'Bitte warten', message = 'Lokaler Projektzustand wird geladen.') {
  elements.busyTitle.textContent = title; elements.busyMessage.textContent = message;
  elements.busyOverlay.classList.toggle('hidden', !active);
  elements.projectSelect.disabled = active;
  document.body.setAttribute('aria-busy', active ? 'true' : 'false');
}

function statusClass(ok, available) {
  if (!ok) return 'fail';
  return available ? 'ok' : 'warn';
}

function providerRow(name, provider, detail, percent = null) {
  const row = document.createElement('div'); row.className = 'provider-row';
  row.title = detail;
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
  elements.providerList.append(providerRow('Codex', codex, codexDetail, codex.primary_used_percent ?? null));
  const claude = status.claude;
  const claudeDetail = claude.available ? `${claude.subscription_type || 'Subscription'} · Restkontingent wird von Claude nicht numerisch bereitgestellt · API-Abrechnung gesperrt`
    : claude.retry_not_before_local ? `Nächste Prüfung ab ${claude.retry_not_before_local}` : claude.reason || 'Nicht verfügbar';
  elements.providerList.append(providerRow('Claude', claude, claudeDetail));
  const ollama = status.ollama;
  elements.providerList.append(providerRow('Hermes + Ollama', ollama, ollama.available ? `${ollama.model} · Read-only` : ollama.reason || 'Nicht verfügbar'));
}

function componentRow(name, ok, detail, warning = false) {
  const row = document.createElement('div'); row.className = 'component-row';
  const line = document.createElement('div'); line.className = 'row-line';
  const label = document.createElement('span'); label.className = 'row-name'; label.textContent = name;
  const state = document.createElement('span'); state.className = `status ${warning ? 'warn' : ok ? 'ok' : 'fail'}`; state.textContent = warning ? 'achtung' : ok ? 'ok' : 'fehlt';
  line.append(label, state);
  const description = document.createElement('div'); description.className = 'row-detail'; description.textContent = detail;
  row.append(line, description); return row;
}

function renderComponents(data) {
  componentStatus = data;
  elements.componentList.replaceChildren();
  const running = Array.from(liveJobs.values()).find((job) => job.projectId === activeProject?.id && job.kind === 'task' && job.status === 'running');
  const provider = running?.provider || elements.provider.value;
  const mode = running?.mode || elements.mode.value;
  const useSubscription = running ? running.useSubscriptionTokens !== false : elements.useSubscriptionTokens.checked;
  const modeLabel = mode === 'Write' ? 'Änderungen erlaubt' : 'Nur lesen';
  elements.workflowContext.textContent = `${activeProject?.name || 'Projekt'} · ${modeLabel}${running ? ' · läuft' : ' · bereit'}`;

  const rows = [
    componentRow('Repository-Basis', data.repository.ok, `Haupt-Checkout · ${data.repository.branch} · ${data.repository.clean ? 'sauber' : 'Änderungen vorhanden'}`, data.repository.ok && !data.repository.clean),
    componentRow('Graphify', data.graphify.ok, data.graphify.text),
    componentRow('Obsidian', data.obsidian.ok, data.obsidian.path),
    componentRow('Provider Router', data.router.ok, data.router.path),
  ];

  let execution;
  if (!useSubscription || provider === 'Ollama') {
    execution = { name: 'Ausführung · Lokal', ok: data.hermes.ok && data.ollama.ok, detail: `Hermes + ${data.ollama.text}` };
  } else if (provider === 'Codex') {
    execution = { name: 'Ausführung · Codex', ok: data.codex.ok, detail: data.codex.text };
  } else if (provider === 'Claude') {
    execution = { name: 'Ausführung · Claude', ok: data.claude.ok, detail: data.claude.text };
  } else {
    const localFallback = mode === 'ReadOnly' ? ' → Hermes lokal' : '';
    execution = { name: 'Ausführung · Auto', ok: data.codex.ok || data.claude.ok, detail: `Codex → Claude${localFallback}` };
  }
  rows.push(componentRow(execution.name, execution.ok, execution.detail));

  const taskText = `${running?.taskPreview || ''} ${elements.task.value}`;
  const needsCodeTools = mode === 'Write' && /\b(code|c#|godot|script|klasse|symbol|bug|test|integration|terrain|szene|scene)\b/i.test(taskText);
  if (needsCodeTools) rows.push(componentRow('MCP-Werkzeuge', data.mcp.ok, data.mcp.text));
  elements.componentList.append(...rows);
}

function renderJobActivity() {
  const running = Array.from(liveJobs.values()).filter((job) => job.kind === 'task' && job.status === 'running');
  const background = running.filter((job) => job.projectId !== activeProject?.id);
  const current = running.find((job) => job.projectId === activeProject?.id);
  const visible = background.length ? background : current ? [current] : [];
  elements.backgroundActivity.classList.toggle('hidden', visible.length === 0);
  if (!visible.length) { elements.backgroundActivity.textContent = ''; elements.backgroundActivity.removeAttribute('title'); return; }
  elements.backgroundActivity.textContent = background.length
    ? `${background[0].projectName}${background.length > 1 ? ` +${background.length - 1}` : ''} läuft im Hintergrund`
    : `${current.projectName} · Aufgabe läuft`;
  elements.backgroundActivity.title = visible.map((job) => `${job.projectName}: ${job.taskPreview}`).join('\n');
}

function formatTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
}

function renderJobs(jobs) {
  const outerScrollTop = elements.jobs.scrollTop;
  const feedScroll = new Map(Array.from(elements.jobs.querySelectorAll('[data-job-id]')).map((node) => {
    const feed = node.querySelector('.feed-log');
    return [node.dataset.jobId, feed ? { top: feed.scrollTop, atBottom: feed.scrollHeight - feed.scrollTop - feed.clientHeight < 24 } : null];
  }));
  elements.jobs.replaceChildren();
  if (!jobs.length) {
    const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Noch keine Jobs in dieser Dashboard-Sitzung.';
    elements.jobs.append(empty); return;
  }
  for (const job of jobs) {
    const container = document.createElement('article'); container.className = 'job';
    container.dataset.jobId = job.id;
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
    const stdoutLines = String(job.stdout || '').split(/\r?\n/).filter(Boolean).map((line) => ({
      line,
      kind: /AI_EVENT|AI_RUN_DIRECTORY|AI_PROJECT_ROUTER_OK/.test(line) || /^\[\d{4}-/.test(line) ? 'event' : '',
    }));
    const stderrLines = String(job.stderr || '').split(/\r?\n/).filter(Boolean).map((line) => ({ line, kind: 'error' }));
    const allLines = [...stdoutLines, ...stderrLines];
    let lines = allLines.filter((entry) => {
      if (feedFilter === 'all') return true;
      if (feedFilter === 'errors') return entry.kind === 'error' || /fail|error|blocked|quota/i.test(entry.line);
      if (entry.kind === 'event') return true;
      if (entry.kind === 'error') return /Provider\s+\w+.*(?:failed|exited|changed)|local Hermes|No provider|write tasks are disabled/i.test(entry.line);
      const stream = entry.line.match(/AI_STREAM provider=[^\s]+\s*(.*)/);
      if (!stream) return false;
      return /\bpreparing\b|\bread\s+[^\s]|\bsearch(?:ed|ing)?\b|\$\s+|API call failed|Non-retryable|completion sentinel|read-only/i.test(stream[1]);
    }).slice(feedFilter === 'all' ? -80 : -30);
    if (feedFilter === 'important' && job.status === 'failed' && !lines.some((entry) => entry.kind === 'error')) {
      lines.push({ line: 'Lauf fehlgeschlagen. Technische Details stehen unter Fehler oder Alles.', kind: 'error' });
    }
    if (!lines.length) {
      const waiting = document.createElement('div'); waiting.className = 'feed-line';
      waiting.textContent = allLines.length ? 'Keine Ereignisse für diesen Filter.' : 'Warte auf Agentenausgabe…'; feed.append(waiting);
    } else {
      for (const entry of lines) {
        const line = document.createElement('div'); line.className = `feed-line ${entry.kind}`; line.textContent = summarizeFeedLine(entry.line); feed.append(line);
      }
    }
    container.append(feed); elements.jobs.append(container);
    const previous = feedScroll.get(job.id);
    if (previous?.atBottom || (!previous && job.status === 'running')) feed.scrollTop = feed.scrollHeight;
    else if (previous) feed.scrollTop = previous.top;
  }
  elements.jobs.scrollTop = outerScrollTop;
}

function visibleLiveJobs() {
  if (!activeProject) return [];
  return Array.from(liveJobs.values())
    .filter((job) => job.projectId === activeProject.id || job.kind === 'provision' || job.kind === 'dashboard-command')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function scheduleLiveJobRender() {
  if (jobRenderPending) return;
  jobRenderPending = true;
  requestAnimationFrame(() => {
    jobRenderPending = false;
    renderJobs(visibleLiveJobs());
    renderJobActivity();
    if (componentStatus) renderComponents(componentStatus);
  });
}

function connectJobEvents() {
  if (jobEventSource) jobEventSource.close();
  jobEventSource = new EventSource('/api/events');
  jobEventSource.addEventListener('job', (event) => {
    try {
      const job = JSON.parse(event.data);
      liveJobs.set(job.id, job);
      scheduleLiveJobRender();
    } catch {}
  });
}

function summarizeFeedLine(line) {
  const incomplete = line.match(/Provider\s+(\w+)\s+exited without the required completion sentinel/i);
  if (incomplete) return `${incomplete[1]} · Aufgabe unvollständig: erforderliche Abschlussmarke fehlt.`;
  const readOnlyViolation = line.match(/Provider\s+(\w+)\s+changed the worktree during a read-only task/i);
  if (readOnlyViolation) return `${readOnlyViolation[1]} · Read-only-Schutz ausgelöst: isolierte Änderungen wurden verworfen.`;
  if (/local Hermes.*write tasks are disabled/i.test(line)) return 'Hermes lokal · Schreibaufträge sind aus Sicherheitsgründen gesperrt.';
  const runDirectory = line.match(/AI_RUN_DIRECTORY\s+(.+)/);
  if (runDirectory) return `Run-Artefakte · ${runDirectory[1]}`;
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
  if (name === 'portfolio') loadPortfolio();
  if (name === 'knowledge') loadActiveKnowledge();
  if (name === 'git') loadGitState();
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

function renderPortfolio(data) {
  const project = data.project;
  elements.portfolioProjectName.textContent = project.name;
  elements.portfolioState.className = `project-state ${project.stateClass}`; elements.portfolioState.textContent = project.state;
  elements.portfolioNextAction.textContent = project.nextAction;
  elements.portfolioCurrentTask.textContent = project.currentTask || 'Kein CURRENT_TASK.md-Inhalt hinterlegt';
  elements.portfolioLastRun.textContent = project.running
    ? `${project.running.provider} läuft · ${project.running.phase || 'gestartet'}`
    : project.lastTask || 'Noch kein Lauf gespeichert';
  elements.portfolioRepository.textContent = `${project.repository.branch || 'kein Branch'} · ${project.repository.clean ? 'clean' : 'lokale Änderungen'}`;
  elements.portfolioKnowledge.textContent = `Graph ${project.graph.status} · ${project.obsidian.notes} Obsidian-Notizen`;
  elements.attentionList.replaceChildren();
  if (!data.attention.length) {
    const empty = document.createElement('div'); empty.className = 'empty';
    empty.textContent = 'Keine Blockade oder ungeklärte Änderung.'; elements.attentionList.append(empty);
  } else {
    for (const entry of data.attention) {
      const row = document.createElement('div'); row.className = `attention-item ${entry.severity === 'error' ? 'error' : ''}`;
      const marker = document.createElement('span'); marker.className = 'attention-marker'; marker.setAttribute('aria-hidden', 'true');
      const text = document.createElement('div'); text.className = 'attention-text';
      const message = document.createElement('div'); message.textContent = entry.message;
      text.append(message);
      const open = document.createElement('button'); open.type = 'button'; open.className = 'button secondary table-button';
      open.dataset.portfolioTarget = entry.target || 'tasks'; open.textContent = 'Öffnen'; row.append(marker, text, open); elements.attentionList.append(row);
    }
  }
}

async function loadPortfolio() {
  elements.attentionList.innerHTML = '<div class="empty">Projektzustände werden geprüft…</div>';
  try { renderPortfolio(await api('/api/portfolio')); }
  catch (error) { elements.attentionList.innerHTML = ''; const message = document.createElement('div'); message.className = 'empty'; message.textContent = error.message; elements.attentionList.append(message); }
}

function renderSystemRows(container, systems, grouped = false) {
  container.replaceChildren();
  const tierOrder = ['required', 'recommended', 'project'];
  const tierLabels = { required: 'Erforderliche Basis', recommended: 'Empfohlener Workflow', project: 'Projektabhängige Werkzeuge' };
  const visibleSystems = systems.filter((system) => system.tier !== 'project' || system.ok || system.relevantToCurrentProject);
  for (const tier of grouped ? tierOrder : ['all']) {
    const rows = tier === 'all' ? visibleSystems : visibleSystems.filter((system) => (system.tier || 'recommended') === tier);
    if (!rows.length) continue;
    if (grouped) {
      const heading = document.createElement('h3'); heading.className = 'system-group-title'; heading.textContent = tierLabels[tier]; container.append(heading);
    }
    for (const system of rows) {
    const item = document.createElement('article'); item.className = 'system-item';
    const head = document.createElement('div'); head.className = 'system-head';
    const name = document.createElement('h3'); name.textContent = system.name;
    const state = document.createElement('span'); state.className = `status ${system.ok ? 'ok' : 'warn'}`; state.textContent = system.status;
    head.append(name, state);
    const category = document.createElement('div'); category.className = 'system-category'; category.textContent = system.category;
    const detail = document.createElement('div'); detail.className = 'system-detail'; detail.textContent = system.detail || system.path || '—';
    item.append(head, category, detail);
    if (system.usedByProjects?.length) {
      const usage = document.createElement('div'); usage.className = 'system-usage';
      usage.textContent = `Verwendet von: ${system.usedByProjects.map((project) => project.name).join(', ')}`; item.append(usage);
    } else if (system.tier === 'project') {
      const usage = document.createElement('div'); usage.className = 'system-usage muted'; usage.textContent = 'Derzeit keinem Projekt zugeordnet'; item.append(usage);
    }
    if (system.reason) { const reason = document.createElement('div'); reason.className = 'system-reason'; reason.textContent = system.reason; item.append(reason); }
    if (system.workflowRole || system.activation || system.costPolicy) {
      const integration = document.createElement('dl'); integration.className = 'system-integration';
      for (const [label, value] of [['Rolle', system.workflowRole], ['Aktivierung', system.activation], ['Kosten', system.costPolicy]]) {
        if (!value) continue;
        const term = document.createElement('dt'); term.textContent = label;
        const description = document.createElement('dd'); description.textContent = value;
        integration.append(term, description);
      }
      item.append(integration);
    }
    if ((!system.ok && system.installKey) || !system.autoDetected) {
      const actions = document.createElement('div'); actions.className = 'system-actions';
      if (!system.ok && system.installKey) {
        const install = document.createElement('button'); install.type = 'button'; install.className = 'button secondary table-button';
        install.dataset.installSystem = system.installKey; install.dataset.installName = system.name; install.textContent = 'Installieren'; actions.append(install);
      }
      if (!system.autoDetected) {
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button danger table-button';
        remove.dataset.removeSystem = system.id; remove.textContent = 'Entfernen'; actions.append(remove);
      }
      item.append(actions);
    }
    container.append(item);
    }
  }
}

async function loadSystems(force = false) {
  if (!activeProject) return;
  try {
    const inventory = await api(`/api/systems?${projectQuery()}${force ? '&force=1' : ''}`);
    renderSystemRows(elements.projectSystems, inventory.project);
    renderSystemRows(elements.globalSystems, inventory.global, true);
    const requiredMissing = inventory.global.filter((system) => system.tier === 'required' && !system.ok).length;
    const recommendedMissing = inventory.global.filter((system) => system.tier === 'recommended' && !system.ok).length;
    elements.systemSetupSummary.innerHTML = requiredMissing
      ? `<strong>${requiredMissing} notwendige Komponente(n) fehlen.</strong> Fehlende freigegebene Werkzeuge können direkt installiert werden.`
      : `<strong>Basis vollständig.</strong> ${recommendedMissing ? `${recommendedMissing} empfohlene Erweiterung(en) sind noch nicht eingerichtet.` : 'Der empfohlene lokale Workflow ist vollständig.'}`;
  } catch (error) { elements.systemMessage.textContent = error.message; }
}

function renderGitState(data) {
  gitData = data;
  if (!data.files.some((file) => file.path === selectedGitFile)) selectedGitFile = null;
  elements.gitProjectName.textContent = `${data.projectName} · ${data.worktreeKind}`;
  elements.gitBranchFlow.textContent = `Aufgabe → ${data.integration.branch} → main`;
  elements.gitTarget.replaceChildren();
  for (const target of data.targets) {
    const option = document.createElement('option'); option.value = target.path;
    const state = target.clean ? 'sauber' : `${target.changedCount} Änderung(en)`;
    const role = target.branch === data.integration.branch ? 'Integrationsbranch' : target.kind;
    option.textContent = `${role} · ${target.branch || 'ohne Branch'} · ${state}`;
    option.selected = target.path.toLowerCase() === data.worktree.toLowerCase();
    option.disabled = !target.available;
    elements.gitTarget.append(option);
  }
  elements.gitState.className = `status ${data.clean ? 'ok' : 'warn'}`;
  elements.gitState.textContent = data.clean ? 'clean' : `${data.files.length} Änderung(en)`;
  elements.gitSummary.replaceChildren();
  for (const text of [
    `Arbeitsordner: ${data.worktree}`,
    `Branch: ${data.branch || '—'}`,
    `Remote: ${data.remote || 'nicht konfiguriert'}`,
    data.hasUpstream ? `${data.ahead} voraus · ${data.behind} zurück` : 'kein Upstream',
    data.githubAuthenticated ? 'GitHub angemeldet' : 'GitHub nicht angemeldet',
    data.lastCommit ? `Letzter Commit: ${data.lastCommit.hash} · ${data.lastCommit.subject}` : 'Noch kein Commit',
  ]) { const item = document.createElement('span'); item.textContent = text; elements.gitSummary.append(item); }
  elements.gitFileList.replaceChildren();
  if (!data.files.length) {
    const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Keine lokalen Änderungen.'; elements.gitFileList.append(empty);
  } else {
    for (const file of data.files) {
      const row = document.createElement('div'); row.className = `git-file-row${file.path === selectedGitFile ? ' active' : ''}`;
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = file.path; checkbox.checked = true;
      checkbox.setAttribute('aria-label', `Für Commit auswählen: ${file.path}`);
      const view = document.createElement('button'); view.type = 'button'; view.className = 'git-file-view'; view.dataset.gitFile = file.path;
      view.setAttribute('aria-label', `Änderungen anzeigen: ${file.path}`);
      const status = document.createElement('span'); status.className = 'git-file-status'; status.textContent = file.untracked ? '??' : `${file.staged}${file.working}`;
      const name = document.createElement('span'); name.className = 'git-file-path'; name.textContent = file.originalPath ? `${file.originalPath} → ${file.path}` : file.path;
      view.append(status, name); row.append(checkbox, view); elements.gitFileList.append(row);
    }
  }
  if (!selectedGitFile) {
    elements.gitDiffFileName.textContent = 'Keine Datei ausgewählt';
    elements.gitDiff.textContent = data.clean ? 'Keine lokalen Änderungen.' : 'Klicke auf eine Dateizeile, um ausschließlich deren Änderungen zu sehen.';
  }
  elements.gitCommit.disabled = data.clean;
  elements.gitCommitPush.disabled = data.clean || !data.remote;
  elements.gitIntegrate.disabled = !data.integration.canFastForward;
  elements.gitIntegrate.classList.toggle('hidden', !data.integration.canFastForward);
  elements.gitIntegrate.textContent = `In ${data.integration.branch} übernehmen`;
  elements.gitPush.disabled = !data.remote || !data.clean || (data.hasUpstream && data.ahead === 0);
  elements.gitPush.classList.toggle('hidden', elements.gitPush.disabled);
  elements.gitMessage.textContent = !data.integration.selectedIsIntegration && data.integration.alreadyIntegrated
    ? `Dieser Aufgabenstand ist bereits in ${data.integration.branch} enthalten.` : '';
}

async function loadGitState(worktree = elements.gitTarget.value) {
  if (!activeProject) return;
  elements.gitState.className = 'status warn'; elements.gitState.textContent = 'wird geprüft';
  elements.gitMessage.textContent = '';
  const target = worktree ? `&worktree=${encodeURIComponent(worktree)}` : '';
  try { renderGitState(await api(`/api/git?${projectQuery()}${target}`)); }
  catch (error) { elements.gitState.className = 'status fail'; elements.gitState.textContent = 'Fehler'; elements.gitMessage.textContent = error.message; }
}

async function loadGitFileDiff(filePath) {
  selectedGitFile = filePath;
  elements.gitFileList.querySelectorAll('.git-file-row').forEach((row) => row.classList.toggle('active', row.querySelector('[data-git-file]')?.dataset.gitFile === filePath));
  elements.gitDiffFileName.textContent = filePath; elements.gitDiff.textContent = 'Dateiänderungen werden geladen…';
  try {
    const result = await api(`/api/git/diff?${projectQuery()}&worktree=${encodeURIComponent(gitData.worktree)}&path=${encodeURIComponent(filePath)}`);
    elements.gitDiff.textContent = result.diff;
    elements.gitMessage.textContent = result.truncated ? 'Die Dateiansicht wurde bei 400.000 Zeichen gekürzt.' : result.binary ? 'Binärdateien besitzen keinen Text-Diff.' : '';
  } catch (error) { elements.gitDiff.textContent = error.message; }
}

async function activateProject(projectId) {
  const target = registry.projects.find((project) => project.id === projectId);
  setBusy(true, 'Projekt wird gewechselt', `${target?.name || 'Projekt'} und seine lokalen Verbindungen werden geprüft.`);
  try {
    await api(`/api/projects/${encodeURIComponent(projectId)}/select`, { method: 'POST', body: '{}' });
    registry = await api('/api/projects');
    activeProject = registry.projects.find((project) => project.id === registry.activeProjectId);
    graphData = null; selectedGraphNodeId = null; graphZoom = 1; graphPanX = 0; graphPanY = 0; gitData = null; selectedGitFile = null; elements.gitTarget.replaceChildren();
    renderProjectSelector(); resetKnowledge();
    await refreshAll(true);
  } finally { setBusy(false); }
}

function resetKnowledge() {
  elements.graphStats.textContent = '';
  elements.graphDetails.innerHTML = '<p class="empty">Wähle einen Knoten im Graphen.</p>';
  const context = elements.graphCanvas.getContext('2d'); context.clearRect(0, 0, elements.graphCanvas.width, elements.graphCanvas.height);
  elements.noteList.replaceChildren(); elements.noteTitle.textContent = 'Keine Notiz ausgewählt'; elements.noteContent.textContent = 'Wähle links eine Notiz aus.';
  elements.knowledgeLoadState.textContent = '';
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
  const centerX = width / 2; const centerY = height / 2; const orbit = Math.max(40, Math.min(width, height) * 0.32) * graphZoom;
  groupEntries.forEach(([name, nodes], groupIndex) => {
    const groupAngle = (Math.PI * 2 * groupIndex) / Math.max(1, groupEntries.length) - Math.PI / 2;
    const groupX = groupEntries.length === 1 ? centerX + graphPanX : centerX + graphPanX + Math.cos(groupAngle) * orbit;
    const groupY = groupEntries.length === 1 ? centerY + graphPanY : centerY + graphPanY + Math.sin(groupAngle) * orbit;
    const radius = Math.max(18, Math.min(90, 10 + Math.sqrt(nodes.length) * 10)) * graphZoom;
    nodes.sort((a, b) => b.degree - a.degree).forEach((node, index) => {
      const angle = index * 2.3999632297;
      const distance = radius * Math.sqrt((index + 0.5) / nodes.length);
      graphPositions.set(node.id, { x: groupX + Math.cos(angle) * distance, y: groupY + Math.sin(angle) * distance, color: graphColor(name) });
    });
  });
}

function drawGraph() {
  const canvas = elements.graphCanvas; const rect = canvas.getBoundingClientRect(); const ratio = window.devicePixelRatio || 1;
  canvas.dataset.zoom = graphZoom.toFixed(3); canvas.dataset.panX = graphPanX.toFixed(1); canvas.dataset.panY = graphPanY.toFixed(1);
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
    const query = elements.knowledgeSearch.value.trim();
    graphData = await api(`/api/graph?${projectQuery()}&q=${encodeURIComponent(query)}`);
    selectedGraphNodeId = null; graphZoom = 1; graphPanX = 0; graphPanY = 0;
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
    const query = elements.knowledgeSearch.value.trim();
    const filePart = selectedFile ? `&file=${encodeURIComponent(selectedFile)}` : '';
    const data = await api(`/api/obsidian?${projectQuery()}&q=${encodeURIComponent(query)}${filePart}`);
    renderNoteList(data);
    if (data.note) {
      elements.noteTitle.textContent = data.note.path; elements.noteContent.textContent = data.note.content;
      document.querySelectorAll('.note-button').forEach((button) => button.classList.toggle('active', button.dataset.notePath === data.note.path));
    }
  } catch (error) { elements.obsidianStats.textContent = error.message; elements.noteList.replaceChildren(); }
}

async function loadActiveKnowledge() {
  if (!activeProject) return;
  elements.knowledgeLoadState.textContent = 'Wissen wird automatisch geladen…';
  await Promise.all([loadGraph(), loadObsidian()]);
  elements.knowledgeLoadState.textContent = 'Graph und Notizen aktuell';
}

function readFileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
  });
}

function renderAttachmentPreview() {
  elements.attachmentPreview.replaceChildren();
  elements.attachmentPreview.classList.toggle('hidden', selectedAttachments.length === 0);
  selectedAttachments.forEach((attachment, index) => {
    const chip = document.createElement('div'); chip.className = 'attachment-chip';
    const image = document.createElement('img'); image.src = attachment.dataUrl; image.alt = attachment.name;
    const name = document.createElement('span'); name.textContent = attachment.name;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'attachment-remove';
    remove.dataset.removeAttachment = String(index); remove.textContent = '×'; remove.setAttribute('aria-label', `${attachment.name} entfernen`);
    chip.append(image, name, remove); elements.attachmentPreview.append(chip);
  });
}

function clearAttachments() {
  selectedAttachments = []; elements.attachmentInput.value = ''; renderAttachmentPreview();
}

async function addImageFiles(files) {
  const allowed = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  if (selectedAttachments.length + files.length > 4) throw new Error('Maximal vier Bilder pro Nachricht.');
  for (const file of files) {
    if (!allowed.has(file.type)) throw new Error(`${file.name || 'Bild'}: nicht unterstütztes Bildformat.`);
    if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name || 'Bild'}: größer als 5 MB.`);
    const fallbackName = `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.${file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1]}`;
    selectedAttachments.push({ name: file.name || fallbackName, type: file.type, size: file.size, dataUrl: await readFileDataUrl(file) });
  }
  elements.formMessage.textContent = selectedAttachments.length ? `${selectedAttachments.length} Bild(er) angehängt.` : '';
  renderAttachmentPreview();
}

function messageElement(role, label, text, attachments = []) {
  const message = document.createElement('div'); message.className = `message ${role}`;
  const heading = document.createElement('div'); heading.className = 'message-label'; heading.textContent = label;
  const body = document.createElement('div'); body.className = 'message-body'; body.textContent = text || 'Keine gespeicherte Ausgabe.';
  message.append(heading, body);
  if (attachments.length) {
    const gallery = document.createElement('div'); gallery.className = 'message-attachments';
    for (const attachment of attachments) {
      const link = document.createElement('a'); link.className = 'message-attachment'; link.href = attachment.url; link.target = '_blank'; link.rel = 'noopener';
      const image = document.createElement('img'); image.src = attachment.url; image.alt = attachment.name; image.loading = 'lazy';
      const name = document.createElement('span'); name.textContent = attachment.name; link.append(image, name); gallery.append(link);
    }
    message.append(gallery);
  }
  return message;
}

function renderHistory(runs) {
  elements.history.replaceChildren();
  if (!runs.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Noch kein Lauf für dieses Projekt.'; elements.history.append(empty); return; }
  for (const run of [...runs].reverse()) {
    const article = document.createElement('article'); article.className = 'conversation-run';
    const meta = document.createElement('div'); meta.className = 'conversation-meta';
    const identity = document.createElement('span'); identity.textContent = `${formatTime(run.modifiedAt)} · ${run.provider || 'externer Lauf'}`;
    const stateClass = run.status === 'PASS' ? 'ok' : run.status === 'FAIL' ? 'fail' : run.status === 'external' ? 'info' : 'warn';
    const state = document.createElement('span'); state.className = `status ${stateClass}`; state.textContent = run.status;
    meta.append(identity, state); article.append(meta);
    if (run.task) article.append(messageElement('user', 'Du', run.task, run.attachments || []));
    article.append(messageElement('assistant', run.provider || 'AI Project Control', run.response));
    const summary = document.createElement('div'); summary.className = 'run-summary';
    for (const value of [run.mode, run.tests, run.filesChanged, run.gate].filter(Boolean)) {
      const chip = document.createElement('span'); chip.textContent = value; summary.append(chip);
    }
    if (summary.childElementCount) article.append(summary);
    elements.history.append(article);
  }
  requestAnimationFrame(() => { elements.history.scrollTop = elements.history.scrollHeight; });
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
  for (const row of rows) liveJobs.set(row.id, row);
  renderJobs(visibleLiveJobs());
  renderJobActivity();
  if (componentStatus) renderComponents(componentStatus);
  const latestTask = rows.find((job) => job.kind === 'task');
  if (latestTask?.status === 'failed') elements.formMessage.textContent = 'Letzter Job fehlgeschlagen. Details stehen im Live-Feed und Verlauf.';
  else if (latestTask?.status === 'completed') elements.formMessage.textContent = 'Letzter Job abgeschlossen.';
  else if (latestTask?.status === 'stopped') elements.formMessage.textContent = 'Letzter Job wurde gestoppt.';
  if (rows.some((job) => job.status === 'completed' && job.projectId && !registry.projects.some((project) => project.id === job.projectId))) {
    registry = await api('/api/projects');
    activeProject = registry.projects.find((project) => project.id === registry.activeProjectId) || activeProject;
    renderProjectSelector();
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
    renderProjectSelector(); connectJobEvents(); await refreshAll(true);
  } catch (error) { elements.connection.className = 'connection error'; elements.connection.textContent = error.message; }
}

document.querySelector('.view-tabs').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-view]'); if (button) showView(button.dataset.view);
});

elements.systemsRefresh.addEventListener('click', () => loadSystems(true));
elements.addProject.addEventListener('click', () => { showView('projects'); elements.provisionName.focus(); });
elements.projectSelect.addEventListener('change', () => activateProject(elements.projectSelect.value));
elements.provider.addEventListener('change', () => { if (componentStatus) renderComponents(componentStatus); });
elements.mode.addEventListener('change', () => { if (componentStatus) renderComponents(componentStatus); });
elements.useSubscriptionTokens.addEventListener('change', () => { if (componentStatus) renderComponents(componentStatus); });
elements.task.addEventListener('input', () => { if (componentStatus) renderComponents(componentStatus); });

document.querySelector('.feed-filter').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-feed-filter]'); if (!button) return;
  feedFilter = button.dataset.feedFilter;
  document.querySelectorAll('[data-feed-filter]').forEach((candidate) => candidate.classList.toggle('active', candidate === button));
  refreshJobs();
});

elements.attachmentButton.addEventListener('click', () => elements.attachmentInput.click());
elements.attachmentInput.addEventListener('change', async () => {
  const files = Array.from(elements.attachmentInput.files || []);
  try { await addImageFiles(files); }
  catch (error) { elements.formMessage.textContent = error.message; }
  finally { elements.attachmentInput.value = ''; }
});

elements.task.addEventListener('paste', async (event) => {
  const files = Array.from(event.clipboardData?.items || []).filter((item) => item.kind === 'file' && item.type.startsWith('image/')).map((item) => item.getAsFile()).filter(Boolean);
  if (!files.length) return;
  event.preventDefault();
  try { await addImageFiles(files); }
  catch (error) { elements.formMessage.textContent = error.message; }
});

elements.attachmentPreview.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-remove-attachment]'); if (!button) return;
  selectedAttachments.splice(Number(button.dataset.removeAttachment), 1); renderAttachmentPreview();
  elements.formMessage.textContent = selectedAttachments.length ? `${selectedAttachments.length} Bild(er) angehängt.` : '';
});

elements.task.addEventListener('input', () => {
  elements.task.style.height = 'auto'; elements.task.style.height = `${Math.min(elements.task.scrollHeight, 180)}px`;
});

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

elements.knowledgeSearch.addEventListener('input', () => {
  clearTimeout(knowledgeSearchTimer); knowledgeSearchTimer = setTimeout(loadActiveKnowledge, 350);
});
elements.graphCanvas.addEventListener('wheel', (event) => {
  if (!graphData) return;
  event.preventDefault();
  const rect = elements.graphCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left; const y = event.clientY - rect.top;
  const oldZoom = graphZoom; const nextZoom = Math.max(0.45, Math.min(3.5, oldZoom * Math.exp(-event.deltaY * 0.0012)));
  const centerX = rect.width / 2; const centerY = rect.height / 2; const scale = nextZoom / oldZoom;
  graphPanX = x - centerX - scale * (x - centerX - graphPanX);
  graphPanY = y - centerY - scale * (y - centerY - graphPanY);
  graphZoom = nextZoom; drawGraph();
}, { passive: false });

elements.graphCanvas.addEventListener('pointerdown', (event) => {
  if (!graphData || event.button !== 0) return;
  graphDrag = { x: event.clientX, y: event.clientY, panX: graphPanX, panY: graphPanY };
  graphDidDrag = false; elements.graphCanvas.classList.add('dragging'); elements.graphCanvas.setPointerCapture(event.pointerId);
});
elements.graphCanvas.addEventListener('pointermove', (event) => {
  if (!graphDrag) return;
  const dx = event.clientX - graphDrag.x; const dy = event.clientY - graphDrag.y;
  if (Math.hypot(dx, dy) > 3) graphDidDrag = true;
  graphPanX = graphDrag.panX + dx; graphPanY = graphDrag.panY + dy; drawGraph();
});
elements.graphCanvas.addEventListener('pointerup', (event) => {
  if (!graphDrag) return;
  graphDrag = null; elements.graphCanvas.classList.remove('dragging'); elements.graphCanvas.releasePointerCapture(event.pointerId);
});
elements.graphCanvas.addEventListener('pointercancel', () => { graphDrag = null; elements.graphCanvas.classList.remove('dragging'); });

elements.graphCanvas.addEventListener('click', (event) => {
  if (!graphData) return;
  if (graphDidDrag) { graphDidDrag = false; return; }
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
      attachments: selectedAttachments.map(({ name, type, dataUrl }) => ({ name, type, dataUrl })),
    }) });
    elements.formMessage.textContent = `Job ${job.id.slice(0, 8)} läuft.`; elements.task.value = ''; elements.task.style.height = ''; clearAttachments(); await refreshJobs();
  } catch (error) { elements.formMessage.textContent = error.message; }
  finally { elements.start.disabled = false; }
});

document.getElementById('portfolioView').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-portfolio-target]'); if (button) showView(button.dataset.portfolioTarget);
});

elements.gitSelectAll.addEventListener('click', () => {
  const boxes = [...elements.gitFileList.querySelectorAll('input[type="checkbox"]')];
  const shouldSelect = boxes.some((box) => !box.checked); boxes.forEach((box) => { box.checked = shouldSelect; });
});
elements.gitFileList.addEventListener('click', (event) => {
  const view = event.target.closest('[data-git-file]'); if (view) loadGitFileDiff(view.dataset.gitFile);
});

async function commitSelectedGitFiles(pushAfterCommit) {
  const paths = [...elements.gitFileList.querySelectorAll('input[type="checkbox"]:checked')].map((box) => box.value);
  if (!paths.length) { elements.gitMessage.textContent = 'Wähle mindestens eine Datei aus.'; return; }
  const message = elements.gitCommitMessage.value.trim();
  if (!message) { elements.gitMessage.textContent = 'Eine Commit-Nachricht ist erforderlich.'; elements.gitCommitMessage.focus(); return; }
  const action = pushAfterCommit ? 'committen und anschließend pushen' : 'lokal committen';
  if (!window.confirm(`${paths.length} Datei(en) im Branch ${gitData?.branch || '—'} ${action}?`)) return;
  elements.gitCommit.disabled = true; elements.gitCommitPush.disabled = true; elements.gitMessage.textContent = 'Commit wird erstellt…';
  let committed = false;
  try {
    const result = await api('/api/git/commit', { method: 'POST', body: JSON.stringify({ projectId: activeProject.id, worktree: gitData.worktree, paths, message }) });
    committed = true; elements.gitCommitMessage.value = '';
    if (pushAfterCommit) {
      elements.gitMessage.textContent = 'Commit erstellt, Branch wird gepusht…';
      const pushed = await api('/api/git/push', { method: 'POST', body: JSON.stringify({ projectId: activeProject.id, worktree: gitData.worktree }) });
      renderGitState(pushed.state); elements.gitMessage.textContent = 'Auswahl wurde committed und der Branch hochgeladen.';
    } else { renderGitState(result.state); elements.gitMessage.textContent = 'Commit wurde lokal erstellt. Noch nichts wurde gepusht.'; }
  } catch (error) { elements.gitMessage.textContent = committed ? `Commit wurde erstellt, Push ist fehlgeschlagen: ${error.message}` : error.message; }
  finally { elements.gitCommit.disabled = Boolean(gitData?.clean); elements.gitCommitPush.disabled = Boolean(gitData?.clean || !gitData?.remote); }
}
elements.gitCommit.addEventListener('click', () => commitSelectedGitFiles(false));
elements.gitCommitPush.addEventListener('click', () => commitSelectedGitFiles(true));
elements.gitTarget.addEventListener('change', () => { selectedGitFile = null; loadGitState(elements.gitTarget.value); });
elements.gitIntegrate.addEventListener('click', async () => {
  if (!gitData?.integration?.canFastForward) { elements.gitMessage.textContent = gitData?.integration?.reason || 'Dieser Aufgabenstand kann nicht automatisch integriert werden.'; return; }
  if (!window.confirm(`Branch ${gitData.branch} per sicherem Fast-forward in ${gitData.integration.branch} übernehmen und anschließend den Aufgaben-Worktree sowie den lokalen und gegebenenfalls den Remote-Branch löschen? main bleibt unverändert.`)) return;
  elements.gitIntegrate.disabled = true; elements.gitMessage.textContent = `${gitData.integration.branch} wird aktualisiert…`;
  try {
    const result = await api('/api/git/integrate', { method: 'POST', body: JSON.stringify({ projectId: activeProject.id, worktree: gitData.worktree }) });
    selectedGitFile = null; renderGitState(result.state);
    const remoteCleanup = result.deletedRemoteBranch ? ' und auf origin' : '';
    elements.gitMessage.textContent = `Aufgabenstand wurde lokal in ${result.state.integration.branch} übernommen; ${result.deletedBranch} wurde lokal${remoteCleanup} gelöscht. Prüfe und pushe jetzt nur den Integrationsbranch; main bleibt unverändert.`;
  } catch (error) { elements.gitMessage.textContent = error.message; }
  finally { elements.gitIntegrate.disabled = !gitData?.integration?.canFastForward; }
});
elements.gitPush.addEventListener('click', async () => {
  if (!gitData?.remote) { elements.gitMessage.textContent = 'Kein origin-Remote konfiguriert.'; return; }
  if (!window.confirm(`Branch ${gitData.branch} ohne Force-Push zu ${gitData.remote} hochladen?`)) return;
  elements.gitPush.disabled = true; elements.gitMessage.textContent = 'Branch wird gepusht…';
  try {
    const result = await api('/api/git/push', { method: 'POST', body: JSON.stringify({ projectId: activeProject.id, worktree: gitData.worktree }) });
    renderGitState(result.state); elements.gitMessage.textContent = 'Branch wurde erfolgreich hochgeladen.';
  } catch (error) { elements.gitMessage.textContent = error.message; }
  finally { elements.gitPush.disabled = false; }
});

elements.jobs.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-stop-job]'); if (!button) return; button.disabled = true;
  try { await api(`/api/jobs/${button.dataset.stopJob}/stop`, { method: 'POST', body: '{}' }); await refreshJobs(); }
  catch (error) { elements.formMessage.textContent = error.message; }
});

document.getElementById('systemsView').addEventListener('click', async (event) => {
  const install = event.target.closest('button[data-install-system]');
  if (install) {
    if (!window.confirm(`${install.dataset.installName} über den freigegebenen offiziellen Paketweg installieren? Es werden keine kostenpflichtigen Dienste aktiviert.`)) return;
    install.disabled = true; elements.systemMessage.textContent = `${install.dataset.installName} wird installiert. Der Fortschritt erscheint im Live-Feed.`;
    try {
      await api('/api/systems/install', { method: 'POST', body: JSON.stringify({ projectId: activeProject.id, installKey: install.dataset.installSystem }) });
      showView('tasks'); await refreshJobs();
    } catch (error) { elements.systemMessage.textContent = error.message; install.disabled = false; }
    return;
  }
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
