'use strict';

const MISSING_DETAIL = 'Graphify-Details nicht verfügbar.';

function unknownState() {
  return { ok: false, warning: true, label: 'unbekannt' };
}

export function graphifyComponentState(graphify) {
  if (!graphify || typeof graphify !== 'object' || Array.isArray(graphify)) return unknownState();

  if (graphify.indexStatus === 'invalid') {
    return { ok: false, warning: false, label: 'fehlerhaft' };
  }
  if (graphify.indexStatus === 'missing') {
    return { ok: false, warning: false, label: 'index fehlt' };
  }

  const hasCurrentContract = ['runtimeOk', 'indexOk', 'indexStatus']
    .some((field) => Object.prototype.hasOwnProperty.call(graphify, field));
  if (hasCurrentContract) {
    if (typeof graphify.runtimeOk !== 'boolean' || typeof graphify.indexOk !== 'boolean') return unknownState();
    if (graphify.runtimeOk && graphify.indexOk) return { ok: true, warning: false, label: 'ok' };
    if (!graphify.runtimeOk && graphify.indexOk) return { ok: false, warning: true, label: 'runtime fehlt' };
    return unknownState();
  }

  if (typeof graphify.ok === 'boolean') {
    return graphify.ok
      ? { ok: true, warning: false, label: 'ok' }
      : unknownState();
  }
  return unknownState();
}

export function graphifyComponentView(graphify) {
  const detail = graphify && typeof graphify === 'object' && !Array.isArray(graphify)
    ? graphify.text
    : null;
  return {
    ...graphifyComponentState(graphify),
    detail: typeof detail === 'string' && detail.trim() ? detail : MISSING_DETAIL,
  };
}
