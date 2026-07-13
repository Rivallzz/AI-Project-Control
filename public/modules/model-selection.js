'use strict';

export const MODEL_CATALOG_VERSION = 1;
export const PROVIDERS = ['Codex', 'Claude', 'Ollama'];

export function primaryFirst(providers, primaryProvider) {
  const source = [...providers];
  return source.includes(primaryProvider)
    ? [primaryProvider, ...source.filter((provider) => provider !== primaryProvider)]
    : source;
}

export function modelCatalog(config) {
  return config?.modelCatalog?.version === MODEL_CATALOG_VERSION ? config.modelCatalog : null;
}

export function providerCatalog(config, provider) {
  return modelCatalog(config)?.providers?.[provider] || null;
}

export function availableModels(config, provider) {
  return (providerCatalog(config, provider)?.models || [])
    .filter((model) => model.availability === 'available' && !model.deprecated);
}

export function defaultModelId(config, provider) {
  const catalog = providerCatalog(config, provider);
  const fallback = availableModels(config, provider)[0];
  return availableModels(config, provider).some((model) => model.id === catalog?.defaultModelId)
    ? catalog.defaultModelId
    : fallback?.id || '';
}

export function selectedModel(config, provider, modelId) {
  return availableModels(config, provider).find((model) => model.id === modelId) || null;
}

export function reconcileModelSelection(config, provider, requestedId) {
  const requested = String(requestedId || '');
  const exact = selectedModel(config, provider, requested);
  if (exact) return { value: exact.id, model: exact, replaced: false, message: '' };

  const fallbackId = defaultModelId(config, provider);
  const fallback = selectedModel(config, provider, fallbackId);
  if (!fallback) {
    const reason = providerCatalog(config, provider)?.message || `Für ${provider} ist kein ausführbares Modell verfügbar.`;
    return { value: '', model: null, replaced: Boolean(requested), message: reason };
  }

  const message = requested
    ? `${provider}: „${requested}“ ist nicht mehr verfügbar. Als sicherer Fallback wurde „${fallback.displayName}“ gewählt.`
    : '';
  return { value: fallback.id, model: fallback, replaced: Boolean(requested), message };
}

export function modelProfile(config, profileId) {
  const profiles = modelCatalog(config)?.profiles || {};
  return profiles[profileId] || null;
}

export function modelProfiles(config) {
  return Object.values(modelCatalog(config)?.profiles || {});
}

export function profileSelections(config, profileId) {
  const profile = modelProfile(config, profileId);
  if (!profile) return null;
  return Object.fromEntries(PROVIDERS.map((provider) => {
    const selection = reconcileModelSelection(config, provider, profile.modelIds?.[provider]);
    return [provider, selection.value];
  }));
}

export function modelDecisionText(model) {
  if (!model) return '';
  const parts = [];
  if (model.description) parts.push(model.description);
  if (model.displayName !== model.id) parts.push(`Technische ID: ${model.id}`);
  if (model.recommendedUseCases?.length) parts.push(`Geeignet für: ${model.recommendedUseCases.join(', ')}`);
  if (model.contextWindow) parts.push(`Kontext: ${new Intl.NumberFormat('de-DE').format(model.contextWindow)} Token`);
  parts.push(model.localOrRemote === 'local' ? 'Lokal; Daten bleiben auf diesem Computer.' : 'Remote über das freigegebene Abo-Kontingent; API-Abrechnung bleibt gesperrt.');
  return parts.join(' · ');
}

export function taskStartState({ providerOrder, hasRunningTask, catalogReady, catalogLoading = false, runtimeReady = true }) {
  if (!catalogReady) return { disabled: true, label: 'Modelle werden geladen', reason: 'Der Modellkatalog ist noch nicht verfügbar.' };
  if (catalogLoading) return { disabled: true, label: 'Modelle werden aktualisiert', reason: 'Die verfügbaren Modelle werden gerade neu geprüft.' };
  if (!runtimeReady) return { disabled: true, label: 'Provider werden geprüft', reason: 'Der lokale Providerstatus wird noch geprüft.' };
  if (hasRunningTask) return { disabled: true, label: 'Aufgabe läuft', reason: 'Für dieses Projekt läuft bereits eine Aufgabe.' };
  if (!providerOrder.length) return { disabled: true, label: 'Senden', reason: 'Kein Provider mit einem verfügbaren Modell ist für diesen Modus aktiv.' };
  return { disabled: false, label: 'Senden', reason: '' };
}
