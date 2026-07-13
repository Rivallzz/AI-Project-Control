'use strict';

const CONVERSATION_JOB_KINDS = new Set(['task', 'dashboard-command', 'install', 'update', 'provision']);

function runPathKey(value) {
  return String(value || '').trim().replace(/\//g, '\\').toLowerCase();
}

export function jobBelongsInConversation(job, projectId, originProjectId = null) {
  return Boolean(job && projectId && CONVERSATION_JOB_KINDS.has(job.kind || 'task')
    && (originProjectId || job.projectId) === projectId);
}

export function reconcileConversationSources(runs = [], jobs = []) {
  const jobsByRunPath = new Map(jobs
    .filter((job) => runPathKey(job?.runDirectory))
    .map((job) => [runPathKey(job.runDirectory), job]));
  const visibleRuns = runs.filter((run) => run.status !== 'external' || !jobsByRunPath.has(runPathKey(run.path)));
  const completedRunPaths = new Set(visibleRuns
    .filter((run) => run.status !== 'external' && runPathKey(run.path))
    .map((run) => runPathKey(run.path)));
  const visibleJobs = jobs.filter((job) => !runPathKey(job.runDirectory) || !completedRunPaths.has(runPathKey(job.runDirectory)));
  return { runs: visibleRuns, jobs: visibleJobs };
}

export function runStatusPresentation(status) {
  if (status === 'PASS') return { label: 'fertig', className: 'ok', fallback: 'Der Lauf wurde erfolgreich abgeschlossen.' };
  if (status === 'FAIL') return { label: 'fehlgeschlagen', className: 'fail', fallback: 'Der Lauf ist fehlgeschlagen. Öffne die technischen Details des zugehörigen Jobs.' };
  if (status === 'BLOCKED') return { label: 'blockiert', className: 'warn', fallback: 'Der Lauf wurde kontrolliert blockiert und benötigt eine Entscheidung.' };
  if (status === 'external') return {
    label: 'unvollständig',
    className: 'warn',
    fallback: 'Für diesen Lauf liegt kein Abschlussstatus vor. Das Dashboard bestätigt keine laufende Arbeit; ein aktiver Job wird immer separat mit Live-Fortschritt angezeigt.',
  };
  return { label: 'Status unbekannt', className: 'warn', fallback: 'Für diesen Lauf liegt kein verlässlicher Status vor.' };
}

export function jobPhaseLabel(phase) {
  const value = String(phase || '').trim();
  if (!value || value === 'routing') return 'Provider-Route und Arbeitsumgebung werden vorbereitet';
  if (value === 'interrupted') return 'durch Dashboard-Neustart unterbrochen';
  if (value === 'blocked') return 'kontrolliert blockiert';
  if (value === 'complete') return 'abgeschlossen';
  const providerEvent = value.match(/^(.+?)\s*·\s*(started|finished)$/i);
  if (providerEvent) return providerEvent[2].toLowerCase() === 'started'
    ? `${providerEvent[1]} wurde gestartet`
    : `${providerEvent[1]} hat die Ausführung beendet`;
  return value;
}

export function createProjectUiState(storage = window.localStorage) {
  const composerDrafts = new Map();
  const jobOrigins = new Map();
  const storageKey = (projectId) => `ai-project-control:composer:${projectId}`;

  function saveComposer(projectId, text, attachments) {
    if (!projectId) return;
    composerDrafts.set(projectId, { text, attachments });
    try {
      if (text) storage.setItem(storageKey(projectId), text);
      else storage.removeItem(storageKey(projectId));
    } catch {}
  }

  function loadComposer(projectId) {
    const memoryDraft = composerDrafts.get(projectId);
    let storedText = '';
    try { storedText = storage.getItem(storageKey(projectId)) || ''; } catch {}
    return { text: memoryDraft?.text ?? storedText, attachments: memoryDraft?.attachments || [] };
  }

  function clearComposer(projectId) {
    composerDrafts.delete(projectId);
    try { storage.removeItem(storageKey(projectId)); } catch {}
  }

  function setJobOrigin(jobId, projectId) {
    if (jobId && projectId) jobOrigins.set(jobId, projectId);
  }

  return {
    saveComposer, loadComposer, clearComposer, setJobOrigin,
    jobOrigin: (jobId) => jobOrigins.get(jobId) || null,
  };
}
