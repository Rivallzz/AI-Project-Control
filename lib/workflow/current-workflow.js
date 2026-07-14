'use strict';

const PROVIDERS = ['Codex', 'Claude', 'Ollama'];
const STATE_LABELS = Object.freeze({
  active: 'aktiv', ready: 'bereit', standby: 'bei Bedarf', waiting: 'wartet', complete: 'abgeschlossen',
  review: 'offen', attention: 'Aufmerksamkeit', blocked: 'blockiert', 'not-required': 'nicht erforderlich',
  'not-used': 'nicht eingeplant', unavailable: 'nicht verfügbar',
});

function canonicalProvider(value) {
  const source = String(value || '').toLowerCase();
  if (source.includes('codex')) return 'Codex';
  if (source.includes('claude')) return 'Claude';
  if (source.includes('ollama') || source.includes('hermes')) return 'Ollama';
  return null;
}

function providerLabel(provider) {
  return provider === 'Claude' ? 'Claude Code' : provider === 'Ollama' ? 'Hermes + Ollama' : 'Codex';
}

function normalizeRoute(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  const route = [];
  for (const entry of values) {
    const provider = canonicalProvider(entry);
    if (provider && !route.includes(provider)) route.push(provider);
  }
  return route;
}

function isCodeTask(value) {
  return /\b(code|c#|godot|script|klasse|symbol|bug|test|integration|terrain|szene|scene|frontend|backend|api|css|html|javascript|typescript)\b/i.test(String(value || ''));
}

function byNewest(left, right) {
  return String(right.updatedAt || right.finishedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.finishedAt || left.createdAt || ''));
}

function referenceJob(jobs, projectId) {
  const tasks = (Array.isArray(jobs) ? jobs : [])
    .filter((job) => (job.kind || 'task') === 'task' && (!projectId || job.projectId === projectId))
    .sort(byNewest);
  return tasks.find((job) => ['running', 'stopping'].includes(job.status))
    || tasks.find((job) => job.mode === 'Write' && ['completed', 'failed', 'blocked', 'stopped'].includes(job.status))
    || null;
}

function state(value) {
  return { state: value, stateLabel: STATE_LABELS[value] || value };
}

function stage(id, order, title, stateValue, summary, reason, tools = []) {
  return { id, order, title, ...state(stateValue), summary, reason, tools };
}

function providerAvailable(provider, components = {}) {
  if (provider === 'Codex') return Boolean(components.codex?.ok);
  if (provider === 'Claude') return Boolean(components.claude?.ok);
  return Boolean(components.hermes?.ok && components.ollama?.ok);
}

function gitStages({ mode, job, git }) {
  if (mode !== 'Write') {
    const reason = 'Im Nur-Lesen-Modus entstehen keine freizugebenden Repository-Änderungen.';
    return [
      stage('review', 4, 'Review', 'not-required', 'Kein Änderungsreview nötig', reason, ['Git']),
      stage('commit', 5, 'Commit', 'not-required', 'Kein Commit nötig', reason, ['Git']),
      stage('integration', 6, 'Integration', 'not-required', 'Keine Integration nötig', reason, ['Git']),
      stage('push', 7, 'Push', 'not-required', 'Kein Push nötig', reason, ['Git']),
    ];
  }
  if (!job) {
    return [
      stage('review', 4, 'Review', 'waiting', 'Wartet auf Änderungen', 'Der Schreibablauf ist vorbereitet, aber noch kein Auftrag wurde gestartet.', ['Git']),
      stage('commit', 5, 'Commit', 'waiting', 'Wartet auf Review', 'Ein Commit wird erst nach sichtbarer Prüfung freigegeben.', ['Git']),
      stage('integration', 6, 'Integration', 'waiting', 'Wartet auf Commit', 'Integration ist ein eigener Owner-Gate nach dem Commit.', ['Git']),
      stage('push', 7, 'Push', 'waiting', 'Wartet auf Integration', 'Push ist ein separater Owner-Gate und erfolgt nie automatisch.', ['Git']),
    ];
  }
  if (['running', 'stopping'].includes(job.status)) {
    return [
      stage('review', 4, 'Review', 'waiting', 'Wartet auf Agent', 'Erst nach Ende der Ausführung stehen Änderungen zur Prüfung bereit.', ['Git']),
      stage('commit', 5, 'Commit', 'waiting', 'Wartet auf Review', 'Der Commit bleibt bis zur Prüfung gesperrt.', ['Git']),
      stage('integration', 6, 'Integration', 'waiting', 'Wartet auf Commit', 'Der Aufgabenbranch wird erst nach einem bestätigten Commit integriert.', ['Git']),
      stage('push', 7, 'Push', 'waiting', 'Wartet auf Integration', 'Ein Remote-Push wird separat bestätigt.', ['Git']),
    ];
  }
  if (['failed', 'blocked', 'stopped'].includes(job.status)) {
    const reason = job.status === 'blocked' ? 'Der Agent hat den Auftrag kontrolliert blockiert.'
      : job.status === 'stopped' ? 'Der Auftrag wurde beendet, bevor der Freigabeweg erreicht wurde.' : 'Die Ausführung ist fehlgeschlagen.';
    return [
      stage('review', 4, 'Review', 'attention', 'Ergebnis prüfen', reason, ['Git']),
      stage('commit', 5, 'Commit', 'blocked', 'Durch Ausführung blockiert', 'Zuerst muss das Ergebnis der Ausführung geklärt werden.', ['Git']),
      stage('integration', 6, 'Integration', 'blocked', 'Durch Commit blockiert', 'Ohne freigegebenen Commit findet keine Integration statt.', ['Git']),
      stage('push', 7, 'Push', 'blocked', 'Durch Integration blockiert', 'Ohne Integration findet kein Push statt.', ['Git']),
    ];
  }
  if (!git) {
    return [
      stage('review', 4, 'Review', 'attention', 'Git-Zustand nicht verfügbar', 'Der Auftrag ist beendet, der zugehörige Arbeitsstand konnte aber nicht geprüft werden.', ['Git']),
      stage('commit', 5, 'Commit', 'waiting', 'Wartet auf Git-Prüfung', 'Der Commit-Status kann ohne Arbeitsstand nicht sicher abgeleitet werden.', ['Git']),
      stage('integration', 6, 'Integration', 'waiting', 'Wartet auf Git-Prüfung', 'Der Integrationsstatus kann ohne Arbeitsstand nicht sicher abgeleitet werden.', ['Git']),
      stage('push', 7, 'Push', 'waiting', 'Wartet auf Git-Prüfung', 'Der Push-Status kann ohne Arbeitsstand nicht sicher abgeleitet werden.', ['Git']),
    ];
  }

  const delivery = git.deliveryState;
  const hasPendingChanges = delivery === 'changes-pending';
  const committed = ['committed', 'integrated', 'integrated-unpublished', 'clean'].includes(delivery);
  const integrated = ['integrated', 'integrated-unpublished'].includes(delivery) || git.integration?.alreadyIntegrated;
  const publishPending = delivery === 'integrated-unpublished' || Number(git.ahead || 0) > 0;
  const review = hasPendingChanges
    ? stage('review', 4, 'Review', 'review', `${git.files?.length || 0} Änderung(en) offen`, 'Die Ausführung ist fertig. Die geänderten Dateien müssen jetzt im Reiter „Prüfen & Git“ bewertet werden.', ['Git'])
    : stage('review', 4, 'Review', 'complete', 'Arbeitsstand geprüft', 'Es liegen keine ungeprüften Änderungen mehr im ausgewählten Arbeitsstand.', ['Git']);
  const commit = hasPendingChanges
    ? stage('commit', 5, 'Commit', 'ready', 'Nach Review bereit', 'Die Änderungen können nach der Auswahl und einer Commit-Nachricht lokal committed werden.', ['Git'])
    : committed
      ? stage('commit', 5, 'Commit', 'complete', 'Lokal gesichert', 'Im Arbeitsstand liegen keine uncommitteten Änderungen mehr.', ['Git'])
      : stage('commit', 5, 'Commit', 'waiting', 'Status wird geprüft', 'Der Commit-Status ist noch nicht eindeutig.', ['Git']);
  let integration;
  if (hasPendingChanges) integration = stage('integration', 6, 'Integration', 'waiting', 'Wartet auf Commit', 'Uncommittete Änderungen können nicht integriert werden.', ['Git']);
  else if (integrated) integration = stage('integration', 6, 'Integration', 'complete', 'Im Integrationsbranch', 'Git bestätigt, dass der Aufgabenstand bereits enthalten ist.', ['Git']);
  else if (git.integration?.canFastForward || git.integration?.canCleanup) integration = stage('integration', 6, 'Integration', 'ready', 'Fast-forward möglich', 'Der bestätigte Aufgabenstand kann über den separaten Integrations-Gate übernommen werden.', ['Git']);
  else integration = stage('integration', 6, 'Integration', 'attention', 'Manuelle Prüfung nötig', git.integration?.reason || 'Eine sichere automatische Integration ist derzeit nicht nachgewiesen.', ['Git']);
  let push;
  if (!git.remote) push = stage('push', 7, 'Push', 'not-required', 'Kein Remote konfiguriert', 'Ohne origin-Remote gibt es keinen Zielserver für diesen Gate.', ['Git']);
  else if (publishPending) push = stage('push', 7, 'Push', 'ready', 'Lokale Commits ausstehend', `${git.ahead || 1} Commit(s) sind noch nicht zum Remote übertragen.`, ['Git']);
  else if (integrated || delivery === 'clean') push = stage('push', 7, 'Push', 'complete', 'Mit Remote synchron', 'Für den ausgewählten Branch sind keine lokalen Commits zum Pushen offen.', ['Git']);
  else push = stage('push', 7, 'Push', 'waiting', 'Wartet auf Integration', 'Push bleibt ein eigener Gate nach der Integration.', ['Git']);
  return [review, commit, integration, push];
}

function mcpTool(server, { running, codeTask }) {
  const rawName = String(server?.name || 'MCP-Werkzeug').slice(0, 80);
  const normalized = rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const configured = server?.enabled !== false && server?.health?.state === 'not-checked';
  if (/serena/.test(normalized)) {
    const toolState = !configured ? 'unavailable' : running && codeTask ? 'active' : codeTask ? 'ready' : 'standby';
    return { id: `mcp-${normalized}`, name: 'Serena', kind: 'MCP', scope: server.scope || 'global', ...state(toolState), role: 'Symbolgenaue Code-Navigation und gezielte Bearbeitung.', reason: !configured ? 'Die MCP-Konfiguration ist deaktiviert oder unvollständig.' : running && codeTask ? 'Der laufende Auftrag enthält ein Codesignal.' : codeTask ? 'Für den erkannten Codeauftrag vorbereitet.' : 'Wird erst bei symbolgenauer Codearbeit aktiviert.' };
  }
  if (/node-repl|browser/.test(normalized)) {
    return { id: `mcp-${normalized}`, name: rawName, kind: 'MCP', scope: server.scope || 'global', ...state(configured ? 'standby' : 'unavailable'), role: 'Browser- und Interaktionsprüfung für sichtbare Oberflächen.', reason: configured ? 'Wird nur für UI-Prüfungen oder interaktive Browseraufgaben gestartet.' : 'Die MCP-Konfiguration ist deaktiviert oder unvollständig.' };
  }
  if (/openai.*developer.*docs|developer.*docs/.test(normalized)) {
    return { id: `mcp-${normalized}`, name: rawName, kind: 'MCP', scope: server.scope || 'global', ...state(configured ? 'standby' : 'unavailable'), role: 'Aktuelle offizielle OpenAI-Entwicklerdokumentation.', reason: configured ? 'Wird nur bei OpenAI-Dokumentationsfragen aktiviert.' : 'Die MCP-Konfiguration ist deaktiviert oder unvollständig.' };
  }
  return { id: `mcp-${normalized}`, name: rawName, kind: 'MCP', scope: server.scope || 'global', ...state(configured ? 'standby' : 'unavailable'), role: 'Stellt dem konfigurierten Client zusätzliche Werkzeuge bereit.', reason: configured ? 'Konfiguriert, aber für diesen Ablauf nicht automatisch gestartet.' : 'Die MCP-Konfiguration ist deaktiviert oder unvollständig.' };
}

function buildTools({ route, selectedProvider, running, codeTask, mode, components, mcpInventory }) {
  const tools = [
    { id: 'repository', name: 'Git + Repository', kind: 'CLI', scope: 'Projekt', ...state(running && mode === 'Write' ? 'active' : 'ready'), role: 'Verbindliche Quelle für Projektstand und Freigabe-Gates.', reason: running && mode === 'Write' ? 'Der Schreibauftrag arbeitet in einem getrennten Git-Worktree.' : 'Repository-Zustand wird deterministisch geprüft.' },
    { id: 'router', name: 'Provider Router', kind: 'Lokal', scope: 'Global', ...state(components.router?.ok ? running ? 'active' : 'ready' : 'unavailable'), role: 'Startet Provider in der festgelegten Fallback-Reihenfolge.', reason: components.router?.ok ? running ? 'Die Route wird gerade für den laufenden Auftrag verwendet.' : 'Für den nächsten Auftrag vorbereitet.' : 'Die Router-Skripte wurden nicht gefunden.' },
    { id: 'graphify', name: 'Graphify', kind: 'CLI', scope: 'Projekt', ...state(components.graphify?.ok ? running ? 'active' : 'ready' : 'unavailable'), role: 'Repository-weite Struktur- und Zusammenhangssuche.', reason: components.graphify?.ok ? running ? 'Der Projektindex steht dem laufenden Auftrag zur Verfügung.' : 'Der Projektindex ist vorhanden und wird bei Bedarf gelesen.' : 'Für dieses Projekt ist kein lesbarer Index verfügbar.' },
    { id: 'obsidian', name: 'Obsidian', kind: 'Wissen', scope: 'Projekt', ...state(components.obsidian?.ok ? 'standby' : 'unavailable'), role: 'Bestätigtes Arbeitswissen ergänzend zum Repository.', reason: components.obsidian?.ok ? 'Wird nur gelesen, wenn projektspezifisches Arbeitswissen benötigt wird.' : 'Für dieses Projekt wurde kein Wissenspfad erkannt.' },
    { id: 'cli-continues', name: 'cli-continues', kind: 'CLI', scope: 'Global', ...state(components.cliContinues?.ok ? 'standby' : 'unavailable'), role: 'Kontrollierte Fortsetzung nach einer bestätigten Provider-Unterbrechung.', reason: components.cliContinues?.ok ? 'Bleibt inaktiv, solange kein verifizierter Provider-Abbruch vorliegt.' : 'Die CLI wurde nicht erkannt; der normale Ablauf ist davon nicht betroffen.' },
  ];
  for (const provider of PROVIDERS) {
    const available = providerAvailable(provider, components);
    const index = route.indexOf(provider);
    let toolState = !available ? 'unavailable' : index < 0 ? 'not-used' : running && (selectedProvider === provider || (!selectedProvider && index === 0)) ? 'active' : index === 0 ? 'ready' : 'standby';
    let reason = !available ? 'Die lokale Laufzeitprüfung meldet diesen Provider als nicht verfügbar.'
      : index < 0 ? 'Dieser Provider ist nicht Teil der aktuell abgebildeten Route.'
        : running && (selectedProvider === provider || (!selectedProvider && index === 0)) ? 'Der Router verwendet diesen Provider oder bereitet gerade dessen Start vor.'
          : index === 0 ? 'Er ist der erste ausführbare Provider der Route.' : `Fallback ${index}: nur nach einer erkannten Unterbrechung des vorherigen Providers.`;
    if (mode === 'Write' && provider === 'Ollama') { toolState = 'not-used'; reason = 'Der lokale Hermes-Pfad ist für Schreibaufgaben bewusst gesperrt.'; }
    tools.push({ id: `provider-${provider.toLowerCase()}`, name: providerLabel(provider), kind: 'Provider', scope: provider === 'Ollama' ? 'Lokal' : 'Abo-Kontingent', ...state(toolState), role: provider === 'Ollama' ? 'Lokale Read-only-Ausführung ohne Abo-Nutzung.' : 'Agent-Ausführung über vorhandenes Abo-Kontingent.', reason });
  }
  const mcpByName = new Map();
  for (const server of mcpInventory?.servers || []) {
    const key = String(server.name || '').toLowerCase();
    const existing = mcpByName.get(key);
    if (!existing || (existing.scope !== 'project' && server.scope === 'project')) mcpByName.set(key, server);
  }
  for (const server of mcpByName.values()) tools.push(mcpTool(server, { running, codeTask }));
  return tools;
}

function workflowSummary({ job, routeValid, mode, git, stages }) {
  if (job?.status === 'running') return { ...state('active'), title: 'Agent arbeitet', reason: 'Ein Auftrag läuft; die nachfolgenden Freigabe-Gates warten auf sein Ergebnis.' };
  if (job?.status === 'stopping') return { ...state('attention'), title: 'Auftrag wird beendet', reason: 'Der Stopp wurde angefordert und der Prozess wird kontrolliert beendet.' };
  if (['failed', 'blocked', 'stopped'].includes(job?.status)) return { ...state('attention'), title: 'Ausführung benötigt Aufmerksamkeit', reason: job.status === 'blocked' ? 'Der letzte Schreibauftrag wurde kontrolliert blockiert.' : job.status === 'stopped' ? 'Der letzte Schreibauftrag wurde vorzeitig beendet.' : 'Der letzte Schreibauftrag ist fehlgeschlagen.' };
  if (!routeValid) return { ...state('attention'), title: 'Keine ausführbare Route', reason: mode === 'Write' ? 'Für Schreibaufgaben muss Codex oder Claude verfügbar und aktiviert sein.' : 'Aktiviere mindestens einen verfügbaren Provider.' };
  if (job?.status === 'completed' && mode === 'Write') {
    const open = stages.find((entry) => ['review', 'ready', 'attention', 'blocked'].includes(entry.state));
    if (open) return { ...state(open.state === 'review' ? 'review' : open.state === 'blocked' ? 'attention' : open.state), title: `${open.title} ${open.state === 'review' ? 'offen' : open.state === 'ready' ? 'bereit' : 'prüfen'}`, reason: open.reason };
    if (git?.deliveryState === 'integrated-unpublished' || Number(git?.ahead || 0) > 0) return { ...state('ready'), title: 'Push bereit', reason: 'Der lokale Integrationsstand enthält noch nicht veröffentlichte Commits.' };
    return { ...state('complete'), title: 'Ablauf abgeschlossen', reason: 'Ausführung und alle für diesen Arbeitsstand nachweisbaren Gates sind abgeschlossen.' };
  }
  return { ...state('ready'), title: 'Workflow bereit', reason: 'Die aktuelle Konfiguration ist ausführbar; noch kein Auftrag läuft.' };
}

function buildCurrentWorkflow({ project, requested = {}, jobs = [], components = {}, mcpInventory = {}, git = null, now = new Date() }) {
  const job = referenceJob(jobs, project?.id);
  const running = Boolean(job && ['running', 'stopping'].includes(job.status));
  const mode = job?.mode === 'Write' || (!job && requested.mode === 'Write') ? 'Write' : 'ReadOnly';
  const route = normalizeRoute(job?.providerOrder || requested.providerOrder);
  const selectedProvider = canonicalProvider(job?.selectedProvider);
  const routeValid = route.length > 0 && !(mode === 'Write' && route.every((provider) => provider === 'Ollama'));
  const codeTask = isCodeTask(job?.taskPreview) || (!job && requested.codeTask === true);
  const routeLabel = route.length ? route.map(providerLabel).join(' → ') : 'Keine ausführbare Route';
  const routeState = !routeValid ? 'attention' : running ? 'active' : job ? 'complete' : 'ready';
  const agentState = !job ? 'ready' : job.status === 'running' ? 'active' : job.status === 'completed' ? 'complete' : 'attention';
  const stages = [
    stage('context', 1, 'Projektkontext', running ? 'active' : job ? 'complete' : 'ready', project?.name || 'Projekt', job ? 'Der Auftrag und seine Projekt-ID bestimmen Repository, Wissen und Laufzeitgrenzen.' : 'Das ausgewählte Projekt liefert Repository, Wissen und Laufzeitgrenzen.', ['Git', 'Graphify', 'Obsidian']),
    stage('route', 2, 'Provider-Route', routeState, routeLabel, !routeValid ? (mode === 'Write' ? 'Hermes lokal ist für Schreibaufgaben gesperrt; Codex oder Claude fehlt in der Route.' : 'Kein verfügbarer Provider ist aktiviert.') : `Die Reihenfolge ist fest: ${routeLabel}. Fallback erfolgt nur nach einer erkannten Provider-Unterbrechung.`, ['Provider Router', ...route.map(providerLabel)]),
    stage('agent', 3, 'Agent', agentState, !job ? 'Noch nicht gestartet' : job.status === 'running' ? `${providerLabel(selectedProvider || route[0])} arbeitet` : job.status === 'completed' ? 'Ausführung beendet' : 'Ausführung prüfen', !job ? 'Der Agent startet erst nach einem Auftrag im Arbeitsbereich.' : job.status === 'running' ? 'Der Router meldet einen laufenden Task-Prozess.' : job.status === 'completed' ? 'Der Prozess ist beendet; im Schreibmodus folgen separate Git-Gates.' : 'Der Prozess endete nicht regulär und benötigt Aufmerksamkeit.', [selectedProvider ? providerLabel(selectedProvider) : 'Provider Router', ...(codeTask ? ['Serena'] : [])]),
    ...gitStages({ mode, job, git }),
  ];
  const summary = workflowSummary({ job, routeValid, mode, git, stages });
  const tools = buildTools({ route, selectedProvider, running, codeTask, mode, components, mcpInventory });
  return {
    generatedAt: now.toISOString(),
    project: { id: String(project?.id || ''), name: String(project?.name || 'Projekt') },
    summary: {
      ...summary,
      source: job ? (running ? 'Laufender Auftrag' : 'Letzter offener Schreibablauf') : 'Aktuelle Arbeitsbereich-Einstellungen',
      mode,
      modeLabel: mode === 'Write' ? 'Änderungen erlauben' : 'Nur lesen',
      routeLabel,
      jobId: job?.id || null,
    },
    facts: [
      { label: 'Statusquelle', value: job ? (running ? 'Laufender Auftrag' : 'Letzter Schreibauftrag') : 'Arbeitsbereich', detail: job ? 'Jobzustand überschreibt die momentan sichtbaren Formulareinstellungen.' : 'Ohne laufenden Auftrag wird die aktuell gewählte Konfiguration erklärt.' },
      { label: 'Modus', value: mode === 'Write' ? 'Änderungen erlauben' : 'Nur lesen', detail: mode === 'Write' ? 'Änderungen entstehen isoliert; Review, Commit, Integration und Push bleiben getrennte Gates.' : 'Analyse ohne beabsichtigte Repository-Änderung.' },
      { label: 'Provider-Route', value: routeLabel, detail: routeValid ? 'Reihenfolge und Fallback-Regel werden aus der aktiven Route übernommen.' : 'Die Konfiguration kann in diesem Modus keinen Agenten starten.' },
      { label: 'Tool-Aktivierung', value: codeTask ? 'Code-Werkzeuge bei Bedarf' : 'Nur benötigte Werkzeuge', detail: 'Installierte Tools werden nicht pauschal geladen. Rolle, Auftragssignal und Gesundheitsstatus entscheiden über ihre Aktivierung.' },
    ],
    stages,
    tools,
    policy: { mode: 'read-only', explanation: 'Diese Ansicht erklärt den vorhandenen Zustand und startet, installiert, committet, integriert oder pusht nichts.' },
  };
}

module.exports = { STATE_LABELS, buildCurrentWorkflow, canonicalProvider, isCodeTask, normalizeRoute, referenceJob };
