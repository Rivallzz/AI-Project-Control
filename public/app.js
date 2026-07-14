'use strict';

import { api, createRequestState } from './modules/request-state.js';
import {
  createProjectUiState, jobBelongsInConversation, jobPhaseLabel, reconcileConversationSources, runStatusPresentation,
} from './modules/project-ui-state.js';
import {
  MODEL_CATALOG_VERSION, PROVIDERS, availableModels, defaultModelId, modelCatalog, modelDecisionText,
  modelProfile, modelProfiles, primaryFirst, reconcileModelSelection, selectedModel, taskStartState,
} from './modules/model-selection.js';
import { centeredGraphPan, linkedGraphNodeIds } from './modules/graph-selection.js';
import { renderWorkflow, workflowCodeSignal } from './modules/workflow-view.js';

const elements = {
  connection: document.getElementById('connectionState'),
  backgroundActivity: document.getElementById('backgroundActivity'),
  projectSelect: document.getElementById('projectSelect'), addProject: document.getElementById('addProjectButton'),
  providerList: document.getElementById('providerList'), componentList: document.getElementById('componentList'), workflowContext: document.getElementById('workflowContext'),
  executionPanel: document.getElementById('executionPanel'), providerRoute: document.getElementById('providerRouteList'), routeSummary: document.getElementById('routeSummary'),
  providerPreset: document.getElementById('providerPresetControl'), providerDetails: document.getElementById('providerDetails'),
  primaryProvider: document.getElementById('primaryProviderSelect'), modelProfile: document.getElementById('modelProfileSelect'), modelProfileHint: document.getElementById('modelProfileHint'),
  refreshModels: document.getElementById('refreshModelsButton'), modelCatalogState: document.getElementById('modelCatalogState'),
  taskHeading: document.getElementById('taskHeading'), form: document.getElementById('taskForm'), task: document.getElementById('taskText'),
  attachmentInput: document.getElementById('attachmentInput'), attachmentButton: document.getElementById('attachmentButton'),
  attachmentPreview: document.getElementById('attachmentPreview'),
  mode: document.getElementById('modeSelect'),
  useSubscriptionTokens: document.getElementById('useSubscriptionTokens'),
  start: document.getElementById('startButton'), formMessage: document.getElementById('formMessage'),
  knowledgeProjectName: document.getElementById('knowledgeProjectName'), knowledgeSearch: document.getElementById('knowledgeSearch'),
  knowledgeLoadState: document.getElementById('knowledgeLoadState'), graphStats: document.getElementById('graphStats'),
  graphCanvas: document.getElementById('graphCanvas'), graphNodeList: document.getElementById('graphNodeList'), graphDetails: document.getElementById('graphDetails'),
  obsidianStats: document.getElementById('obsidianStats'), noteList: document.getElementById('noteList'),
  noteTitle: document.getElementById('noteTitle'), noteContent: document.getElementById('noteContent'),
  history: document.getElementById('conversationHistory'), historyJumpLatest: document.getElementById('historyJumpLatest'),
  memoryForm: document.getElementById('memoryForm'), memoryText: document.getElementById('memoryText'), memoryMessage: document.getElementById('memoryMessage'),
  workflowRefresh: document.getElementById('workflowRefreshButton'), workflowOverview: document.getElementById('workflowOverview'),
  systemsRefresh: document.getElementById('systemsRefreshButton'), mcpSummary: document.getElementById('mcpSummary'), mcpServerList: document.getElementById('mcpServerList'),
  systemSetupSummary: document.getElementById('systemSetupSummary'), projectSystems: document.getElementById('projectSystems'),
  globalSystems: document.getElementById('globalSystems'), systemForm: document.getElementById('systemForm'),
  systemName: document.getElementById('systemName'), systemType: document.getElementById('systemType'), systemPath: document.getElementById('systemPath'),
  systemScope: document.getElementById('systemScope'), systemNote: document.getElementById('systemNote'), systemMessage: document.getElementById('systemMessage'),
  provisionForm: document.getElementById('provisionForm'), provisionName: document.getElementById('provisionName'),
  provisionSlug: document.getElementById('provisionSlug'), provisionParent: document.getElementById('provisionParent'),
  provisionDescription: document.getElementById('provisionDescription'), provisionGitHub: document.getElementById('provisionGitHub'),
  provisionVisibility: document.getElementById('provisionVisibility'), provisionMessage: document.getElementById('provisionMessage'),
  portfolioSummary: document.getElementById('portfolioSummary'), portfolioProjects: document.getElementById('portfolioProjects'),
  gitProjectName: document.getElementById('gitProjectName'), gitTarget: document.getElementById('gitTargetSelect'), gitState: document.getElementById('gitState'), gitSummary: document.getElementById('gitSummary'),
  gitFileList: document.getElementById('gitFileList'), gitDiff: document.getElementById('gitDiffContent'), gitSelectAll: document.getElementById('gitSelectAll'),
  gitImagePreview: document.getElementById('gitImagePreview'), gitImagePreviewImage: document.getElementById('gitImagePreviewImage'), gitImagePreviewCaption: document.getElementById('gitImagePreviewCaption'),
  gitDiffFileName: document.getElementById('gitDiffFileName'), gitCommitMessage: document.getElementById('gitCommitMessage'),
  gitDeliverySteps: document.getElementById('gitDeliverySteps'),
  gitBranchFlow: document.getElementById('gitBranchFlow'), gitCommit: document.getElementById('gitCommitButton'), gitCommitPush: document.getElementById('gitCommitPushButton'),
  gitIntegrate: document.getElementById('gitIntegrateButton'), gitCleanupMerged: document.getElementById('gitCleanupMergedButton'), gitPush: document.getElementById('gitPushButton'), gitMessage: document.getElementById('gitMessage'),
  busyOverlay: document.getElementById('busyOverlay'), busyTitle: document.getElementById('busyTitle'), busyMessage: document.getElementById('busyMessage'),
};

let config = null;
let registry = null;
let activeProject = null;
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
let visibleGitDraftKey = null;
let visibleGitDraftValue = null;
const gitDraftSaveTimers = new Map();
let selectedAttachments = [];
const projectUiState = createProjectUiState();
let liveJobs = new Map();
let jobEventSource = null;
let jobRenderPending = false;
let workflowRefreshTimer = null;
let workflowLastRequestedAt = 0;
let componentStatus = null;
let providerStatus = null;
let modelCatalogReady = false;
let modelCatalogLoading = false;
let activeModelCatalogToken = null;
let modelRecoveryMessage = '';
let providerStatusErrorMessage = '';
let busyReturnFocus = null;
let historyFollow = true;
let historyLatestVersion = null;
let runHistory = [];
const conversationNodes = new Map();
const submittedTaskText = new Map();
const submittedTaskAttachments = new Map();
const terminalHistoryRefreshes = new Set();
const acknowledgedActivityJobs = new Set(JSON.parse(sessionStorage.getItem('acknowledgedActivityJobs') || '[]'));
const JOB_KINDS = new Set(['task', 'dashboard-command', 'install', 'update', 'provision']);
const API_CONTRACT_VERSION = 3;

const requestState = createRequestState(() => activeProject?.id || null);
const beginRequest = (...args) => requestState.begin(...args);
const requestIsCurrent = (token) => requestState.isCurrent(token);
const invalidateProjectRequests = () => requestState.invalidateProject();

function storeComposerDraft(projectId = activeProject?.id) {
  if (!projectId) return;
  projectUiState.saveComposer(projectId, elements.task.value, selectedAttachments);
}

function restoreComposerDraft(projectId) {
  const draft = projectUiState.loadComposer(projectId);
  elements.task.value = draft.text;
  selectedAttachments = draft.attachments;
  elements.task.style.height = '';
  if (elements.task.value) elements.task.style.height = `${Math.min(elements.task.scrollHeight, 180)}px`;
  renderAttachmentPreview();
  elements.formMessage.textContent = selectedAttachments.length ? `${selectedAttachments.length} Bild(er) für ${activeProject?.name || 'dieses Projekt'} vorgemerkt.` : '';
}

function clearComposerDraft(projectId) {
  projectUiState.clearComposer(projectId);
  if (activeProject?.id === projectId) {
    elements.task.value = '';
    elements.task.style.height = '';
    clearAttachments(false);
  }
}

function executionPreferenceKey() {
  return `ai-project-control:execution:${activeProject?.id || 'default'}`;
}

function providerRows() {
  return [...elements.providerRoute.querySelectorAll('.provider-route-row')];
}

function providerModelSelect(provider) {
  return elements.providerRoute.querySelector(`[data-provider-model="${provider}"]`);
}

function defaultModel(provider) {
  return defaultModelId(config, provider);
}

function modelStateElement(provider) {
  return elements.providerRoute.querySelector(`[data-model-state="${provider}"]`);
}

function updateProviderModelState(provider) {
  const model = selectedModel(config, provider, providerModelSelect(provider).value);
  const providerEntry = modelCatalog(config)?.providers?.[provider];
  const runtime = providerStatus?.[provider.toLowerCase()];
  const runtimeMessage = runtime && !runtime.available ? `Provider nicht bereit: ${runtime.reason || 'lokale Verbindung oder Kontingent nicht verfügbar.'}` : '';
  modelStateElement(provider).textContent = [modelDecisionText(model)
    || providerEntry?.message
    || `Für ${provider} ist kein Modell verfügbar.`, runtimeMessage].filter(Boolean).join(' · ');
}

function populateProviderModel(provider, selectedValue = null) {
  const select = providerModelSelect(provider);
  const providerEntry = modelCatalog(config)?.providers?.[provider];
  const selection = reconcileModelSelection(config, provider, selectedValue);
  select.replaceChildren();
  for (const model of providerEntry?.models || []) {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.displayName;
    option.disabled = model.availability !== 'available' || Boolean(model.deprecated);
    select.append(option);
  }
  if (!availableModels(config, provider).length) {
    const option = document.createElement('option'); option.value = ''; option.textContent = 'Kein ausführbares Modell verfügbar'; option.disabled = true; select.append(option);
  }
  select.value = selection.value;
  updateProviderModelState(provider);
  return selection;
}

function renderModelCatalogState(message = '') {
  if (message) { elements.modelCatalogState.textContent = message; return; }
  const catalog = modelCatalog(config);
  if (!catalog) { elements.modelCatalogState.textContent = 'Modellkatalog nicht verfügbar.'; return; }
  const total = PROVIDERS.reduce((count, provider) => count + availableModels(config, provider).length, 0);
  const issues = PROVIDERS.map((provider) => catalog.providers?.[provider])
    .filter((entry) => entry && entry.status !== 'available')
    .map((entry) => `${entry.displayName}: ${entry.message}`);
  elements.modelCatalogState.textContent = providerStatusErrorMessage
    || modelRecoveryMessage
    || (issues.length ? `${total} Modelle · Teilweise verfügbar: ${issues.join(' ')}` : `${total} ausführbare Modelle erkannt.`);
}

function selectedModelProfile() {
  return elements.modelProfile.value || 'balanced';
}

function populateModelProfiles(selectedId = 'balanced') {
  const profiles = modelProfiles(config);
  elements.modelProfile.replaceChildren();
  for (const profile of profiles) {
    const option = document.createElement('option'); option.value = profile.id; option.textContent = profile.displayName; elements.modelProfile.append(option);
  }
  const custom = document.createElement('option'); custom.value = 'custom'; custom.textContent = 'Benutzerdefiniert'; elements.modelProfile.append(custom);
  const selectedExists = Boolean(modelProfile(config, selectedId)) || selectedId === 'custom';
  elements.modelProfile.value = selectedExists ? selectedId : 'balanced';
  updateModelProfileHint();
}

function updateModelProfileHint() {
  const profile = modelProfile(config, selectedModelProfile());
  elements.modelProfileHint.textContent = profile?.description
    || 'Individuelle Auswahl: Die konkreten Modelle sind unter „Providerdetails“ sichtbar und werden für dieses Projekt gespeichert.';
}

function applyModelProfile(profileId, persist = true) {
  const profile = modelProfile(config, profileId);
  elements.modelProfile.value = profile ? profile.id : 'custom';
  const recovery = [];
  if (profile) {
    for (const provider of PROVIDERS) {
      const selection = populateProviderModel(provider, profile.modelIds?.[provider]);
      if (selection.message) recovery.push(selection.message);
    }
  }
  modelRecoveryMessage = recovery.join(' ');
  updateModelProfileHint();
  renderModelCatalogState();
  renderExecutionControls(persist);
}

function makeProviderPrimary(provider) {
  const row = elements.providerRoute.querySelector(`[data-provider="${provider}"]`);
  if (!row) return;
  row.querySelector('.provider-enabled input').checked = true;
  elements.providerRoute.prepend(row);
  elements.primaryProvider.value = provider;
}

function readExecutionPreferences() {
  try { return JSON.parse(localStorage.getItem(executionPreferenceKey()) || '{}'); }
  catch { return {}; }
}

function selectedProviderPreset() {
  return elements.providerPreset.querySelector('input[name="providerPreset"]:checked')?.value || 'automatic';
}

function setProviderOrder(order) {
  for (const provider of order) {
    const row = elements.providerRoute.querySelector(`[data-provider="${provider}"]`);
    if (row) elements.providerRoute.append(row);
  }
}

function applyProviderPreset(preset, persist = true, revealDetails = false) {
  const radio = elements.providerPreset.querySelector(`input[value="${preset}"]`);
  if (radio) radio.checked = true;
  if (preset === 'automatic') {
    setProviderOrder(PROVIDERS);
    for (const row of providerRows()) row.querySelector('.provider-enabled input').checked = true;
    elements.primaryProvider.value = 'Codex';
    elements.useSubscriptionTokens.checked = true;
  } else if (preset === 'local') {
    setProviderOrder(['Ollama', 'Codex', 'Claude']);
    for (const row of providerRows()) row.querySelector('.provider-enabled input').checked = row.dataset.provider === 'Ollama';
    elements.primaryProvider.value = 'Ollama';
    elements.useSubscriptionTokens.checked = false;
  }
  if (revealDetails || preset === 'custom') elements.providerDetails.open = true;
  renderExecutionControls(persist);
}

function currentProviderOrder() {
  let enabled = providerRows()
    .filter((row) => row.querySelector('.provider-enabled input').checked
      && selectedModel(config, row.dataset.provider, providerModelSelect(row.dataset.provider).value)
      && providerRuntimeAvailable(row.dataset.provider))
    .map((row) => row.dataset.provider);
  if (elements.mode.value === 'Write' && !elements.useSubscriptionTokens.checked) return [];
  if (elements.mode.value === 'Write') enabled = enabled.filter((provider) => provider !== 'Ollama');
  if (!elements.useSubscriptionTokens.checked) return enabled.includes('Ollama') ? ['Ollama'] : [];
  return primaryFirst(enabled, elements.primaryProvider.value);
}

function selectedProviderModels() {
  return Object.fromEntries(PROVIDERS.map((provider) => [provider, providerModelSelect(provider).value || defaultModel(provider) || 'default']));
}

function providerRuntimeAvailable(provider) {
  return Boolean(providerStatus?.[provider.toLowerCase()]?.available);
}

function hasRunningTask() {
  return [...liveJobs.values()].some((job) => job.projectId === activeProject?.id && (job.kind || 'task') === 'task' && ['running', 'stopping'].includes(job.status));
}

function providerConfiguredForMode(provider) {
  const row = elements.providerRoute.querySelector(`[data-provider="${provider}"]`);
  if (!row?.querySelector('.provider-enabled input').checked || !selectedModel(config, provider, providerModelSelect(provider).value)) return false;
  if (!elements.useSubscriptionTokens.checked) return provider === 'Ollama' && elements.mode.value !== 'Write';
  return !(elements.mode.value === 'Write' && provider === 'Ollama');
}

function saveExecutionPreferences() {
  if (!activeProject) return;
  const value = {
    order: providerRows().map((row) => row.dataset.provider),
    enabled: Object.fromEntries(providerRows().map((row) => [row.dataset.provider, row.querySelector('.provider-enabled input').checked])),
    preset: selectedProviderPreset(), primaryProvider: elements.primaryProvider.value, modelProfile: selectedModelProfile(), models: selectedProviderModels(), mode: elements.mode.value, useSubscriptionTokens: elements.useSubscriptionTokens.checked,
  };
  localStorage.setItem(executionPreferenceKey(), JSON.stringify(value));
}

function renderExecutionControls(persist = true) {
  const preset = selectedProviderPreset();
  const custom = preset === 'custom';
  if (!elements.useSubscriptionTokens.checked) {
    elements.providerRoute.querySelector('[data-provider="Ollama"] .provider-enabled input').checked = true;
  }
  const rows = providerRows();
  rows.forEach((row, index) => {
    const provider = row.dataset.provider;
    const enabled = row.querySelector('.provider-enabled input').checked;
    const unavailableForTokens = !elements.useSubscriptionTokens.checked && provider !== 'Ollama';
    const unavailableForMode = elements.mode.value === 'Write' && provider === 'Ollama';
    const modelAvailable = Boolean(selectedModel(config, provider, providerModelSelect(provider).value));
    const runtimeAvailable = providerRuntimeAvailable(provider);
    row.classList.toggle('route-disabled', !enabled || unavailableForTokens || unavailableForMode || !modelAvailable || !runtimeAvailable);
    row.classList.toggle('model-unavailable', !modelAvailable);
    row.classList.toggle('runtime-unavailable', modelAvailable && !runtimeAvailable);
    updateProviderModelState(provider);
    row.querySelector('.provider-enabled input').disabled = !custom || unavailableForTokens || unavailableForMode || !modelAvailable || modelCatalogLoading;
    providerModelSelect(provider).disabled = !enabled || unavailableForTokens || unavailableForMode || !availableModels(config, provider).length || modelCatalogLoading;
  });
  elements.primaryProvider.disabled = !custom || modelCatalogLoading;
  elements.useSubscriptionTokens.disabled = !custom || modelCatalogLoading;
  elements.modelProfile.disabled = !modelCatalogReady || modelCatalogLoading;
  elements.refreshModels.disabled = !modelCatalogReady || modelCatalogLoading;
  elements.providerDetails.classList.toggle('preset-managed', !custom);
  const route = currentProviderOrder();
  if (custom && route.length && !route.includes(elements.primaryProvider.value) && !providerConfiguredForMode(elements.primaryProvider.value)) makeProviderPrimary(route[0]);
  const names = route.map((provider) => provider === 'Ollama' ? 'Hermes + Ollama' : provider === 'Claude' ? 'Claude Code' : provider);
  const summaryStrong = document.createElement('strong');
  const summaryDetail = document.createTextNode('');
  if (route.length) {
    const leadingProvider = route[0];
    const leadingModel = selectedModel(config, leadingProvider, providerModelSelect(leadingProvider).value);
    const profile = modelProfile(config, selectedModelProfile());
    summaryStrong.textContent = names.join(' → ');
    summaryDetail.textContent = `${profile?.displayName || 'Benutzerdefiniert'} · Zuerst: ${leadingModel?.displayName || 'kein Modell'}. ${elements.mode.value === 'Write' ? 'Getrennter Task-Worktree; lokaler Schreibpfad gesperrt.' : 'Fallback nur bei einem erkannten Kontingentlimit.'}`;
  } else if (!providerStatus) {
    summaryStrong.textContent = 'Provider werden geprüft.';
    summaryDetail.textContent = ' Senden wird freigegeben, sobald mindestens ein aktiver Provider bereit ist.';
  } else if (elements.mode.value === 'Write' && !elements.useSubscriptionTokens.checked) {
    summaryStrong.textContent = 'Schreibmodus benötigt Codex oder Claude.';
    summaryDetail.textContent = ' Aktiviere Abo-Kontingente oder wechsle zu „Nur lesen“.';
  } else {
    summaryStrong.textContent = 'Kein ausführbarer Provider aktiv.';
    summaryDetail.textContent = ' Prüfe Modellkatalog, Providerdetails und Modus.';
  }
  elements.routeSummary.replaceChildren(summaryStrong, document.createElement('br'), summaryDetail);
  const startState = taskStartState({ providerOrder: route, hasRunningTask: hasRunningTask(), catalogReady: modelCatalogReady, catalogLoading: modelCatalogLoading, runtimeReady: Boolean(providerStatus) });
  elements.start.disabled = startState.disabled;
  elements.start.textContent = startState.label;
  elements.start.title = startState.reason;
  if (persist) saveExecutionPreferences();
  if (componentStatus) renderComponents(componentStatus);
}

function loadExecutionPreferences() {
  const value = readExecutionPreferences();
  const requestedOrder = Array.isArray(value.order) ? value.order.filter((provider) => PROVIDERS.includes(provider)) : [];
  const order = [...requestedOrder, ...PROVIDERS.filter((provider) => !requestedOrder.includes(provider))];
  for (const provider of order) elements.providerRoute.append(elements.providerRoute.querySelector(`[data-provider="${provider}"]`));
  elements.primaryProvider.value = PROVIDERS.includes(value.primaryProvider) ? value.primaryProvider : order[0] || 'Codex';
  const savedProfileExists = Boolean(modelProfile(config, value.modelProfile)) || value.modelProfile === 'custom';
  const requestedProfile = savedProfileExists ? value.modelProfile : Object.keys(value.models || {}).length ? 'custom' : 'balanced';
  populateModelProfiles(requestedProfile);
  const recovery = [];
  for (const provider of PROVIDERS) {
    const row = elements.providerRoute.querySelector(`[data-provider="${provider}"]`);
    row.querySelector('.provider-enabled input').checked = value.enabled?.[provider] !== false;
    const requestedModel = requestedProfile === 'custom' ? value.models?.[provider] : modelProfile(config, requestedProfile)?.modelIds?.[provider];
    const selection = populateProviderModel(provider, requestedModel);
    if (selection.message) recovery.push(selection.message);
  }
  elements.mode.value = ['ReadOnly', 'Write'].includes(value.mode) ? value.mode : 'ReadOnly';
  elements.useSubscriptionTokens.checked = value.useSubscriptionTokens !== false;
  const preset = ['automatic', 'local', 'custom'].includes(value.preset)
    ? value.preset
    : Object.keys(value).length ? 'custom' : 'automatic';
  modelRecoveryMessage = recovery.join(' ');
  updateModelProfileHint();
  renderModelCatalogState();
  applyProviderPreset(preset, false, false);
}

function projectQuery(projectId = activeProject?.id) {
  return `projectId=${encodeURIComponent(projectId)}`;
}

function setBusy(active, title = 'Bitte warten', message = 'Lokaler Projektzustand wird geladen.') {
  if (active) busyReturnFocus = document.activeElement;
  elements.busyTitle.textContent = title; elements.busyMessage.textContent = message;
  elements.busyOverlay.classList.toggle('hidden', !active);
  elements.projectSelect.disabled = active;
  document.body.setAttribute('aria-busy', active ? 'true' : 'false');
  document.querySelector('.topbar').inert = active;
  document.getElementById('mainContent').inert = active;
  if (!active && busyReturnFocus instanceof HTMLElement && busyReturnFocus.isConnected) {
    busyReturnFocus.focus(); busyReturnFocus = null;
  }
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
  state.textContent = provider.available ? 'bereit' : 'nicht bereit'; line.append(label, state);
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
  providerStatus = status;
  elements.providerList.replaceChildren();
  const codex = status.codex;
  const creditNote = codex.credits?.has_credits ? ` · Zusatz-Credits ${Number(codex.credits.balance).toFixed(2)} (gesperrt)` : ' · keine abrechenbaren API-Credits verwendet';
  const secondaryNote = Number.isFinite(codex.secondary_used_percent) ? ` · Woche ${codex.secondary_used_percent}%` : ' · Wochenfenster nicht gemeldet';
  const codexDetail = codex.quota_known
    ? `${codex.primary_used_percent}% im 5h-Fenster · Reset ${codex.primary_resets_local || 'nicht gemeldet'}${secondaryNote}${creditNote}`
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
  const providerOrder = running?.providerOrder || currentProviderOrder();
  const provider = running?.provider || (providerOrder.length === 1 ? providerOrder[0] : 'Auto');
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
    const names = providerOrder.map((name) => name === 'Ollama' ? 'Hermes lokal' : name);
    const cloudReady = providerOrder.some((name) => name === 'Codex' && data.codex.ok) || providerOrder.some((name) => name === 'Claude' && data.claude.ok);
    const localReady = providerOrder.some((name) => name === 'Ollama' && data.hermes.ok && data.ollama.ok);
    execution = { name: 'Ausführung · Route', ok: cloudReady || localReady, detail: names.join(' → ') };
  }
  rows.push(componentRow(execution.name, execution.ok, execution.detail));

  const taskText = `${running?.taskPreview || ''} ${elements.task.value}`;
  const needsCodeTools = mode === 'Write' && /\b(code|c#|godot|script|klasse|symbol|bug|test|integration|terrain|szene|scene)\b/i.test(taskText);
  if (needsCodeTools) rows.push(componentRow('MCP-Werkzeuge', data.mcp.ok, data.mcp.text));
  elements.componentList.append(...rows);
}

function renderJobActivity() {
  const allTasks = Array.from(liveJobs.values()).filter((job) => JOB_KINDS.has(job.kind || 'task'));
  const running = allTasks.filter((job) => ['running', 'stopping'].includes(job.status));
  const projectForJob = (job) => projectUiState.jobOrigin(job.id) || job.projectId;
  const background = running.filter((job) => projectForJob(job) !== activeProject?.id);
  const current = running.find((job) => projectForJob(job) === activeProject?.id);
  const recentTerminal = allTasks.filter((job) => projectForJob(job) !== activeProject?.id && ['completed', 'failed', 'blocked'].includes(job.status)
    && !acknowledgedActivityJobs.has(job.id) && job.finishedAt && Date.now() - new Date(job.finishedAt).getTime() < 30 * 60 * 1000)
    .sort((left, right) => String(right.finishedAt).localeCompare(String(left.finishedAt)));
  const visible = background.length ? background : current ? [current] : recentTerminal.slice(0, 1);
  const primary = visible[0];
  elements.backgroundActivity.className = `background-activity${primary ? ` ${primary.status}` : ' hidden'}`;
  if (!primary) { elements.backgroundActivity.textContent = ''; elements.backgroundActivity.removeAttribute('title'); delete elements.backgroundActivity.dataset.jobId; delete elements.backgroundActivity.dataset.projectId; return; }
  const statusText = primary.status === 'running' ? 'läuft' : primary.status === 'completed' ? 'abgeschlossen · prüfen' : primary.status === 'blocked' ? 'blockiert · prüfen' : 'fehlgeschlagen · prüfen';
  elements.backgroundActivity.textContent = background.length > 1 ? `${primary.projectName} +${background.length - 1} · ${statusText}` : `${primary.projectName} · ${statusText}`;
  elements.backgroundActivity.title = visible.map((job) => `${job.projectName}: ${job.taskPreview}`).join('\n');
  elements.backgroundActivity.dataset.jobId = primary.id; elements.backgroundActivity.dataset.projectId = projectForJob(primary);
}

function formatTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
}

function visibleLiveJobs() {
  if (!activeProject) return [];
  return Array.from(liveJobs.values())
    .filter((job) => jobBelongsInConversation(job, activeProject.id, projectUiState.jobOrigin(job.id)))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

function scheduleLiveJobRender() {
  if (jobRenderPending) return;
  jobRenderPending = true;
  requestAnimationFrame(() => {
    jobRenderPending = false;
    renderConversation();
    renderJobActivity();
    renderExecutionControls(false);
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
      scheduleWorkflowRefresh();
      const jobProjectId = projectUiState.jobOrigin(job.id) || job.projectId;
      if (jobProjectId === activeProject?.id && ['completed', 'failed', 'blocked', 'stopped'].includes(job.status) && !terminalHistoryRefreshes.has(job.id)) {
        terminalHistoryRefreshes.add(job.id);
        if (['task', 'dashboard-command'].includes(job.kind || 'task')) {
          setTimeout(() => refreshHistory(), 250);
          setTimeout(() => refreshHistory(), 1500);
        }
        if (['install', 'update'].includes(job.kind)) setTimeout(() => loadSystems(false, true), 500);
        if (job.kind === 'provision') setTimeout(() => refreshProjectRegistry(), 500);
      }
    } catch {}
  });
}

function summarizeFeedLine(line) {
  if (/Dashboard restarted before this job reached a terminal state/i.test(line)) {
    return 'Dashboard neu gestartet · dieser Job wurde unterbrochen und arbeitet nicht mehr.';
  }
  const blocked = line.match(/AI_PROJECT_ROUTER_BLOCKED\s+provider=([^\s]+)/i);
  if (blocked) return `${blocked[1]} · Aufgabe kontrolliert blockiert; Begründung im Verlauf.`;
  const incomplete = line.match(/Provider\s+(\w+)\s+exited without the required completion sentinel/i);
  if (incomplete) return `${incomplete[1]} · Aufgabe unvollständig: erforderliche Abschlussmarke fehlt.`;
  const readOnlyViolation = line.match(/Provider\s+(\w+)\s+changed the worktree during a read-only task/i);
  if (readOnlyViolation) return `${readOnlyViolation[1]} · Read-only-Schutz ausgelöst: isolierte Änderungen wurden verworfen.`;
  if (/local Hermes.*write tasks are disabled/i.test(line)) return 'Hermes lokal · Schreibaufträge sind aus Sicherheitsgründen gesperrt.';
  const runDirectory = line.match(/AI_RUN_DIRECTORY\s+(.+)/);
  if (runDirectory) return `Run-Artefakte · ${runDirectory[1]}`;
  const providerEvent = line.match(/AI_EVENT\s+provider=([^\s]+)\s+state=([^\s]+)/i);
  if (providerEvent) {
    const model = line.match(/\bmodel=([^\s]+)/i)?.[1];
    if (providerEvent[2] === 'started') return `${providerEvent[1]} startet${model ? ` · Modell ${model}` : ''}`;
    if (providerEvent[2] === 'finished') return `${providerEvent[1]} hat die Ausführung beendet`;
    return `${providerEvent[1]} · ${providerEvent[2]}`;
  }
  const stream = line.match(/AI_STREAM provider=([^\s]+)\s+(.+)/);
  if (stream) {
    try {
      const event = JSON.parse(stream[2]);
      const type = event.type || event.item?.type || 'event';
      const detail = event.item?.command || event.item?.text || event.item?.name || event.message || '';
      if (type === 'turn.started') return `${stream[1]} bearbeitet die Aufgabe`;
      if (event.item?.type === 'agent_message') return `${stream[1]} berichtet · ${String(detail).slice(0, 280)}`;
      if (event.item?.type === 'command_execution') {
        const action = event.type === 'item.started' ? 'führt einen lokalen Befehl aus' : 'hat einen lokalen Befehl abgeschlossen';
        return `${stream[1]} ${action}${detail ? ` · ${String(detail).replace(/\s+/g, ' ').slice(0, 220)}` : ''}`;
      }
      return `${stream[1]} · ${type}${detail ? ` · ${String(detail).slice(0, 280)}` : ''}`;
    } catch { return `${stream[1]} · ${stream[2].slice(0, 320)}`; }
  }
  return line.slice(0, 500);
}

function jobLogEntries(job) {
  const stdout = String(job.stdout || '').split(/\r?\n/).filter(Boolean).map((line) => ({
    line,
    kind: /AI_EVENT|AI_RUN_DIRECTORY|AI_PROJECT_ROUTER_(?:OK|BLOCKED)/.test(line) || /^\[\d{4}-/.test(line) ? 'event' : '',
  }));
  const stderr = String(job.stderr || '').split(/\r?\n/).filter(Boolean).map((line) => ({ line, kind: 'error' }));
  return [...stdout, ...stderr];
}

function importantJobEntries(job) {
  const entries = jobLogEntries(job).filter((entry) => {
    if (entry.kind) return true;
    const stream = entry.line.match(/AI_STREAM provider=[^\s]+\s*(.*)/);
    return stream && /turn\.started|item\.(?:started|completed)|preparing|\bread\b|\bsearch|\btool\b|\$\s+|API call failed|completion sentinel|read-only/i.test(stream[1]);
  });
  const unique = [];
  for (const entry of entries) {
    const summary = summarizeFeedLine(entry.line);
    if (!summary || unique.at(-1)?.summary === summary) continue;
    unique.push({ ...entry, summary });
  }
  return unique.slice(-6);
}

function jobKindLabel(job) {
  if (job.kind === 'install') return 'Installation';
  if (job.kind === 'update') return 'Update';
  if (job.kind === 'provision') return 'Projektaufbau';
  if (job.kind === 'dashboard-command') return 'Projekteinrichtung';
  return 'Agent';
}

function providerKey(value) {
  const normalized = String(value || '').toLowerCase();
  return PROVIDERS.find((provider) => provider.toLowerCase() === normalized) || null;
}

function jobExecutionIdentity(job) {
  const provider = job.selectedProvider || job.provider || jobKindLabel(job);
  const key = providerKey(provider);
  const modelId = job.selectedModel || (key ? job.models?.[key] : null);
  return modelId ? `${provider} · ${modelId === 'default' ? 'Provider-Standard' : modelId}` : provider;
}

function jobStatus(job) {
  const kind = jobKindLabel(job);
  if (job.status === 'running') return { label: 'läuft', className: 'info', title: (job.kind || 'task') === 'task' ? 'Agent arbeitet' : `${kind} läuft` };
  if (job.status === 'stopping') return { label: 'wird gestoppt', className: 'warn', title: `${kind} wird kontrolliert gestoppt` };
  if (job.status === 'completed') return {
    label: (job.kind || 'task') === 'task' ? 'Agent fertig' : 'abgeschlossen', className: 'ok',
    title: (job.kind || 'task') === 'task' ? 'Agent fertig, Review offen' : `${kind} abgeschlossen`,
  };
  if (job.status === 'blocked') return { label: 'blockiert', className: 'warn', title: `${kind} benötigt eine Entscheidung` };
  if (job.status === 'stopped') return { label: 'gestoppt', className: 'warn', title: `${kind} wurde gestoppt` };
  return { label: 'fehlgeschlagen', className: 'fail', title: `${kind} ist fehlgeschlagen` };
}

function deliveryStep(label, state, detail) {
  const item = document.createElement('li'); item.className = `delivery-step ${state}`;
  const name = document.createElement('span'); name.textContent = label;
  const value = document.createElement('strong'); value.textContent = detail;
  item.append(name, value); return item;
}

function executionDeliveryElement(mode, status, branch = null, deliveryState = null) {
  if (mode !== 'Write') return null;
  const completed = status === 'completed' || status === 'PASS';
  const failed = ['failed', 'blocked', 'stopped', 'FAIL', 'BLOCKED'].includes(status);
  const running = ['running', 'stopping'].includes(status);
  const unknown = !completed && !failed && !running;
  const list = document.createElement('ol'); list.className = 'delivery-steps compact'; list.setAttribute('aria-label', 'Ausführung und Freigabe');
  list.append(
    deliveryStep('Agent', completed ? 'done' : failed ? 'blocked' : unknown ? 'unknown' : 'active', completed ? 'fertig' : failed ? 'nicht fertig' : unknown ? 'nicht bestätigt' : 'arbeitet'),
    deliveryStep('Review', deliveryState === 'review-required' || completed ? 'ready' : failed ? 'blocked' : 'waiting', deliveryState === 'review-required' || completed ? 'offen' : failed ? 'blockiert' : unknown ? 'kein Ergebnis' : 'wartet'),
    deliveryStep('Commit', 'unknown', branch ? 'im Git-Bereich' : 'keine Laufdaten'),
    deliveryStep('Integration', 'unknown', running ? 'wartet' : 'im Git-Bereich'),
    deliveryStep('Push', 'unknown', running ? 'wartet' : 'im Git-Bereich'),
  );
  return list;
}

function jobConversationElement(job) {
  const article = document.createElement('article'); article.className = 'conversation-run live-conversation-run'; article.dataset.jobId = job.id;
  const meta = document.createElement('div'); meta.className = 'conversation-meta';
  const identity = document.createElement('span'); identity.dataset.jobIdentity = '';
  const state = document.createElement('span'); state.dataset.jobState = '';
  meta.append(identity, state);
  const user = messageElement('user', 'Du', '', []); user.dataset.jobPrompt = '';
  const assistant = document.createElement('div'); assistant.className = 'message assistant live-response';
  const label = document.createElement('div'); label.className = 'message-label'; label.dataset.jobProvider = '';
  const body = document.createElement('div'); body.className = 'message-body';
  const progress = document.createElement('div'); progress.className = 'agent-progress'; progress.dataset.jobProgress = '';
  progress.setAttribute('role', 'status'); progress.setAttribute('aria-live', 'polite'); progress.setAttribute('aria-atomic', 'true');
  const marker = document.createElement('span'); marker.className = 'agent-progress-marker'; marker.setAttribute('aria-hidden', 'true');
  const progressText = document.createElement('div');
  const title = document.createElement('strong'); title.dataset.jobTitle = '';
  const phase = document.createElement('span'); phase.dataset.jobPhase = '';
  const current = document.createElement('span'); current.className = 'agent-progress-current'; current.dataset.jobCurrent = '';
  const timing = document.createElement('span'); timing.className = 'agent-progress-time'; timing.dataset.jobTiming = '';
  progressText.append(title, phase, current, timing); progress.append(marker, progressText);
  const timeline = document.createElement('div'); timeline.className = 'activity-timeline hidden'; timeline.dataset.jobTimeline = '';
  const technical = document.createElement('details'); technical.className = 'technical-activity hidden'; technical.dataset.jobTechnical = '';
  const technicalSummary = document.createElement('summary'); technicalSummary.dataset.jobTechnicalSummary = '';
  const log = document.createElement('div'); log.className = 'technical-activity-log'; log.dataset.jobLog = '';
  technical.append(technicalSummary, log);
  const delivery = document.createElement('div'); delivery.dataset.jobDelivery = '';
  const actions = document.createElement('div'); actions.className = 'run-actions hidden'; actions.dataset.jobActions = '';
  body.append(progress, timeline, technical, delivery, actions); assistant.append(label, body); article.append(meta, user, assistant);
  updateJobConversationElement(article, job);
  return article;
}

function updateJobConversationElement(article, job) {
  const status = jobStatus(job);
  const identity = article.querySelector('[data-job-identity]');
  identity.textContent = `${formatTime(job.createdAt || job.startedAt)} · ${jobKindLabel(job)}`;
  const state = article.querySelector('[data-job-state]'); state.className = `status ${status.className}`; state.textContent = status.label;
  const promptText = submittedTaskText.get(job.id) || job.taskPreview || `${jobKindLabel(job)} gestartet`;
  const promptAttachments = submittedTaskAttachments.get(job.id) || [];
  const promptSignature = `${promptText}\u0000${promptAttachments.map((attachment) => attachment.url || attachment.name).join('|')}`;
  const currentPrompt = article.querySelector('[data-job-prompt]');
  if (currentPrompt.dataset.signature !== promptSignature) {
    const prompt = messageElement('user', 'Du', promptText, promptAttachments); prompt.dataset.jobPrompt = ''; prompt.dataset.signature = promptSignature;
    currentPrompt.replaceWith(prompt);
  }
  article.querySelector('[data-job-provider]').textContent = jobExecutionIdentity(job) || 'AI Project Control';
  article.querySelector('[data-job-progress]').className = `agent-progress ${job.status}`;
  article.querySelector('[data-job-title]').textContent = status.title;
  const important = importantJobEntries(job);
  article.querySelector('[data-job-phase]').textContent = `${jobExecutionIdentity(job)} · ${jobPhaseLabel(job.phase)}`;
  const latestActivity = important.at(-1)?.summary;
  const currentActivity = latestActivity || (['running', 'stopping'].includes(job.status)
    ? `Task angenommen · ${jobPhaseLabel(job.phase)}`
    : job.status === 'failed' && job.phase === 'interrupted'
      ? 'Der Dashboard-Dienst wurde neu gestartet; dieser Job arbeitet nicht mehr.'
      : jobPhaseLabel(job.phase));
  article.querySelector('[data-job-current]').textContent = `${['running', 'stopping'].includes(job.status) ? 'Aktuell' : 'Zuletzt'}: ${currentActivity}`;
  article.querySelector('[data-job-timing]').textContent = `Gestartet ${formatTime(job.startedAt || job.createdAt)} · letzte Aktivität ${formatTime(job.updatedAt || job.finishedAt || job.startedAt || job.createdAt)}`;

  const timeline = article.querySelector('[data-job-timeline]');
  const timelineEntries = important.length ? important : ['running', 'stopping'].includes(job.status)
    ? [{ kind: '', summary: `Task angenommen · ${jobPhaseLabel(job.phase)}` }]
    : [];
  const timelineSignature = timelineEntries.map((entry) => `${entry.kind}:${entry.summary}`).join('|');
  if (timeline.dataset.signature !== timelineSignature) {
    timeline.replaceChildren(...timelineEntries.map((entry) => {
      const row = document.createElement('div'); row.className = `activity-event ${entry.kind}`; row.textContent = entry.summary; return row;
    }));
    timeline.dataset.signature = timelineSignature;
  }
  timeline.classList.toggle('hidden', timelineEntries.length === 0);

  const rawEntries = jobLogEntries(job);
  const technical = article.querySelector('[data-job-technical]');
  technical.classList.toggle('hidden', rawEntries.length === 0);
  article.querySelector('[data-job-technical-summary]').textContent = `Technische Aktivität (${rawEntries.length})`;
  const log = article.querySelector('[data-job-log]');
  const visibleEntries = rawEntries.slice(-100);
  const logSignature = visibleEntries.map((entry) => `${entry.kind}:${entry.line}`).join('|');
  if (log.dataset.signature !== logSignature) {
    log.replaceChildren(...visibleEntries.map((entry) => {
      const row = document.createElement('div'); row.className = `feed-line ${entry.kind}`; row.textContent = summarizeFeedLine(entry.line); return row;
    }));
    log.dataset.signature = logSignature;
  }

  const delivery = article.querySelector('[data-job-delivery]');
  const deliverySignature = `${job.mode}:${job.executionState || job.status}:${job.deliveryState || ''}:${job.branch || ''}`;
  if (delivery.dataset.signature !== deliverySignature) {
    const deliveryList = (job.kind || 'task') === 'task' ? executionDeliveryElement(job.mode, job.executionState || job.status, job.branch, job.deliveryState) : null;
    delivery.replaceChildren(...(deliveryList ? [deliveryList] : [])); delivery.dataset.signature = deliverySignature;
  }

  const actions = article.querySelector('[data-job-actions]');
  const canStop = ['running', 'stopping'].includes(job.status) && Boolean(job.cancellable ?? job.pid);
  let stop = actions.querySelector('[data-stop-job]');
  if (canStop && !stop) {
    stop = document.createElement('button'); stop.className = 'button destructive'; stop.type = 'button'; stop.dataset.stopJob = job.id; stop.textContent = 'Stoppen'; actions.append(stop);
  }
  if (stop) stop.disabled = job.status === 'stopping';
  actions.classList.toggle('hidden', !canStop);
}

function showView(name) {
  document.querySelectorAll('[data-view-panel]').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.viewPanel !== name));
  document.querySelectorAll('[data-view]').forEach((button) => {
    const selected = button.dataset.view === name;
    button.classList.toggle('active', selected); button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
  });
  elements.executionPanel.classList.toggle('hidden', name !== 'tasks');
  if (name === 'portfolio') loadPortfolio();
  if (name === 'workflow') loadWorkflow();
  if (name === 'knowledge') loadActiveKnowledge();
  if (name === 'git') loadGitState();
  if (name === 'tasks') { refreshHistory(); refreshJobs(); }
  if (name === 'systems') loadSystems();
}

function visibleViewName() {
  return document.querySelector('[data-view-panel]:not(.hidden)')?.dataset.viewPanel || 'tasks';
}

async function loadWorkflow(force = false, quiet = false) {
  if (!activeProject) return;
  const projectId = activeProject.id;
  const token = beginRequest('workflow', projectId);
  workflowLastRequestedAt = Date.now();
  elements.workflowRefresh.disabled = true;
  elements.workflowRefresh.setAttribute('aria-busy', 'true');
  if (!quiet) {
    elements.workflowOverview.setAttribute('aria-busy', 'true');
    const loading = document.createElement('p'); loading.className = 'empty'; loading.textContent = 'Workflow wird aus Projekt-, Job-, Tool- und Git-Zustand abgeleitet…';
    elements.workflowOverview.replaceChildren(loading);
  }
  const query = new URLSearchParams({
    projectId,
    mode: elements.mode.value,
    providerOrder: currentProviderOrder().join(','),
    useSubscriptionTokens: elements.useSubscriptionTokens.checked ? '1' : '0',
    codeTask: workflowCodeSignal(elements.task.value) ? '1' : '0',
    force: force ? '1' : '0',
  });
  try {
    const data = await api(`/api/workflow?${query}`);
    if (requestIsCurrent(token)) renderWorkflow(elements.workflowOverview, data);
  } catch (error) {
    if (requestIsCurrent(token)) {
      const message = document.createElement('p'); message.className = 'workflow-error'; message.textContent = `Workflow konnte nicht abgeleitet werden: ${error.message}`;
      elements.workflowOverview.replaceChildren(message); elements.workflowOverview.setAttribute('aria-busy', 'false');
    }
  } finally {
    if (requestIsCurrent(token)) { elements.workflowRefresh.disabled = false; elements.workflowRefresh.removeAttribute('aria-busy'); }
  }
}

function scheduleWorkflowRefresh(delay = 350) {
  if (visibleViewName() !== 'workflow' || workflowRefreshTimer) return;
  const minimumDelay = Math.max(0, 2000 - (Date.now() - workflowLastRequestedAt));
  workflowRefreshTimer = setTimeout(() => {
    workflowRefreshTimer = null;
    if (visibleViewName() === 'workflow') void loadWorkflow(false, true);
  }, Math.max(delay, minimumDelay));
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

function portfolioRows(data) {
  if (Array.isArray(data.projects)) return data.projects;
  return data.project ? [{ ...data.project, attention: data.attention || [] }] : [];
}

function portfolioAttention(data, project) {
  if (Array.isArray(project.attention)) return project.attention;
  if (!Array.isArray(data.attention)) return [];
  return data.attention.filter((entry) => !entry.projectId || entry.projectId === project.id);
}

function portfolioProjectElement(data, project) {
  const article = document.createElement('article'); article.className = `portfolio-project${project.id === data.activeProjectId ? ' active' : ''}`;
  const heading = document.createElement('div'); heading.className = 'portfolio-project-heading';
  const titleBlock = document.createElement('div');
  const title = document.createElement('h3'); title.textContent = project.name || project.id || 'Unbenanntes Projekt';
  const context = document.createElement('span'); context.textContent = project.id === data.activeProjectId ? 'Aktives Projekt' : 'Portfolio-Projekt';
  titleBlock.append(title, context);
  const state = document.createElement('span'); state.className = `project-state ${project.stateClass || 'attention'}`; state.textContent = project.state || 'Status unbekannt';
  heading.append(titleBlock, state);

  const next = document.createElement('div'); next.className = 'portfolio-next-action';
  const nextLabel = document.createElement('span'); nextLabel.textContent = 'Nächster Schritt';
  const nextValue = document.createElement('strong'); nextValue.textContent = project.nextAction || 'Projekt öffnen und Zustand prüfen';
  next.append(nextLabel, nextValue);

  const facts = document.createElement('dl'); facts.className = 'portfolio-facts';
  const latest = project.running
    ? `${project.running.provider || 'Job'} läuft · ${project.running.phase || 'gestartet'}`
    : project.lastTask || 'Noch kein Lauf gespeichert';
  const repository = project.repository
    ? `${project.repository.branch || 'kein Branch'} · ${project.repository.clean ? 'clean' : 'lokale Änderungen'}`
    : 'Repository-Zustand nicht geliefert';
  const knowledge = project.graph || project.obsidian
    ? `Graph ${project.graph?.status || 'unbekannt'} · ${project.obsidian?.notes ?? '—'} Obsidian-Notizen`
    : 'Wissenszustand nicht geliefert';
  for (const [label, value] of [
    ['Auftrag', project.currentTask || 'Kein aktueller Auftrag hinterlegt'],
    ['Letzter Lauf', latest], ['Repository', repository], ['Projektwissen', knowledge],
  ]) {
    const term = document.createElement('dt'); term.textContent = label;
    const description = document.createElement('dd'); description.textContent = value; facts.append(term, description);
  }

  const attention = document.createElement('div'); attention.className = 'attention-list';
  const entries = portfolioAttention(data, project);
  if (!entries.length) {
    const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Keine gemeldete Blockade oder ungeklärte Änderung.'; attention.append(empty);
  } else {
    for (const entry of entries) {
      const row = document.createElement('div'); row.className = `attention-item ${entry.severity === 'error' ? 'error' : ''}`;
      const marker = document.createElement('span'); marker.className = 'attention-marker'; marker.setAttribute('aria-hidden', 'true');
      const text = document.createElement('div'); text.className = 'attention-text'; text.textContent = entry.message;
      const open = document.createElement('button'); open.type = 'button'; open.className = 'button secondary table-button';
      open.dataset.portfolioProject = project.id; open.dataset.portfolioTarget = entry.target || 'tasks'; open.textContent = 'Öffnen';
      row.append(marker, text, open); attention.append(row);
    }
  }

  const actions = document.createElement('div'); actions.className = 'portfolio-actions';
  for (const [target, label, primary] of [['tasks', 'Arbeitsbereich', true], ['git', 'Git prüfen', false], ['knowledge', 'Wissen', false]]) {
    const button = document.createElement('button'); button.type = 'button'; button.className = `button ${primary ? 'primary' : 'secondary'}`;
    button.dataset.portfolioProject = project.id; button.dataset.portfolioTarget = target; button.textContent = label; actions.append(button);
  }
  article.append(heading, next, facts, attention, actions); return article;
}

function renderPortfolio(data) {
  const projects = portfolioRows(data);
  elements.portfolioSummary.textContent = projects.length === 1 ? '1 Projekt im Blick' : `${projects.length} Projekte im Blick`;
  elements.portfolioProjects.replaceChildren(...projects.map((project) => portfolioProjectElement(data, project)));
  if (!projects.length) {
    const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Die Portfolio-Antwort enthält noch keine Projekte.'; elements.portfolioProjects.append(empty);
  }
}

async function loadPortfolio() {
  if (!activeProject) return;
  const token = beginRequest('portfolio');
  elements.portfolioProjects.innerHTML = '<div class="empty">Projektzustände werden geprüft…</div>';
  try {
    const data = await api('/api/portfolio');
    if (requestIsCurrent(token)) renderPortfolio(data);
  } catch (error) {
    if (!requestIsCurrent(token)) return;
    elements.portfolioProjects.replaceChildren(); const message = document.createElement('div'); message.className = 'empty'; message.textContent = error.message; elements.portfolioProjects.append(message);
  }
}

function mcpMetric(label, value, detail) {
  const item = document.createElement('article'); item.className = 'mcp-metric';
  const name = document.createElement('span'); name.textContent = label;
  const number = document.createElement('strong'); number.textContent = String(value);
  const explanation = document.createElement('small'); explanation.textContent = detail;
  item.append(name, number, explanation);
  return item;
}

function appendMcpFact(list, label, value) {
  if (!value) return;
  const term = document.createElement('dt'); term.textContent = label;
  const description = document.createElement('dd'); description.textContent = value;
  list.append(term, description);
}

function renderMcpInventory(inventory) {
  const summary = inventory.summary || {};
  elements.mcpSummary.replaceChildren(
    mcpMetric('Aktiv konfiguriert', summary.active || 0, `${summary.configured || 0} Einträge erkannt`),
    mcpMetric('Lokal', summary.local || 0, 'STDIO auf diesem PC'),
    mcpMetric('Remote', summary.remote || 0, 'HTTP · Kosten prüfen'),
    mcpMetric('Projektbezogen', summary.project || 0, activeProject?.name || 'Aktuelles Projekt'),
  );
  elements.mcpServerList.replaceChildren();
  for (const server of inventory.servers || []) {
    const item = document.createElement('article'); item.className = 'mcp-server-card';
    const head = document.createElement('div'); head.className = 'mcp-server-head';
    const heading = document.createElement('div');
    const name = document.createElement('h3'); name.textContent = server.name;
    const badges = document.createElement('div'); badges.className = 'mcp-badges';
    for (const text of [server.client, server.scope === 'project' ? 'Projekt' : 'Global', server.transport === 'stdio' ? 'STDIO' : server.transport.toUpperCase()]) {
      const badge = document.createElement('span'); badge.textContent = text; badges.append(badge);
    }
    heading.append(name, badges);
    const state = document.createElement('span');
    state.className = `status ${server.health.state === 'not-checked' ? 'info' : server.health.state === 'inactive' ? 'warn' : 'fail'}`;
    state.textContent = server.status;
    head.append(heading, state);

    const target = document.createElement('div'); target.className = 'mcp-target';
    const targetLabel = document.createElement('span'); targetLabel.textContent = server.transport === 'http' ? 'Adresse' : 'Startbefehl';
    const targetValue = document.createElement('code'); targetValue.textContent = server.target;
    target.append(targetLabel, targetValue);

    const contract = document.createElement('details'); contract.className = 'mcp-contract';
    const contractSummary = document.createElement('summary'); contractSummary.textContent = 'Integrationsvertrag anzeigen';
    const facts = document.createElement('dl'); facts.className = 'mcp-facts';
    appendMcpFact(facts, 'Zustand', server.health.detail);
    appendMcpFact(facts, 'Rolle', server.role);
    appendMcpFact(facts, 'Aktivierung', server.activation);
    appendMcpFact(facts, 'Kosten', server.costPolicy);
    appendMcpFact(facts, 'Konfigurationsvariablen', server.environmentRefs?.length
      ? `Nur Namen sichtbar, keine Werte: ${server.environmentRefs.join(', ')}` : 'Keine Referenz auf Umgebungsvariablen oder Header erkannt.');
    const toolPolicy = [
      server.toolPolicy?.enabled?.length ? `erlaubt: ${server.toolPolicy.enabled.join(', ')}` : '',
      server.toolPolicy?.disabled?.length ? `gesperrt: ${server.toolPolicy.disabled.join(', ')}` : '',
      server.toolPolicy?.approvalMode ? `Freigabe: ${server.toolPolicy.approvalMode}` : '',
    ].filter(Boolean).join(' · ');
    appendMcpFact(facts, 'Werkzeugfilter', toolPolicy || 'Kein expliziter Werkzeugfilter konfiguriert.');
    const timeouts = [
      server.timeouts?.startupSeconds != null ? `Start ${server.timeouts.startupSeconds}s` : '',
      server.timeouts?.toolSeconds != null ? `Werkzeug ${server.timeouts.toolSeconds}s` : '',
    ].filter(Boolean).join(' · ');
    appendMcpFact(facts, 'Zeitlimits', timeouts);
    appendMcpFact(facts, 'Quelle', server.source);
    contract.append(contractSummary, facts);
    item.append(head, target, contract);
    elements.mcpServerList.append(item);
  }
  for (const error of inventory.errors || []) {
    const message = document.createElement('div'); message.className = 'mcp-config-error'; message.setAttribute('role', 'status');
    message.textContent = `${error.client} · ${error.source}: ${error.message}`; elements.mcpServerList.append(message);
  }
  if (!elements.mcpServerList.children.length) {
    const empty = document.createElement('div'); empty.className = 'empty mcp-empty';
    empty.innerHTML = '<strong>Keine MCP-Server konfiguriert.</strong><span>Geprüft werden die globalen Codex-/Claude-Konfigurationen und die Konfiguration des ausgewählten Projekts.</span>';
    elements.mcpServerList.append(empty);
  }
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
    if (system.updateStatus && system.updateStatus.status !== 'not-installed') {
      const update = document.createElement('div'); update.className = `system-update ${system.updateStatus.status}`;
      const current = system.updateStatus.currentVersion ? `Version ${system.updateStatus.currentVersion}` : 'Version unbekannt';
      if (system.updateStatus.status === 'available') update.textContent = `${current} · ${system.updateStatus.latestVersion} verfügbar`;
      else if (system.updateStatus.status === 'current') update.textContent = system.updateStatus.currentVersion ? `${current} · aktuell` : 'Kein Update verfügbar';
      else if (system.updateStatus.status === 'skipped') update.textContent = `${current} · Prüfung ausgesetzt`;
      else update.textContent = `${current} · Prüfung nicht verfügbar`;
      update.title = [system.updateStatus.source, system.updateStatus.detail].filter(Boolean).join(' · ');
      item.append(update);
    }
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
    if ((!system.ok && system.installKey) || system.updateStatus?.updateKey || !system.autoDetected) {
      const actions = document.createElement('div'); actions.className = 'system-actions';
      if (!system.ok && system.installKey) {
        const install = document.createElement('button'); install.type = 'button'; install.className = 'button secondary table-button';
        install.dataset.installSystem = system.installKey; install.dataset.installName = system.name; install.textContent = 'Installieren'; actions.append(install);
      }
      if (system.updateStatus?.updateKey) {
        const update = document.createElement('button'); update.type = 'button'; update.className = 'button secondary table-button';
        update.dataset.updateSystem = system.updateStatus.updateKey; update.dataset.updateName = system.name;
        update.dataset.currentVersion = system.updateStatus.currentVersion || ''; update.dataset.latestVersion = system.updateStatus.latestVersion || '';
        update.dataset.updateSource = system.updateStatus.source || 'offizielle Quelle'; update.textContent = 'Update'; actions.append(update);
      }
      if (!system.autoDetected) {
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button destructive table-button';
        remove.dataset.removeSystem = system.id; remove.textContent = 'Entfernen'; actions.append(remove);
      }
      item.append(actions);
    }
    container.append(item);
    }
  }
}

async function loadSystems(force = false, quiet = false) {
  if (!activeProject) return;
  const projectId = activeProject.id;
  const token = beginRequest('systems', projectId);
  const previousLabel = elements.systemsRefresh.textContent;
  elements.systemsRefresh.disabled = true; elements.systemsRefresh.setAttribute('aria-busy', 'true');
  if (force) elements.systemsRefresh.textContent = 'Liest neu…';
  elements.mcpServerList.innerHTML = '<div class="empty">MCP-Konfigurationen werden eingelesen…</div>';
  const mcpTask = api(`/api/mcp?projectId=${encodeURIComponent(projectId)}`).then((inventory) => {
    if (requestIsCurrent(token)) renderMcpInventory(inventory);
  }).catch((error) => {
    if (!requestIsCurrent(token)) return;
    elements.mcpSummary.replaceChildren(); elements.mcpServerList.replaceChildren();
    const message = document.createElement('div'); message.className = 'mcp-config-error'; message.textContent = `MCP-Konfigurationen konnten nicht gelesen werden: ${error.message}`;
    elements.mcpServerList.append(message);
  });
  const diagnosticsTask = api(`/api/systems?projectId=${encodeURIComponent(projectId)}${force ? '&force=1' : ''}`).then((inventory) => {
    if (!requestIsCurrent(token)) return;
    renderSystemRows(elements.projectSystems, inventory.project);
    renderSystemRows(elements.globalSystems, inventory.global, true);
    const requiredMissing = inventory.global.filter((system) => system.tier === 'required' && !system.ok).length;
    const recommendedMissing = inventory.global.filter((system) => system.tier === 'recommended' && !system.ok).length;
    const updateNote = inventory.updates.available
      ? ` <strong>${inventory.updates.available === 1 ? '1 Update' : `${inventory.updates.available} Updates`} verfügbar.</strong>`
      : inventory.updates.unavailable
        ? ` ${inventory.updates.unavailable} Updatequelle(n) waren nicht erreichbar.`
        : inventory.updates.checkedAt ? ' Alle unterstützten Updatequellen sind geprüft.' : '';
    elements.systemSetupSummary.innerHTML = (requiredMissing
      ? `<strong>${requiredMissing} notwendige Komponente(n) fehlen.</strong> Fehlende freigegebene Werkzeuge können direkt installiert werden.`
      : `<strong>Basis vollständig.</strong> ${recommendedMissing ? `${recommendedMissing} empfohlene Erweiterung(en) sind noch nicht eingerichtet.` : 'Der empfohlene lokale Workflow ist vollständig.'}`) + updateNote;
  }).catch((error) => { if (!quiet && requestIsCurrent(token)) elements.systemMessage.textContent = error.message; });
  await Promise.allSettled([mcpTask, diagnosticsTask]);
  if (requestIsCurrent(token)) {
    elements.systemsRefresh.disabled = false; elements.systemsRefresh.removeAttribute('aria-busy'); elements.systemsRefresh.textContent = previousLabel;
  }
}

function renderGitDelivery(data) {
  const isTaskBranch = !data.mainCheckout && data.branch && data.branch !== data.integration.branch && data.branch !== 'detached HEAD';
  const deliveryState = data.deliveryState || (data.clean ? 'clean' : 'changes-pending');
  const integrationState = data.integration.canFastForward ? ['ready', 'bereit']
    : data.integration.canCleanup || data.integration.alreadyIntegrated ? ['done', 'integriert']
      : data.integration.selectedIsIntegration ? ['done', 'Integrationsbranch'] : ['waiting', 'nicht bereit'];
  let pushState = ['unknown', data.remote ? 'nicht bestätigt' : 'kein Remote'];
  if (deliveryState === 'integrated-unpublished') pushState = ['ready', 'Integrationsbranch offen'];
  else if (data.remote && data.hasUpstream) pushState = data.ahead > 0 ? ['ready', `${data.ahead} ausstehend`] : data.behind > 0 ? ['blocked', `${data.behind} zurück`] : ['done', 'synchron'];
  else if (data.remote && data.clean && isTaskBranch) pushState = ['ready', 'Upstream offen'];
  const commitState = ['committed', 'integrated', 'integrated-unpublished'].includes(deliveryState)
    ? ['done', 'committed'] : deliveryState === 'changes-pending' ? ['ready', 'ausstehend'] : ['unknown', 'nicht ableitbar'];
  elements.gitDeliverySteps.replaceChildren(
    deliveryStep('Agent', isTaskBranch ? 'done' : 'unknown', isTaskBranch ? 'Aufgabenbranch vorhanden' : 'nicht ableitbar'),
    deliveryStep('Review', deliveryState === 'changes-pending' ? 'ready' : 'unknown', deliveryState === 'changes-pending' ? `${data.files.length} Datei(en) offen` : 'nicht bestätigt'),
    deliveryStep('Commit', commitState[0], commitState[1]),
    deliveryStep('Integration', integrationState[0], integrationState[1]),
    deliveryStep('Push', pushState[0], pushState[1]),
  );
}

function renderGitState(data) {
  requestState.invalidate('git');
  requestState.invalidate('gitDiff');
  gitData = data;
  if (!data.files.some((file) => file.path === selectedGitFile)) selectedGitFile = null;
  elements.gitProjectName.textContent = `${data.projectName} · ${data.worktreeKind}`;
  elements.gitBranchFlow.textContent = data.integration.branch === 'main' ? 'Aufgabe → main' : `Aufgabe → ${data.integration.branch} → main`;
  elements.gitTarget.replaceChildren();
  const cleanupBranches = new Set((data.cleanupCandidates || []).map((candidate) => candidate.branch));
  for (const target of data.targets) {
    const option = document.createElement('option'); option.value = target.path;
    const state = target.clean ? 'sauber' : `${target.changedCount} Änderung(en)`;
    const role = target.branch === data.integration.branch ? 'Integrationsbranch' : cleanupBranches.has(target.branch) ? 'Abgeschlossen · aufräumbar' : target.kind;
    option.textContent = `${role} · ${target.branch || 'ohne Branch'} · ${state}`;
    option.selected = target.path.toLowerCase() === data.worktree.toLowerCase();
    option.disabled = !target.available;
    elements.gitTarget.append(option);
  }
  elements.gitState.className = `status ${data.clean ? 'ok' : 'warn'}`;
  elements.gitState.textContent = data.clean ? 'clean' : `${data.files.length} Änderung(en)`;
  elements.gitSummary.replaceChildren();
  const draftKey = `${data.projectId}::${data.branch}`;
  if (draftKey !== visibleGitDraftKey) {
    visibleGitDraftKey = draftKey;
    visibleGitDraftValue = data.commitDraft || '';
    elements.gitCommitMessage.value = visibleGitDraftValue;
  } else if (document.activeElement !== elements.gitCommitMessage && elements.gitCommitMessage.value === visibleGitDraftValue && (data.commitDraft || '') !== visibleGitDraftValue) {
    visibleGitDraftValue = data.commitDraft || '';
    elements.gitCommitMessage.value = visibleGitDraftValue;
  }
  for (const text of [
    `Arbeitsordner: ${data.worktree}`,
    `Branch: ${data.branch || '—'}`,
    `Remote: ${data.remote || 'nicht konfiguriert'}`,
    data.hasUpstream ? `${data.ahead} voraus · ${data.behind} zurück` : 'kein Upstream',
    data.githubAuthenticated ? 'GitHub angemeldet' : 'GitHub nicht angemeldet',
    data.lastCommit ? `Letzter Commit: ${data.lastCommit.hash} · ${data.lastCommit.subject}` : 'Noch kein Commit',
  ]) { const item = document.createElement('span'); item.textContent = text; elements.gitSummary.append(item); }
  renderGitDelivery(data);
  elements.gitFileList.replaceChildren();
  if (!data.files.length) {
    const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Keine lokalen Änderungen.'; elements.gitFileList.append(empty);
  } else {
    for (const file of data.files) {
      const row = document.createElement('div'); row.className = `git-file-row${file.path === selectedGitFile ? ' active' : ''}`;
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = file.path; checkbox.checked = true;
      checkbox.setAttribute('aria-label', `Für Commit auswählen: ${file.path}`);
      const select = document.createElement('label'); select.className = 'git-file-select'; select.title = `Für Commit auswählen: ${file.path}`; select.append(checkbox);
      const view = document.createElement('button'); view.type = 'button'; view.className = 'git-file-view'; view.dataset.gitFile = file.path;
      view.setAttribute('aria-label', `Änderungen anzeigen: ${file.path}`);
      const status = document.createElement('span'); status.className = 'git-file-status'; status.textContent = file.untracked ? '??' : `${file.staged}${file.working}`;
      const name = document.createElement('span'); name.className = 'git-file-path'; name.textContent = file.originalPath ? `${file.originalPath} → ${file.path}` : file.path;
      view.append(status, name); row.append(select, view); elements.gitFileList.append(row);
    }
  }
  if (!selectedGitFile) {
    elements.gitImagePreview.classList.add('hidden'); elements.gitImagePreviewImage.removeAttribute('src'); elements.gitImagePreviewImage.alt = '';
    elements.gitDiffFileName.textContent = 'Keine Datei ausgewählt';
    elements.gitDiff.textContent = data.clean ? 'Keine lokalen Änderungen.' : 'Klicke auf eine Dateizeile, um ausschließlich deren Änderungen zu sehen.';
  }
  elements.gitCommit.disabled = data.clean;
  elements.gitCommitPush.disabled = data.clean || !data.remote;
  const canFinalizeTask = data.integration.canFastForward || data.integration.canCleanup;
  elements.gitIntegrate.disabled = !canFinalizeTask;
  elements.gitIntegrate.classList.toggle('hidden', !canFinalizeTask);
  elements.gitIntegrate.textContent = data.integration.canCleanup ? 'Aufgabenbranch aufräumen' : `In ${data.integration.branch} übernehmen`;
  elements.gitCleanupMerged.classList.toggle('hidden', !data.cleanupCandidates?.length);
  elements.gitCleanupMerged.disabled = !data.cleanupCandidates?.length;
  elements.gitCleanupMerged.textContent = data.cleanupCandidates?.length === 1 ? '1 abgeschlossene Aufgabe aufräumen'
    : data.cleanupCandidates?.length ? `${data.cleanupCandidates.length} abgeschlossene Aufgaben aufräumen` : 'Abgeschlossene Aufgaben aufräumen';
  elements.gitPush.disabled = !data.remote || !data.clean || (data.hasUpstream && data.ahead === 0);
  elements.gitPush.classList.toggle('hidden', elements.gitPush.disabled);
  elements.gitMessage.textContent = !data.clean ? 'Änderungen sind noch nicht committed. Prüfe und wähle zuerst die gewünschten Dateien aus.'
    : data.integration.canCleanup ? `Dieser saubere Aufgabenbranch ist bereits in ${data.integration.branch} enthalten und kann aufgeräumt werden.`
      : data.integration.canFastForward ? `Dieser Aufgabenbranch ist committed und kann in ${data.integration.branch} übernommen werden.` : '';
}

async function loadGitState(worktree = elements.gitTarget.value) {
  if (!activeProject) return;
  const projectId = activeProject.id;
  const token = beginRequest('git', projectId);
  elements.gitState.className = 'status warn'; elements.gitState.textContent = 'wird geprüft';
  elements.gitMessage.textContent = '';
  const target = worktree ? `&worktree=${encodeURIComponent(worktree)}` : '';
  try {
    const data = await api(`/api/git?${projectQuery(projectId)}${target}`);
    if (requestIsCurrent(token)) renderGitState(data);
  } catch (error) {
    if (!requestIsCurrent(token)) return;
    elements.gitState.className = 'status fail'; elements.gitState.textContent = 'Fehler'; elements.gitMessage.textContent = error.message;
  }
}

function queueCommitDraftSave(delay = 300) {
  if (!activeProject || !gitData?.worktree || !gitData?.branch) return;
  const key = `${activeProject.id}::${gitData.branch}`;
  const payload = { projectId: activeProject.id, worktree: gitData.worktree, message: elements.gitCommitMessage.value };
  clearTimeout(gitDraftSaveTimers.get(key));
  gitDraftSaveTimers.set(key, setTimeout(async () => {
    try {
      await api('/api/git/commit-draft', { method: 'POST', body: JSON.stringify(payload) });
      if (activeProject?.id === payload.projectId && key === visibleGitDraftKey) visibleGitDraftValue = payload.message.trim();
    }
    catch (error) { if (activeProject?.id === payload.projectId && key === visibleGitDraftKey) elements.gitMessage.textContent = `Commit-Entwurf konnte nicht gespeichert werden: ${error.message}`; }
    finally { gitDraftSaveTimers.delete(key); }
  }, delay));
}

async function loadGitFileDiff(filePath) {
  if (!activeProject || !gitData?.worktree) return;
  const projectId = activeProject.id; const worktree = gitData.worktree;
  const token = beginRequest('gitDiff', projectId);
  selectedGitFile = filePath;
  elements.gitFileList.querySelectorAll('.git-file-row').forEach((row) => row.classList.toggle('active', row.querySelector('[data-git-file]')?.dataset.gitFile === filePath));
  elements.gitDiffFileName.textContent = filePath; elements.gitDiff.textContent = 'Dateiänderungen werden geladen…';
  elements.gitImagePreview.classList.add('hidden'); elements.gitImagePreviewImage.removeAttribute('src'); elements.gitImagePreviewImage.alt = '';
  try {
    const result = await api(`/api/git/diff?${projectQuery(projectId)}&worktree=${encodeURIComponent(worktree)}&path=${encodeURIComponent(filePath)}`);
    if (!requestIsCurrent(token) || selectedGitFile !== filePath || gitData?.worktree !== worktree) return;
    elements.gitDiff.textContent = result.diff;
    if (result.imageUrl) {
      elements.gitImagePreviewImage.src = result.imageUrl; elements.gitImagePreviewImage.alt = `Vorschau von ${filePath}`;
      elements.gitImagePreviewCaption.textContent = `${filePath} · aktuelle Datei im ausgewählten Arbeitsstand`;
      elements.gitImagePreview.classList.remove('hidden');
    }
    elements.gitMessage.textContent = result.truncated ? 'Die Dateiansicht wurde bei 400.000 Zeichen gekürzt.' : result.binary && !result.imageUrl ? 'Für diese Binärdatei ist keine Vorschau verfügbar.' : '';
  } catch (error) { if (requestIsCurrent(token) && selectedGitFile === filePath && gitData?.worktree === worktree) elements.gitDiff.textContent = error.message; }
}

async function activateProject(projectId) {
  const target = registry.projects.find((project) => project.id === projectId);
  const visibleView = visibleViewName();
  storeComposerDraft();
  invalidateProjectRequests();
  activeModelCatalogToken = null; modelCatalogLoading = false; providerStatus = null; providerStatusErrorMessage = ''; elements.refreshModels.removeAttribute('aria-busy');
  setBusy(true, 'Projekt wird gewechselt', `${target?.name || 'Projekt'} und seine lokalen Verbindungen werden geprüft.`);
  try {
    await api(`/api/projects/${encodeURIComponent(projectId)}/select`, { method: 'POST', body: '{}' });
    registry = await api('/api/projects');
    activeProject = registry.projects.find((project) => project.id === registry.activeProjectId);
    loadExecutionPreferences();
    graphData = null; selectedGraphNodeId = null; graphZoom = 1; graphPanX = 0; graphPanY = 0; gitData = null; selectedGitFile = null; visibleGitDraftKey = null; visibleGitDraftValue = null; elements.gitCommitMessage.value = ''; runHistory = []; historyFollow = true; historyLatestVersion = null; elements.gitTarget.replaceChildren();
    elements.gitFileList.replaceChildren(); elements.gitDiffFileName.textContent = 'Projekt wird gewechselt'; elements.gitDiff.textContent = 'Der Git-Zustand des neuen Projekts wird geladen.';
    elements.gitImagePreview.classList.add('hidden'); elements.gitImagePreviewImage.removeAttribute('src');
    elements.gitCommit.disabled = true; elements.gitCommitPush.disabled = true; elements.gitIntegrate.disabled = true; elements.gitPush.disabled = true;
    elements.systemsRefresh.disabled = false; elements.systemsRefresh.textContent = 'Neu prüfen';
    renderProjectSelector(); restoreComposerDraft(activeProject.id); resetKnowledge(); renderConversation();
    await refreshAll(true);
    if (visibleView === 'portfolio') await loadPortfolio();
    else if (visibleView === 'workflow') await loadWorkflow(true);
    else if (visibleView === 'knowledge') await loadActiveKnowledge();
    else if (visibleView === 'git') await loadGitState();
    else if (visibleView === 'systems') await loadSystems();
    else void loadSystems(false, true);
  } finally { setBusy(false); }
}

function resetKnowledge() {
  elements.graphStats.textContent = '';
  elements.graphDetails.innerHTML = '<p class="empty">Wähle einen Knoten im Graphen oder in der Liste.</p>';
  elements.graphNodeList.replaceChildren();
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
  const selectedNeighbors = new Set(linkedGraphNodeIds(graphData.links, selectedGraphNodeId));
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
  const relatedIds = new Set(node ? linkedGraphNodeIds(graphData.links, node.id) : []);
  elements.graphNodeList.querySelectorAll('[data-graph-node]').forEach((button) => {
    const selected = button.dataset.graphNode === nodeId; const related = !selected && relatedIds.has(button.dataset.graphNode);
    button.classList.toggle('active', selected); button.classList.toggle('related', related);
    if (selected) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
    const relation = button.querySelector('[data-graph-relation]');
    if (relation) { relation.hidden = !(selected || related); relation.textContent = selected ? 'Ausgewählt' : related ? 'Direkt verbunden' : ''; }
  });
  if (!node) { elements.graphDetails.innerHTML = '<p class="empty">Wähle einen Knoten im Graphen oder in der Liste.</p>'; drawGraph(); return; }
  const title = document.createElement('h3'); title.textContent = node.label; const list = document.createElement('dl');
  for (const [label, value] of [['Typ', node.type || '—'], ['Community', node.community || '—'], ['Quelle', `${node.sourceFile || '—'}${node.sourceLocation ? ` · ${node.sourceLocation}` : ''}`], ['Verbindungen', String(node.degree)]]) {
    const term = document.createElement('dt'); term.textContent = label; const detail = document.createElement('dd'); detail.textContent = value; list.append(term, detail);
  }
  const neighbors = [...relatedIds].map((id) => graphData.nodes.find((candidate) => candidate.id === id)).filter(Boolean).slice(0, 12);
  if (neighbors.length) {
    const term = document.createElement('dt'); term.textContent = 'Direkte Zusammenhänge'; const detail = document.createElement('dd');
    const items = document.createElement('ul'); items.className = 'neighbor-list';
    for (const neighbor of neighbors) {
      const item = document.createElement('li'); const button = document.createElement('button');
      button.type = 'button'; button.className = 'neighbor-button'; button.dataset.graphNeighbor = neighbor.id;
      const label = document.createElement('span'); label.textContent = neighbor.label;
      const meta = document.createElement('small'); meta.textContent = `${neighbor.degree || 0} Verbindungen`;
      button.append(label, meta); item.append(button); items.append(item);
    }
    detail.append(items); list.append(term, detail);
  }
  elements.graphDetails.append(title, list); drawGraph();
}

function selectGraphNode(nodeId, { center = false, revealList = false, focusList = false } = {}) {
  if (center) {
    const position = graphPositions.get(nodeId); const rect = elements.graphCanvas.getBoundingClientRect();
    const centered = centeredGraphPan({ position, width: rect.width, height: rect.height, panX: graphPanX, panY: graphPanY });
    graphPanX = centered.panX; graphPanY = centered.panY;
  }
  renderGraphDetails(nodeId);
  if (!revealList && !focusList) return;
  const button = [...elements.graphNodeList.querySelectorAll('[data-graph-node]')].find((candidate) => candidate.dataset.graphNode === nodeId);
  if (!button) return;
  button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (focusList) button.focus({ preventScroll: true });
}

function renderGraphNodeList() {
  elements.graphNodeList.replaceChildren();
  if (!graphData?.nodes?.length) {
    const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Keine Knoten in dieser Ansicht.'; elements.graphNodeList.append(empty); return;
  }
  const nodes = [...graphData.nodes].sort((left, right) => (right.degree || 0) - (left.degree || 0) || String(left.label).localeCompare(String(right.label), 'de'));
  for (const node of nodes) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'graph-node-button'; button.dataset.graphNode = node.id;
    const label = document.createElement('span'); label.textContent = node.label;
    const meta = document.createElement('small'); meta.textContent = `${node.type || node.community || 'Knoten'} · ${node.degree || 0} Verbindungen`;
    const relation = document.createElement('small'); relation.className = 'graph-node-relation'; relation.dataset.graphRelation = ''; relation.hidden = true;
    button.append(label, meta, relation); elements.graphNodeList.append(button);
  }
}

async function loadGraph(parentToken = null) {
  const projectId = activeProject?.id;
  if (!projectId) return false;
  const token = beginRequest('graph', projectId);
  elements.graphStats.textContent = 'Graph wird geladen…';
  try {
    const query = elements.knowledgeSearch.value.trim();
    const data = await api(`/api/graph?${projectQuery(projectId)}&q=${encodeURIComponent(query)}`);
    if (!requestIsCurrent(token) || (parentToken && !requestIsCurrent(parentToken))) return false;
    graphData = data;
    selectedGraphNodeId = null; graphZoom = 1; graphPanX = 0; graphPanY = 0;
    elements.graphStats.textContent = `${graphData.totals.nodes} Knoten · ${graphData.totals.links} Beziehungen${graphData.truncated ? ' · fokussierte Ansicht' : ''}${graphData.builtAtCommit ? ` · Commit ${graphData.builtAtCommit.slice(0, 8)}` : ''}`;
    renderGraphNodeList(); renderGraphDetails(null); drawGraph(); return true;
  } catch (error) {
    if (!requestIsCurrent(token) || (parentToken && !requestIsCurrent(parentToken))) return false;
    graphData = null; elements.graphStats.textContent = error.message; drawGraph();
    elements.graphNodeList.replaceChildren(); return false;
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

async function loadObsidian(selectedFile = null, parentToken = null) {
  const projectId = activeProject?.id;
  if (!projectId) return false;
  const token = beginRequest('obsidian', projectId);
  elements.obsidianStats.textContent = 'Notizen werden geladen…';
  try {
    const query = elements.knowledgeSearch.value.trim();
    const filePart = selectedFile ? `&file=${encodeURIComponent(selectedFile)}` : '';
    const data = await api(`/api/obsidian?${projectQuery(projectId)}&q=${encodeURIComponent(query)}${filePart}`);
    if (!requestIsCurrent(token) || (parentToken && !requestIsCurrent(parentToken))) return false;
    renderNoteList(data);
    if (data.note) {
      elements.noteTitle.textContent = data.note.path; elements.noteContent.textContent = data.note.content;
      document.querySelectorAll('.note-button').forEach((button) => button.classList.toggle('active', button.dataset.notePath === data.note.path));
    }
    return true;
  } catch (error) {
    if (!requestIsCurrent(token) || (parentToken && !requestIsCurrent(parentToken))) return false;
    elements.obsidianStats.textContent = error.message; elements.noteList.replaceChildren(); return false;
  }
}

async function loadActiveKnowledge() {
  if (!activeProject) return;
  const token = beginRequest('knowledge', activeProject.id);
  elements.knowledgeLoadState.textContent = 'Wissen wird automatisch geladen…';
  await Promise.all([loadGraph(token), loadObsidian(null, token)]);
  if (requestIsCurrent(token)) elements.knowledgeLoadState.textContent = 'Graph und Notizen aktuell';
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
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button icon-only destructive attachment-remove';
    remove.dataset.removeAttachment = String(index); remove.textContent = '×'; remove.setAttribute('aria-label', `${attachment.name} entfernen`);
    chip.append(image, name, remove); elements.attachmentPreview.append(chip);
  });
}

function clearAttachments(persist = true) {
  selectedAttachments = []; elements.attachmentInput.value = ''; renderAttachmentPreview();
  if (persist) storeComposerDraft();
}

async function addImageFiles(files, projectId = activeProject?.id) {
  if (!projectId) return;
  const allowed = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  const draft = projectUiState.loadComposer(projectId);
  const existing = activeProject?.id === projectId ? selectedAttachments : draft.attachments;
  if (existing.length + files.length > 4) throw new Error('Maximal vier Bilder pro Nachricht.');
  if ([...existing, ...files].reduce((total, file) => total + Number(file.size || 0), 0) > 15 * 1024 * 1024) throw new Error('Bilder dürfen zusammen höchstens 15 MB groß sein.');
  const nextAttachments = [...existing];
  for (const file of files) {
    if (!allowed.has(file.type)) throw new Error(`${file.name || 'Bild'}: nicht unterstütztes Bildformat.`);
    if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name || 'Bild'}: größer als 5 MB.`);
    const fallbackName = `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.${file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1]}`;
    nextAttachments.push({ name: file.name || fallbackName, type: file.type, size: file.size, dataUrl: await readFileDataUrl(file) });
  }
  const text = activeProject?.id === projectId ? elements.task.value : draft.text;
  projectUiState.saveComposer(projectId, text, nextAttachments);
  if (activeProject?.id === projectId) {
    selectedAttachments = nextAttachments;
    elements.formMessage.textContent = selectedAttachments.length ? `${selectedAttachments.length} Bild(er) angehängt.` : '';
    renderAttachmentPreview();
  }
}

function appendInlineFormatting(target, value) {
  const text = String(value || '');
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) target.append(document.createTextNode(text.slice(cursor, match.index)));
    if (match[0].startsWith('**')) {
      const strong = document.createElement('strong'); strong.textContent = match[0].slice(2, -2); target.append(strong);
    } else {
      const code = document.createElement('code'); code.textContent = match[0].slice(1, -1); target.append(code);
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) target.append(document.createTextNode(text.slice(cursor)));
}

function renderMessageText(target, value) {
  const lines = String(value || 'Keine gespeicherte Ausgabe.').split(/\r?\n/);
  let paragraph = [];
  let list = null;
  let codeLines = null;
  const flushParagraph = () => {
    if (!paragraph.length) return;
    const node = document.createElement('p');
    paragraph.forEach((line, index) => { if (index) node.append(document.createElement('br')); appendInlineFormatting(node, line); });
    target.append(node); paragraph = [];
  };
  const closeList = () => { list = null; };
  for (const line of lines) {
    if (line.startsWith('```')) {
      flushParagraph(); closeList();
      if (codeLines === null) codeLines = [];
      else {
        const pre = document.createElement('pre'); const code = document.createElement('code'); code.textContent = codeLines.join('\n'); pre.append(code); target.append(pre); codeLines = null;
      }
      continue;
    }
    if (codeLines !== null) { codeLines.push(line); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (heading) {
      flushParagraph(); closeList(); const node = document.createElement(`h${Math.min(4, heading[1].length + 2)}`); appendInlineFormatting(node, heading[2]); target.append(node); continue;
    }
    if (unordered || ordered) {
      flushParagraph(); const tag = ordered ? 'ol' : 'ul';
      if (!list || list.tagName.toLowerCase() !== tag) { list = document.createElement(tag); target.append(list); }
      const item = document.createElement('li'); appendInlineFormatting(item, (unordered || ordered)[1]); list.append(item); continue;
    }
    if (!line.trim()) { flushParagraph(); closeList(); continue; }
    closeList(); paragraph.push(line);
  }
  if (codeLines !== null) { const pre = document.createElement('pre'); const code = document.createElement('code'); code.textContent = codeLines.join('\n'); pre.append(code); target.append(pre); }
  flushParagraph();
}

function messageElement(role, label, text, attachments = []) {
  const message = document.createElement('div'); message.className = `message ${role}`;
  const heading = document.createElement('div'); heading.className = 'message-label'; heading.textContent = label;
  const body = document.createElement('div'); body.className = 'message-body'; renderMessageText(body, text);
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

function runConversationElement(run) {
  const article = document.createElement('article'); article.className = 'conversation-run';
  const meta = document.createElement('div'); meta.className = 'conversation-meta';
  const runProvider = run.provider || 'externer Lauf';
  const runIdentity = run.model ? `${runProvider} · ${run.model === 'default' ? 'Provider-Standard' : run.model}` : runProvider;
  const identity = document.createElement('span'); identity.textContent = `${formatTime(run.modifiedAt)} · ${runIdentity}`;
  const presentation = runStatusPresentation(run.status);
  const state = document.createElement('span'); state.className = `status ${presentation.className}`; state.textContent = presentation.label;
  meta.append(identity, state); article.append(meta);
  if (run.task) article.append(messageElement('user', 'Du', run.task, run.attachments || []));
  article.append(messageElement('assistant', runIdentity || 'AI Project Control', run.response || presentation.fallback));
  const summary = document.createElement('div'); summary.className = 'run-summary';
  const statusHint = run.status === 'external' ? 'Kein aktiver Job zugeordnet' : null;
  for (const value of [run.mode, run.tests, run.filesChanged, run.gate, statusHint].filter(Boolean)) {
    const chip = document.createElement('span'); chip.textContent = value; summary.append(chip);
  }
  if (summary.childElementCount) article.append(summary);
  const delivery = executionDeliveryElement(run.mode, run.status);
  if (delivery) article.append(delivery);
  article.dataset.version = `${run.modifiedAt}:${run.status}:${String(run.response || '').length}`;
  return article;
}

function captureHistorySelection() {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!elements.history.contains(range.commonAncestorContainer)) return null;
  const offsetFor = (node, offset) => {
    const probe = document.createRange(); probe.selectNodeContents(elements.history); probe.setEnd(node, offset); return probe.toString().length;
  };
  return { start: offsetFor(range.startContainer, range.startOffset), end: offsetFor(range.endContainer, range.endOffset) };
}

function restoreHistorySelection(saved) {
  if (!saved) return;
  const locate = (target) => {
    const walker = document.createTreeWalker(elements.history, NodeFilter.SHOW_TEXT); let consumed = 0; let node;
    while ((node = walker.nextNode())) {
      const next = consumed + node.data.length;
      if (target <= next) return { node, offset: Math.max(0, target - consumed) };
      consumed = next;
    }
    return null;
  };
  const start = locate(saved.start); const end = locate(saved.end);
  if (!start || !end) return;
  const range = document.createRange(); range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset);
  const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
}

function historyScrollAnchor() {
  const top = elements.history.scrollTop;
  const node = [...elements.history.children].find((child) => child.offsetTop + child.offsetHeight >= top);
  return node?.dataset.conversationKey ? { key: node.dataset.conversationKey, offset: node.offsetTop - top } : null;
}

function updateRunConversationElement(article, run) {
  const version = `${run.modifiedAt}:${run.status}:${String(run.response || '').length}`;
  if (article.dataset.version === version) return;
  const replacement = runConversationElement(run);
  article.className = replacement.className; article.replaceChildren(...replacement.childNodes); article.dataset.version = version;
}

function renderConversation() {
  const hadContent = elements.history.childElementCount > 0;
  const previousTop = elements.history.scrollTop;
  const anchor = historyScrollAnchor();
  const selection = captureHistorySelection();
  const shouldFollow = !hadContent || historyFollow;
  const reconciled = reconcileConversationSources(runHistory, visibleLiveJobs());
  const entries = [
    ...reconciled.runs.map((run) => ({ type: 'run', time: run.modifiedAt, value: run })),
    ...reconciled.jobs.map((job) => ({ type: 'job', time: job.createdAt || job.startedAt, value: job })),
  ].sort((left, right) => String(left.time).localeCompare(String(right.time)));
  const nextVersion = entries.map((entry) => entry.type === 'run'
    ? `${entry.value.name}:${entry.value.modifiedAt}`
    : `${entry.value.id}:${entry.value.kind}:${entry.value.status}:${entry.value.phase || ''}:${entry.value.updatedAt || ''}:${entry.value.deliveryState || ''}:${String(entry.value.stdout || '').length}:${String(entry.value.stderr || '').length}`).join('|');
  const hasNewContent = Boolean(historyLatestVersion && nextVersion && historyLatestVersion !== nextVersion);
  const desired = [];
  if (!entries.length) {
    const key = `empty:${activeProject?.id || 'none'}`;
    let empty = conversationNodes.get(key);
    if (!empty) { empty = document.createElement('div'); empty.className = 'empty chat-empty'; empty.textContent = 'Noch kein Gespräch für dieses Projekt.'; conversationNodes.set(key, empty); }
    empty.dataset.conversationKey = key; desired.push(empty);
  } else {
    for (const entry of entries) {
      const key = entry.type === 'run' ? `run:${entry.value.path || entry.value.name}` : `job:${entry.value.id}`;
      let node = conversationNodes.get(key);
      if (!node) {
        node = entry.type === 'run' ? runConversationElement(entry.value) : jobConversationElement(entry.value);
        conversationNodes.set(key, node);
      } else if (entry.type === 'run') updateRunConversationElement(node, entry.value);
      else updateJobConversationElement(node, entry.value);
      node.dataset.conversationKey = key; desired.push(node);
    }
  }
  const desiredSet = new Set(desired);
  for (const [key, node] of conversationNodes) {
    if (!desiredSet.has(node)) { node.remove(); conversationNodes.delete(key); }
  }
  desired.forEach((node, index) => {
    const current = elements.history.children[index]; if (current !== node) elements.history.insertBefore(node, current || null);
  });
  restoreHistorySelection(selection);
  requestAnimationFrame(() => {
    if (shouldFollow) { elements.history.scrollTop = elements.history.scrollHeight; elements.historyJumpLatest.classList.add('hidden'); }
    else {
      const anchorNode = anchor ? conversationNodes.get(anchor.key) : null;
      elements.history.scrollTop = anchorNode?.isConnected ? anchorNode.offsetTop - anchor.offset : previousTop;
      elements.historyJumpLatest.classList.toggle('hidden', !hasNewContent);
    }
    historyFollow = shouldFollow;
  });
  historyLatestVersion = nextVersion;
}

function renderHistory(runs) {
  runHistory = runs;
  renderConversation();
}

async function refreshStatus(force = false, updateConnection = false) {
  if (!activeProject) return;
  const projectId = activeProject.id;
  const token = beginRequest('status', projectId);
  const statusQuery = new URLSearchParams();
  if (force) statusQuery.set('force', '1');
  const ollamaModel = providerModelSelect('Ollama')?.value;
  if (ollamaModel) statusQuery.set('ollamaModel', ollamaModel);
  try {
    const statusSuffix = statusQuery.toString();
    const [status, components] = await Promise.all([
      api(`/api/status${statusSuffix ? `?${statusSuffix}` : ''}`),
      api(`/api/components?${projectQuery(projectId)}${force ? '&force=1' : ''}`),
    ]);
    if (requestIsCurrent(token)) {
      providerStatusErrorMessage = '';
      renderProviders(status); renderComponents(components); renderModelCatalogState(); renderExecutionControls(false);
      if (updateConnection) {
        elements.connection.className = 'connection ok';
        elements.connection.textContent = 'Lokal verbunden';
      }
    }
  } catch (error) {
    if (requestIsCurrent(token)) {
      providerStatus = null;
      providerStatusErrorMessage = `Providerstatus konnte nicht aktualisiert werden: ${error.message} Prüfe den lokalen Dienst oder aktualisiere die Modelle erneut.`;
      renderModelCatalogState(); renderExecutionControls(false);
      if (updateConnection) {
        elements.connection.className = 'connection error';
        elements.connection.textContent = `Providerstatus nicht verfügbar: ${error.message}`;
      }
    }
    throw error;
  }
}

async function refreshStatusSafely(force = false) {
  try { await refreshStatus(force, true); }
  catch { /* refreshStatus renders failures only while its request is current. */ }
}

async function refreshJobs() {
  if (!activeProject) return;
  const projectId = activeProject.id;
  const token = beginRequest('jobs', projectId);
  const rows = await api(`/api/jobs?${projectQuery(projectId)}`);
  if (!requestIsCurrent(token)) return;
  for (const row of rows) {
    if (row.kind === 'provision' && !row.projectId && !projectUiState.jobOrigin(row.id)) projectUiState.setJobOrigin(row.id, projectId);
  }
  for (const row of rows) liveJobs.set(row.id, row);
  renderConversation();
  renderJobActivity();
  renderExecutionControls(false);
  if (componentStatus) renderComponents(componentStatus);
  const latestTask = visibleLiveJobs().findLast((job) => job.kind === 'task');
  if (latestTask?.status === 'failed') elements.formMessage.textContent = 'Letzte Aufgabe fehlgeschlagen. Details stehen direkt im Gespräch.';
  else if (latestTask?.status === 'blocked') elements.formMessage.textContent = 'Letzte Aufgabe wurde kontrolliert blockiert. Die Begründung steht direkt im Gespräch.';
  else if (latestTask?.status === 'completed') elements.formMessage.textContent = 'Letzter Job abgeschlossen.';
  else if (latestTask?.status === 'stopped') elements.formMessage.textContent = 'Letzter Job wurde gestoppt.';
  if (rows.some((job) => job.status === 'completed' && job.projectId && !registry.projects.some((project) => project.id === job.projectId))) {
    await refreshProjectRegistry();
  }
}

async function refreshProjectRegistry() {
  if (!activeProject) return;
  const projectId = activeProject.id;
  const token = beginRequest('registry', projectId);
  const nextRegistry = await api('/api/projects');
  if (!requestIsCurrent(token)) return;
  registry = nextRegistry;
  activeProject = registry.projects.find((project) => project.id === projectId)
    || registry.projects.find((project) => project.id === registry.activeProjectId)
    || registry.projects[0];
  renderProjectSelector();
}

async function refreshHistory() {
  if (!activeProject) return;
  const projectId = activeProject.id;
  const token = beginRequest('history', projectId);
  const runs = await api(`/api/runs?${projectQuery(projectId)}`);
  if (requestIsCurrent(token)) renderHistory(runs);
}

async function refreshAll(force = false) {
  if (!activeProject) return;
  const token = beginRequest('refreshAll', activeProject.id);
  try {
    await Promise.all([refreshStatus(force), refreshJobs(), refreshHistory()]);
    if (requestIsCurrent(token)) { elements.connection.className = 'connection ok'; elements.connection.textContent = 'Lokal verbunden'; }
  } catch (error) {
    if (requestIsCurrent(token)) { elements.connection.className = 'connection error'; elements.connection.textContent = error.message; }
  }
}

async function initialize() {
  try {
    [config, registry] = await Promise.all([api('/api/config'), api('/api/projects')]);
    if (config.apiContractVersion !== API_CONTRACT_VERSION || config.modelCatalog?.version !== MODEL_CATALOG_VERSION) {
      throw new Error('Dashboard-Dienst und Oberfläche haben unterschiedliche Versionen. Starte das Dashboard neu; Aufgaben bleiben bis dahin deaktiviert.');
    }
    modelCatalogReady = true;
    activeProject = registry.projects.find((project) => project.id === registry.activeProjectId) || registry.projects[0];
    elements.provisionParent.value = config.defaultProjectParent;
    loadExecutionPreferences(); renderProjectSelector(); restoreComposerDraft(activeProject.id); connectJobEvents(); await refreshAll(true); void loadSystems(false, true);
  } catch (error) {
    modelCatalogReady = false; renderExecutionControls(false);
    elements.connection.className = 'connection error'; elements.connection.textContent = error.message;
    renderModelCatalogState(error.message);
  }
}

document.querySelector('.view-tabs').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-view]'); if (button) showView(button.dataset.view);
});
document.querySelector('.view-tabs').addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...document.querySelectorAll('.view-tabs [role="tab"]')];
  const current = tabs.indexOf(document.activeElement); if (current < 0) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
    : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus(); showView(tabs[next].dataset.view);
});

elements.systemsRefresh.addEventListener('click', () => loadSystems(true));
elements.workflowRefresh.addEventListener('click', () => loadWorkflow(true));
elements.addProject.addEventListener('click', () => { showView('projects'); elements.provisionName.focus(); });
elements.projectSelect.addEventListener('change', () => activateProject(elements.projectSelect.value));
elements.backgroundActivity.addEventListener('click', async () => {
  const { jobId, projectId } = elements.backgroundActivity.dataset;
  if (!projectId) return;
  if (jobId) { acknowledgedActivityJobs.add(jobId); sessionStorage.setItem('acknowledgedActivityJobs', JSON.stringify([...acknowledgedActivityJobs])); }
  if (projectId !== activeProject?.id) await activateProject(projectId);
  showView('tasks'); renderJobActivity();
});
elements.providerPreset.addEventListener('change', (event) => {
  const radio = event.target.closest('input[name="providerPreset"]');
  if (radio) { applyProviderPreset(radio.value, true, radio.value === 'custom'); scheduleWorkflowRefresh(); }
});
elements.modelProfile.addEventListener('change', () => {
  applyModelProfile(elements.modelProfile.value);
  if (providerStatus) providerStatus = { ...providerStatus, ollama: null };
  renderExecutionControls(false); void refreshStatusSafely(true);
});
elements.providerRoute.addEventListener('change', (event) => {
  const modelSelect = event.target.closest('select[data-provider-model]');
  if (modelSelect) {
    elements.modelProfile.value = 'custom'; updateModelProfileHint(); updateProviderModelState(modelSelect.dataset.providerModel);
    modelRecoveryMessage = ''; renderModelCatalogState();
    if (modelSelect.dataset.providerModel === 'Ollama' && providerStatus) providerStatus = { ...providerStatus, ollama: null };
  }
  renderExecutionControls();
  scheduleWorkflowRefresh();
  if (modelSelect?.dataset.providerModel === 'Ollama') void refreshStatusSafely(true);
});
elements.primaryProvider.addEventListener('change', () => { makeProviderPrimary(elements.primaryProvider.value); renderExecutionControls(); scheduleWorkflowRefresh(); });
elements.refreshModels.addEventListener('click', async () => {
  const projectId = activeProject?.id;
  if (!projectId) return;
  const token = beginRequest('modelCatalog', projectId);
  activeModelCatalogToken = token;
  const selected = selectedProviderModels();
  const profileId = selectedModelProfile();
  modelCatalogLoading = true; renderExecutionControls(false);
  elements.refreshModels.setAttribute('aria-busy', 'true');
  renderModelCatalogState('wird aktualisiert…');
  try {
    const refreshed = await api('/api/config?force=1');
    if (!requestIsCurrent(token)) return;
    if (refreshed.apiContractVersion !== API_CONTRACT_VERSION || refreshed.modelCatalog?.version !== MODEL_CATALOG_VERSION) {
      throw new Error('Der laufende Dashboard-Dienst ist nicht mit dieser Oberfläche kompatibel. Starte das Dashboard neu.');
    }
    config = { ...config, ...refreshed };
    populateModelProfiles(profileId);
    const recovery = [];
    for (const provider of PROVIDERS) {
      const requested = profileId === 'custom' ? selected[provider] : modelProfile(config, profileId)?.modelIds?.[provider];
      const selection = populateProviderModel(provider, requested);
      if (selection.message) recovery.push(selection.message);
    }
    modelRecoveryMessage = recovery.join(' ');
    renderModelCatalogState();
    updateModelProfileHint();
    await refreshStatus(true);
  } catch (error) { if (requestIsCurrent(token)) renderModelCatalogState(`Fehler: ${error.message}`); }
  finally {
    if (activeModelCatalogToken === token) {
      activeModelCatalogToken = null; modelCatalogLoading = false; elements.refreshModels.removeAttribute('aria-busy');
      renderExecutionControls(requestIsCurrent(token));
    }
  }
});
elements.mode.addEventListener('change', () => { renderExecutionControls(); scheduleWorkflowRefresh(); });
elements.useSubscriptionTokens.addEventListener('change', () => { renderExecutionControls(); scheduleWorkflowRefresh(); });
elements.task.addEventListener('input', () => { if (componentStatus) renderComponents(componentStatus); scheduleWorkflowRefresh(500); });

elements.attachmentButton.addEventListener('click', () => elements.attachmentInput.click());
elements.attachmentInput.addEventListener('change', async () => {
  const files = Array.from(elements.attachmentInput.files || []);
  const projectId = activeProject?.id;
  try { await addImageFiles(files, projectId); }
  catch (error) { elements.formMessage.textContent = error.message; }
  finally { elements.attachmentInput.value = ''; }
});

elements.task.addEventListener('paste', async (event) => {
  const files = Array.from(event.clipboardData?.items || []).filter((item) => item.kind === 'file' && item.type.startsWith('image/')).map((item) => item.getAsFile()).filter(Boolean);
  if (!files.length) return;
  event.preventDefault();
  const projectId = activeProject?.id;
  try { await addImageFiles(files, projectId); }
  catch (error) { elements.formMessage.textContent = error.message; }
});

elements.attachmentPreview.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-remove-attachment]'); if (!button) return;
  selectedAttachments.splice(Number(button.dataset.removeAttachment), 1); renderAttachmentPreview();
  elements.formMessage.textContent = selectedAttachments.length ? `${selectedAttachments.length} Bild(er) angehängt.` : '';
  storeComposerDraft();
});

elements.task.addEventListener('input', () => {
  elements.task.style.height = 'auto'; elements.task.style.height = `${Math.min(elements.task.scrollHeight, 180)}px`;
  storeComposerDraft();
});

elements.history.addEventListener('scroll', () => {
  historyFollow = elements.history.scrollHeight - elements.history.scrollTop - elements.history.clientHeight < 32;
  if (historyFollow) elements.historyJumpLatest.classList.add('hidden');
});
elements.historyJumpLatest.addEventListener('click', () => {
  historyFollow = true; elements.history.scrollTop = elements.history.scrollHeight; elements.historyJumpLatest.classList.add('hidden');
});

elements.memoryForm.addEventListener('submit', async (event) => {
  event.preventDefault(); elements.memoryMessage.textContent = 'Lernnotiz wird gespeichert…';
  const projectId = activeProject.id; const token = beginRequest('memoryMutation', projectId);
  try {
    await api('/api/memory', { method: 'POST', body: JSON.stringify({ projectId, text: elements.memoryText.value }) });
    if (!requestIsCurrent(token)) return;
    elements.memoryText.value = ''; elements.memoryMessage.textContent = 'Für künftige Aufgaben gespeichert.';
  } catch (error) { if (requestIsCurrent(token)) elements.memoryMessage.textContent = error.message; }
});

elements.systemForm.addEventListener('submit', async (event) => {
  event.preventDefault(); elements.systemMessage.textContent = 'System wird registriert…';
  const projectId = activeProject.id; const token = beginRequest('systemMutation', projectId);
  try {
    await api('/api/systems', { method: 'POST', body: JSON.stringify({
      name: elements.systemName.value, type: elements.systemType.value, path: elements.systemPath.value,
      scope: elements.systemScope.value, projectId, note: elements.systemNote.value,
    }) });
    if (!requestIsCurrent(token)) return;
    elements.systemForm.reset(); elements.systemMessage.textContent = 'System wurde registriert.'; await loadSystems(true);
  } catch (error) { if (requestIsCurrent(token)) elements.systemMessage.textContent = error.message; }
});

elements.provisionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const projectId = activeProject.id;
  const token = beginRequest('provisionMutation', projectId);
  const githubText = elements.provisionGitHub.checked ? ` und als ${elements.provisionVisibility.value} GitHub-Repository` : '';
  if (!window.confirm(`Projekt lokal mit initialem Git-Commit${githubText} erstellen?`)) return;
  elements.provisionMessage.textContent = 'Projektaufbau wurde gestartet. Fortschritt erscheint im Arbeitsbereich des neuen Projekts.';
  try {
    const job = await api('/api/projects/provision', { method: 'POST', body: JSON.stringify({
      name: elements.provisionName.value, slug: elements.provisionSlug.value,
      parentDirectory: elements.provisionParent.value, description: elements.provisionDescription.value,
      createGitHub: elements.provisionGitHub.checked, visibility: elements.provisionVisibility.value,
    }) });
    projectUiState.setJobOrigin(job.id, projectId); liveJobs.set(job.id, job);
    if (!requestIsCurrent(token)) return;
    if (activeProject?.id === projectId) { showView('tasks'); renderConversation(); await refreshJobs(); }
  } catch (error) { if (activeProject?.id === projectId) elements.provisionMessage.textContent = error.message; }
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
  if (closest) selectGraphNode(closest, { center: true, revealList: true });
});
elements.graphNodeList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-graph-node]'); if (!button) return;
  selectGraphNode(button.dataset.graphNode, { center: true });
});
elements.graphDetails.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-graph-neighbor]'); if (!button) return;
  selectGraphNode(button.dataset.graphNeighbor, { center: true, revealList: true, focusList: true });
});

elements.noteList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-note-path]'); if (button) loadObsidian(button.dataset.notePath);
});

elements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const projectId = activeProject.id;
  const providerOrder = currentProviderOrder();
  const availability = taskStartState({ providerOrder, hasRunningTask: hasRunningTask(), catalogReady: modelCatalogReady, catalogLoading: modelCatalogLoading, runtimeReady: Boolean(providerStatus) });
  if (availability.disabled) { elements.formMessage.textContent = availability.reason; renderExecutionControls(false); return; }
  elements.start.disabled = true; elements.formMessage.textContent = 'Task wird gestartet…';
  const token = beginRequest('taskMutation', projectId);
  const taskText = elements.task.value;
  const attachments = selectedAttachments.map((attachment) => ({ ...attachment }));
  try {
    const job = await api('/api/tasks', { method: 'POST', body: JSON.stringify({
      projectId, task: taskText, provider: providerOrder.length === 1 ? providerOrder[0] : 'Auto', providerOrder,
      models: selectedProviderModels(),
      mode: elements.mode.value, useSubscriptionTokens: elements.useSubscriptionTokens.checked,
      attachments: attachments.map(({ name, type, dataUrl }) => ({ name, type, dataUrl })),
    }) });
    submittedTaskText.set(job.id, taskText);
    submittedTaskAttachments.set(job.id, attachments.map(({ name, dataUrl }) => ({ name, url: dataUrl })));
    if (job.projectId !== projectId) projectUiState.setJobOrigin(job.id, projectId);
    liveJobs.set(job.id, job); clearComposerDraft(projectId);
    if (!requestIsCurrent(token)) return;
    if (activeProject?.id === projectId) { renderConversation(); elements.formMessage.textContent = 'Aufgabe läuft. Fortschritt erscheint direkt im Gespräch.'; await refreshJobs(); }
  } catch (error) { if (requestIsCurrent(token)) elements.formMessage.textContent = error.message; }
  finally { if (requestIsCurrent(token)) renderExecutionControls(false); }
});

document.getElementById('portfolioView').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-portfolio-target]'); if (!button) return;
  const projectId = button.dataset.portfolioProject;
  if (projectId && projectId !== activeProject?.id) await activateProject(projectId);
  showView(button.dataset.portfolioTarget);
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
  const projectId = activeProject.id; const worktree = gitData.worktree; const token = beginRequest('gitMutation', projectId);
  elements.gitCommit.disabled = true; elements.gitCommitPush.disabled = true; elements.gitMessage.textContent = 'Commit wird erstellt…';
  let committed = false;
  try {
    const result = await api('/api/git/commit', { method: 'POST', body: JSON.stringify({ projectId, worktree, paths, message }) });
    committed = true; if (!requestIsCurrent(token)) return;
    elements.gitCommitMessage.value = ''; visibleGitDraftValue = '';
    if (pushAfterCommit) {
      elements.gitMessage.textContent = 'Commit erstellt, Branch wird gepusht…';
      const pushed = await api('/api/git/push', { method: 'POST', body: JSON.stringify({ projectId, worktree }) });
      if (!requestIsCurrent(token)) return;
      renderGitState(pushed.state); elements.gitMessage.textContent = 'Auswahl wurde committed und der Branch hochgeladen.';
    } else { renderGitState(result.state); elements.gitMessage.textContent = 'Commit wurde lokal erstellt. Noch nichts wurde gepusht.'; }
  } catch (error) { if (requestIsCurrent(token)) elements.gitMessage.textContent = committed ? `Commit wurde erstellt, Push ist fehlgeschlagen: ${error.message}` : error.message; }
  finally { if (requestIsCurrent(token)) { elements.gitCommit.disabled = Boolean(gitData?.clean); elements.gitCommitPush.disabled = Boolean(gitData?.clean || !gitData?.remote); } }
}
elements.gitCommit.addEventListener('click', () => commitSelectedGitFiles(false));
elements.gitCommitPush.addEventListener('click', () => commitSelectedGitFiles(true));
elements.gitCommitMessage.addEventListener('input', () => queueCommitDraftSave());
elements.gitCommitMessage.addEventListener('change', () => queueCommitDraftSave(0));
elements.gitTarget.addEventListener('change', () => { selectedGitFile = null; loadGitState(elements.gitTarget.value); });
elements.gitIntegrate.addEventListener('click', async () => {
  const canCleanup = gitData?.integration?.canCleanup;
  if (!gitData?.integration?.canFastForward && !canCleanup) { elements.gitMessage.textContent = gitData?.integration?.reason || 'Dieser Aufgabenstand kann nicht automatisch abgeschlossen werden.'; return; }
  const targetNote = gitData.integration.branch === 'main' ? 'Da kein separater Integrationsbranch vorhanden ist, wird main aktualisiert.' : 'main bleibt unverändert.';
  const action = canCleanup
    ? `Branch ${gitData.branch} ist bereits in ${gitData.integration.branch} enthalten. Aufgaben-Worktree und lokalen Branch jetzt löschen? Ein Remote-Branch bleibt erhalten.`
    : `Branch ${gitData.branch} per sicherem Fast-forward in ${gitData.integration.branch} übernehmen und anschließend den Aufgaben-Worktree sowie den lokalen Branch löschen? Ein Remote-Branch bleibt erhalten. ${targetNote}`;
  if (!window.confirm(action)) return;
  const projectId = activeProject.id; const worktree = gitData.worktree; const token = beginRequest('gitMutation', projectId);
  elements.gitIntegrate.disabled = true; elements.gitMessage.textContent = `${gitData.integration.branch} wird aktualisiert…`;
  try {
    const result = await api('/api/git/integrate', { method: 'POST', body: JSON.stringify({ projectId, worktree }) });
    if (!requestIsCurrent(token)) return;
    selectedGitFile = null; renderGitState(result.state);
    const remoteNote = result.remoteBranchPreserved ? ' Ein Remote-Branch wurde bewusst nicht gelöscht.' : '';
    const completion = result.alreadyIntegrated ? 'Aufgabenstand war bereits übernommen' : `Aufgabenstand wurde in ${result.state.integration.branch} übernommen`;
    const nextStep = result.state.integration.branch === 'main' ? 'Prüfe und pushe jetzt main.' : `Prüfe und pushe jetzt nur ${result.state.integration.branch}; main bleibt unverändert.`;
    elements.gitMessage.textContent = `${completion}; ${result.deletedBranch} wurde lokal gelöscht.${remoteNote} ${nextStep}`;
  } catch (error) { if (requestIsCurrent(token)) elements.gitMessage.textContent = error.message; }
  finally { if (requestIsCurrent(token)) elements.gitIntegrate.disabled = !(gitData?.integration?.canFastForward || gitData?.integration?.canCleanup); }
});
elements.gitCleanupMerged.addEventListener('click', async () => {
  const candidates = gitData?.cleanupCandidates || [];
  if (!candidates.length) return;
  const branchList = candidates.map((candidate) => `- ${candidate.branch}`).join('\n');
  if (!window.confirm(`${candidates.length} saubere, bereits in ${gitData.integration.branch} enthaltene Aufgaben-Worktrees entfernen?\n\n${branchList}\n\nNicht integrierte oder geänderte Branches bleiben erhalten.`)) return;
  const projectId = activeProject.id; const token = beginRequest('gitMutation', projectId);
  elements.gitCleanupMerged.disabled = true; elements.gitMessage.textContent = 'Abgeschlossene Aufgaben werden sicher aufgeräumt…';
  try {
    const result = await api('/api/git/cleanup-merged', { method: 'POST', body: JSON.stringify({ projectId, worktrees: candidates.map((candidate) => candidate.path) }) });
    if (!requestIsCurrent(token)) return;
    selectedGitFile = null; renderGitState(result.state);
    elements.gitMessage.textContent = result.cleaned.length === 1
      ? '1 abgeschlossene Aufgabe wurde entfernt. Nicht integrierte Branches blieben unverändert.'
      : `${result.cleaned.length} abgeschlossene Aufgaben wurden entfernt. Nicht integrierte Branches blieben unverändert.`;
  } catch (error) { if (requestIsCurrent(token)) elements.gitMessage.textContent = error.message; }
  finally { if (requestIsCurrent(token)) elements.gitCleanupMerged.disabled = !(gitData?.cleanupCandidates?.length); }
});
elements.gitPush.addEventListener('click', async () => {
  if (!gitData?.remote) { elements.gitMessage.textContent = 'Kein origin-Remote konfiguriert.'; return; }
  if (!window.confirm(`Branch ${gitData.branch} ohne Force-Push zu ${gitData.remote} hochladen?`)) return;
  const projectId = activeProject.id; const worktree = gitData.worktree; const token = beginRequest('gitMutation', projectId);
  elements.gitPush.disabled = true; elements.gitMessage.textContent = 'Branch wird gepusht…';
  try {
    const result = await api('/api/git/push', { method: 'POST', body: JSON.stringify({ projectId, worktree }) });
    if (!requestIsCurrent(token)) return;
    renderGitState(result.state); elements.gitMessage.textContent = 'Branch wurde erfolgreich hochgeladen.';
  } catch (error) { if (requestIsCurrent(token)) elements.gitMessage.textContent = error.message; }
  finally { if (requestIsCurrent(token)) elements.gitPush.disabled = false; }
});

elements.history.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-stop-job]'); if (!button) return; button.disabled = true;
  const token = beginRequest('jobMutation', activeProject.id);
  try { await api(`/api/jobs/${button.dataset.stopJob}/stop`, { method: 'POST', body: '{}' }); if (requestIsCurrent(token)) await refreshJobs(); }
  catch (error) { if (requestIsCurrent(token)) elements.formMessage.textContent = error.message; }
});

document.getElementById('systemsView').addEventListener('click', async (event) => {
  const install = event.target.closest('button[data-install-system]');
  if (install) {
    if (!window.confirm(`${install.dataset.installName} über den freigegebenen offiziellen Paketweg installieren? Es werden keine kostenpflichtigen Dienste aktiviert.`)) return;
    const projectId = activeProject.id; const token = beginRequest('systemMutation', projectId);
    install.disabled = true; elements.systemMessage.textContent = `${install.dataset.installName} wird installiert. Der Fortschritt erscheint direkt im Projektgespräch.`;
    try {
      const job = await api('/api/systems/install', { method: 'POST', body: JSON.stringify({ projectId, installKey: install.dataset.installSystem }) });
      liveJobs.set(job.id, job);
      if (!requestIsCurrent(token)) return;
      showView('tasks'); await refreshJobs();
    } catch (error) { if (requestIsCurrent(token)) { elements.systemMessage.textContent = error.message; install.disabled = false; } }
    return;
  }
  const update = event.target.closest('button[data-update-system]');
  if (update) {
    const versionText = update.dataset.currentVersion && update.dataset.latestVersion
      ? ` von ${update.dataset.currentVersion} auf ${update.dataset.latestVersion}` : '';
    if (!window.confirm(`${update.dataset.updateName}${versionText} über ${update.dataset.updateSource} aktualisieren? Das Update läuft sichtbar im Projektgespräch und kann einen Neustart erfordern.`)) return;
    const projectId = activeProject.id; const token = beginRequest('systemMutation', projectId);
    update.disabled = true; elements.systemMessage.textContent = `${update.dataset.updateName} wird aktualisiert. Der Fortschritt erscheint direkt im Projektgespräch.`;
    try {
      const job = await api('/api/systems/update', { method: 'POST', body: JSON.stringify({ projectId, updateKey: update.dataset.updateSystem }) });
      liveJobs.set(job.id, job);
      if (!requestIsCurrent(token)) return;
      showView('tasks'); await refreshJobs();
    } catch (error) { if (requestIsCurrent(token)) { elements.systemMessage.textContent = error.message; update.disabled = false; } }
    return;
  }
  const remove = event.target.closest('button[data-remove-system]'); if (!remove) return;
  if (!window.confirm('System nur aus dem Dashboard entfernen? Dateien werden nicht gelöscht.')) return;
  const projectId = activeProject.id; const token = beginRequest('systemMutation', projectId);
  try { await api(`/api/systems/${encodeURIComponent(remove.dataset.removeSystem)}`, { method: 'DELETE' }); if (requestIsCurrent(token)) await loadSystems(true); }
  catch (error) { if (requestIsCurrent(token)) elements.systemMessage.textContent = error.message; }
});

new ResizeObserver(() => { if (graphData) drawGraph(); }).observe(elements.graphCanvas);

initialize();
setInterval(refreshJobs, 3000);
setInterval(() => { void refreshStatusSafely(); }, 15000);
setInterval(refreshHistory, 15000);
