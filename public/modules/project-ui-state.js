'use strict';

const CONVERSATION_JOB_KINDS = new Set(['task', 'dashboard-command', 'install', 'update', 'provision']);

export function jobBelongsInConversation(job, projectId, originProjectId = null) {
  return Boolean(job && projectId && CONVERSATION_JOB_KINDS.has(job.kind || 'task')
    && (originProjectId || job.projectId) === projectId);
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
