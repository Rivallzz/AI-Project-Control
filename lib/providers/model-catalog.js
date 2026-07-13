'use strict';

const PROVIDER_NAMES = Object.freeze(['Codex', 'Claude', 'Ollama']);
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const AVAILABLE = 'available';

const CLAUDE_MODEL_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'default',
    displayName: 'Claude-Standard',
    description: 'Von Claude Code aufgelöster Standardalias.',
    capabilityTags: Object.freeze(['coding', 'reasoning', 'tools']),
    recommendedUseCases: Object.freeze(['Allgemeine Aufgaben', 'Coding und Code-Review']),
    speedClass: 'balanced',
  }),
  Object.freeze({
    id: 'sonnet',
    displayName: 'Sonnet',
    description: 'Reviewter Claude-Code-Alias für ausgewogene Agenten- und Coding-Aufgaben.',
    capabilityTags: Object.freeze(['coding', 'reasoning', 'tools']),
    recommendedUseCases: Object.freeze(['Coding und Code-Review', 'Planung und Analyse']),
    speedClass: 'balanced',
  }),
  Object.freeze({
    id: 'opus',
    displayName: 'Opus',
    description: 'Reviewter Claude-Code-Alias für anspruchsvolle Qualitäts- und Reasoning-Aufgaben.',
    capabilityTags: Object.freeze(['coding', 'reasoning', 'tools', 'quality']),
    recommendedUseCases: Object.freeze(['Komplexes Reasoning', 'Anspruchsvolle Reviews']),
    speedClass: 'quality',
  }),
  Object.freeze({
    id: 'haiku',
    displayName: 'Haiku',
    description: 'Reviewter Claude-Code-Alias für schnelle, klar begrenzte Aufgaben.',
    capabilityTags: Object.freeze(['coding', 'tools', 'fast']),
    recommendedUseCases: Object.freeze(['Schnelle Hilfsaufgaben', 'Kleine Coding-Aufgaben']),
    speedClass: 'fast',
  }),
]);

function compactText(value, fallback = '') {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text || fallback;
}

function safeModelId(value) {
  const id = compactText(value);
  return MODEL_ID_PATTERN.test(id) ? id : null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function compareIds(left, right) {
  const normalized = left.toLocaleLowerCase('en').localeCompare(right.toLocaleLowerCase('en'), 'en');
  return normalized || left.localeCompare(right, 'en');
}

function compareModelPriority(left, right) {
  const leftPriority = left.priority ?? Number.MAX_SAFE_INTEGER;
  const rightPriority = right.priority ?? Number.MAX_SAFE_INTEGER;
  return leftPriority - rightPriority || compareIds(left.id, right.id);
}

function parsedCodexCache(value) {
  if (typeof value !== 'string') return value && typeof value === 'object' ? value : null;
  try { return JSON.parse(value); }
  catch { return null; }
}

function reasoningMetadata(rawModel) {
  const levels = Array.isArray(rawModel.supported_reasoning_levels)
    ? rawModel.supported_reasoning_levels.map((entry) => compactText(entry?.effort)).filter(Boolean)
    : [];
  const defaultLevel = compactText(rawModel.default_reasoning_level);
  return { levels, hasReasoning: Boolean(defaultLevel || levels.length) };
}

function codexModelFromCache(rawModel) {
  const id = safeModelId(rawModel?.slug);
  if (!id || id.toLocaleLowerCase('en') === 'default') return null;

  const description = compactText(rawModel.description, 'Im lokalen Codex-Modellcache erkanntes Modell.');
  const contextWindow = positiveInteger(rawModel.context_window) || positiveInteger(rawModel.max_context_window);
  const priority = nonNegativeNumber(rawModel.priority);
  const reasoning = reasoningMetadata(rawModel);
  const speedClass = /\b(?:ultra[- ]?fast|fast|quick|speed)\b/i.test(description) ? 'fast' : 'balanced';
  const capabilityTags = [];
  if (reasoning.hasReasoning) capabilityTags.push('reasoning');
  if (/\b(?:coding|code review|software development)\b/i.test(description)) capabilityTags.push('coding');
  if (contextWindow && contextWindow >= 128000) capabilityTags.push('long-context');
  if (compactText(rawModel.shell_type) || rawModel.supports_parallel_tool_calls === true) capabilityTags.push('tools');
  if (speedClass === 'fast') capabilityTags.push('fast');

  const recommendedUseCases = [];
  if (capabilityTags.includes('coding')) recommendedUseCases.push('Coding und Code-Review');
  if (capabilityTags.includes('reasoning')) recommendedUseCases.push('Planung und komplexe Analyse');
  if (capabilityTags.includes('fast')) recommendedUseCases.push('Schnelle Hilfsaufgaben');
  if (capabilityTags.includes('long-context')) recommendedUseCases.push('Lange Kontexte');

  const upgrade = rawModel.upgrade;
  const deprecated = rawModel.deprecated === true
    || rawModel.deprecation === true
    || Boolean(upgrade && typeof upgrade === 'object' && (upgrade.model || upgrade.slug));
  const explicitlyUnavailable = rawModel.available === false
    || compactText(rawModel.availability).toLocaleLowerCase('en') === 'unavailable';

  const model = {
    id,
    displayName: compactText(rawModel.display_name, id),
    provider: 'Codex',
    description,
    capabilityTags,
    recommendedUseCases,
    contextWindow,
    speedClass,
    privacyMode: 'subscription-cloud',
    localOrRemote: 'remote',
    availability: deprecated || explicitlyUnavailable ? 'unavailable' : AVAILABLE,
    deprecated,
  };
  if (priority !== null) model.priority = priority;
  return model;
}

function configuredCodexModel(id) {
  return {
    id,
    displayName: id,
    provider: 'Codex',
    description: 'In der lokalen Codex-Konfiguration ausgewähltes Modell.',
    capabilityTags: [],
    recommendedUseCases: [],
    contextWindow: null,
    speedClass: 'unknown',
    privacyMode: 'subscription-cloud',
    localOrRemote: 'remote',
    availability: AVAILABLE,
    deprecated: false,
  };
}

function preferredDuplicate(left, right) {
  return compareModelPriority(left, right) <= 0 ? left : right;
}

function buildCodexProvider(configuredModelValue, cacheValue) {
  const configuredId = safeModelId(configuredModelValue);
  const cache = parsedCodexCache(cacheValue);
  const rawModels = Array.isArray(cache?.models) ? cache.models : [];
  const byId = new Map();

  for (const rawModel of rawModels) {
    if (rawModel?.visibility !== 'list') continue;
    const model = codexModelFromCache(rawModel);
    if (!model) continue;
    const key = model.id.toLocaleLowerCase('en');
    byId.set(key, byId.has(key) ? preferredDuplicate(byId.get(key), model) : model);
  }

  if (configuredId && !byId.has(configuredId.toLocaleLowerCase('en'))) {
    byId.set(configuredId.toLocaleLowerCase('en'), configuredCodexModel(configuredId));
  }

  const concreteModels = [...byId.values()].sort(compareModelPriority);
  const resolvedDefault = configuredId
    ? byId.get(configuredId.toLocaleLowerCase('en')) || null
    : null;
  const defaultModel = resolvedDefault
    ? {
      ...resolvedDefault,
      id: 'default',
      displayName: `Standard (${resolvedDefault.displayName})`,
      description: `Codex-Standard; wird zu ${resolvedDefault.displayName} aufgelöst.`,
      resolvedModelId: resolvedDefault.id,
    }
    : {
      id: 'default',
      displayName: 'Codex-Standard',
      provider: 'Codex',
      description: 'Von Codex über die lokale Konfiguration aufgelöstes Standardmodell.',
      capabilityTags: ['reasoning', 'tools'],
      recommendedUseCases: ['Allgemeine Agentenaufgaben'],
      contextWindow: null,
      speedClass: 'balanced',
      privacyMode: 'subscription-cloud',
      localOrRemote: 'remote',
      availability: AVAILABLE,
      deprecated: false,
    };
  const models = [defaultModel, ...concreteModels];
  const availableConcrete = concreteModels.filter((model) => model.availability === AVAILABLE && !model.deprecated).length;
  const cacheMessage = rawModels.length
    ? `${availableConcrete} auswählbare Codex-Modelle aus dem lokalen Cache erkannt.`
    : 'Der lokale Codex-Cache enthält keine auswählbaren Modelle; Codex-Standard bleibt verfügbar.';

  return {
    id: 'Codex',
    displayName: 'Codex',
    status: models.some((model) => model.availability === AVAILABLE && !model.deprecated) ? AVAILABLE : 'unavailable',
    message: cacheMessage,
    defaultModelId: 'default',
    models,
  };
}

function claudeModel(definition) {
  return {
    id: definition.id,
    displayName: definition.displayName,
    provider: 'Claude',
    description: definition.description,
    capabilityTags: [...definition.capabilityTags],
    recommendedUseCases: [...definition.recommendedUseCases],
    contextWindow: null,
    speedClass: definition.speedClass,
    privacyMode: 'subscription-cloud',
    localOrRemote: 'remote',
    availability: AVAILABLE,
    deprecated: false,
  };
}

function buildClaudeProvider() {
  return {
    id: 'Claude',
    displayName: 'Claude Code',
    status: AVAILABLE,
    message: 'Drei reviewte Claude-Code-Aliase plus Provider-Standard sind verfügbar.',
    defaultModelId: 'default',
    models: CLAUDE_MODEL_DEFINITIONS.map(claudeModel),
  };
}

function ollamaExitCode(result) {
  if (!result || typeof result !== 'object') return null;
  const value = result.exitCode ?? result.code;
  return Number.isInteger(Number(value)) ? Number(value) : null;
}

function ollamaModelIdsFromList(stdout) {
  const candidates = compactText(stdout) ? String(stdout).split(/\r?\n/) : [];
  const ids = candidates
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((id) => id && id.toLocaleUpperCase('en') !== 'NAME')
    .map(safeModelId)
    .filter(Boolean)
    .sort(compareIds);
  const seen = new Set();
  return ids.filter((id) => {
    const key = id.toLocaleLowerCase('en');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ollamaShowResult(showResults, id) {
  const match = Object.entries(showResults || {}).find(([key]) => key.toLocaleLowerCase('en') === id.toLocaleLowerCase('en'));
  return match?.[1] || null;
}

function ollamaCapabilities(stdout) {
  const lines = String(stdout || '').split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim().toLocaleLowerCase('en') === 'capabilities');
  if (headingIndex < 0) return [];
  const headingIndent = lines[headingIndex].match(/^\s*/)?.[0].length || 0;
  const capabilities = [];
  for (const line of lines.slice(headingIndex + 1)) {
    const value = line.trim();
    if (!value) {
      if (capabilities.length) break;
      continue;
    }
    const indent = line.match(/^\s*/)?.[0].length || 0;
    if (indent <= headingIndent) break;
    capabilities.push(value.split(/\s+/)[0].toLocaleLowerCase('en'));
  }
  return [...new Set(capabilities)];
}

function ollamaModel(id, showResult) {
  const showSucceeded = ollamaExitCode(showResult) === 0;
  const capabilities = showSucceeded ? ollamaCapabilities(showResult.stdout) : [];
  const completion = capabilities.includes('completion');
  const contextMatch = String(showResult?.stdout || '').match(/context\s+length\s+(\d+)/i);
  const contextWindow = positiveInteger(contextMatch?.[1]);
  const capabilityTags = ['local', 'privacy'];
  if (completion) capabilityTags.push('completion');
  if (capabilities.includes('tools')) capabilityTags.push('tools');
  const description = !showSucceeded
    ? 'Installiertes Ollama-Modell, dessen Capability-Metadaten nicht gelesen werden konnten.'
    : completion
      ? 'Lokal installiertes Ollama-Chatmodell mit bestätigter Completion-Fähigkeit.'
      : 'Installiertes Ollama-Modell ohne bestätigte Completion-Fähigkeit; nicht als Chatmodell auswählbar.';
  return {
    id,
    displayName: id,
    provider: 'Ollama',
    description,
    capabilityTags,
    recommendedUseCases: ['Lokale, datenschutzorientierte Verarbeitung'],
    contextWindow,
    speedClass: 'unknown',
    privacyMode: 'local-private',
    localOrRemote: 'local',
    availability: completion ? AVAILABLE : 'unavailable',
    deprecated: false,
  };
}

function buildOllamaProvider(result, showResults) {
  const exitCode = ollamaExitCode(result);
  const successful = exitCode === 0;
  const modelIds = successful ? ollamaModelIdsFromList(result.stdout) : [];
  const models = modelIds.map((id) => ollamaModel(id, ollamaShowResult(showResults, id)));
  const executableModels = models.filter((model) => model.availability === AVAILABLE);
  let status;
  let message;
  if (!successful) {
    status = 'error';
    const detail = compactText(result?.stderr);
    message = detail ? `Ollama-Modelle konnten nicht gelesen werden: ${detail}` : 'Ollama-Modelle konnten nicht gelesen werden.';
  } else if (!modelIds.length) {
    status = 'unavailable';
    message = 'Keine lokalen Ollama-Modelle gefunden.';
  } else if (!executableModels.length) {
    status = 'unavailable';
    message = `${models.length} lokale Ollama-Modelle erkannt, aber keines weist eine bestätigte Completion-Fähigkeit aus.`;
  } else {
    status = AVAILABLE;
    const unavailableCount = models.length - executableModels.length;
    const unavailableMessage = unavailableCount
      ? `; ${unavailableCount} ${unavailableCount === 1 ? 'weiteres Modell ist' : 'weitere Modelle sind'} nicht als Chatmodell auswählbar`
      : '';
    message = `${executableModels.length} lokale Ollama-Chatmodelle mit bestätigter Completion-Fähigkeit erkannt${unavailableMessage}.`;
  }

  return {
    id: 'Ollama',
    displayName: 'Hermes + Ollama',
    status,
    message,
    defaultModelId: executableModels[0]?.id || null,
    models,
  };
}

function availableModels(provider, options = {}) {
  return provider.models
    .filter((model) => model.availability === AVAILABLE && !model.deprecated)
    .filter((model) => options.includeDefault || model.id !== 'default');
}

function resolvedDefaultId(provider) {
  const model = provider.models.find((candidate) => candidate.id === provider.defaultModelId);
  if (!model || model.availability !== AVAILABLE || model.deprecated) return null;
  return model.resolvedModelId || model.id;
}

function firstTaggedModel(provider, tag) {
  return availableModels(provider).filter((model) => model.capabilityTags.includes(tag)).sort(compareModelPriority)[0]?.id || null;
}

function firstQualityModel(provider) {
  const candidates = availableModels(provider).sort(compareModelPriority);
  return candidates.find((model) => model.capabilityTags.includes('reasoning'))?.id || null;
}

function buildProfiles(providers) {
  const balancedCodex = resolvedDefaultId(providers.Codex);
  return {
    balanced: {
      id: 'balanced',
      displayName: 'Ausgewogen',
      description: 'Nutzt den expliziten Provider-Standard beziehungsweise den reviewten ausgewogenen Alias; lokale Modelle ohne Rollenmetadaten behalten den deterministischen Standard.',
      modelIds: { Codex: balancedCodex, Claude: 'sonnet', Ollama: null },
    },
    fast: {
      id: 'fast',
      displayName: 'Schnell',
      description: 'Bevorzugt Modelle, deren Katalogmetadaten sie als schnell ausweisen; Provider ohne solche Metadaten behalten ihren sicheren Standard.',
      modelIds: { Codex: firstTaggedModel(providers.Codex, 'fast'), Claude: 'haiku', Ollama: null },
    },
    quality: {
      id: 'quality',
      displayName: 'Beste Qualität',
      description: 'Bevorzugt priorisierte Reasoning-Modelle und den reviewten Qualitätsalias; ohne belastbare Metadaten bleibt der Provider-Standard aktiv.',
      modelIds: { Codex: firstQualityModel(providers.Codex), Claude: 'opus', Ollama: null },
    },
    coding: {
      id: 'coding',
      displayName: 'Coding',
      description: 'Bevorzugt Modelle mit expliziter Coding-Metadatenzuordnung; lokale Modellnamen werden nicht als Rollenbeweis interpretiert.',
      modelIds: { Codex: firstTaggedModel(providers.Codex, 'coding'), Claude: 'sonnet', Ollama: null },
    },
  };
}

function buildModelCatalog({ configuredCodexModel: configuredModel = null, codexCache = null, ollamaResult = null, ollamaShowResults = {} } = {}) {
  const providers = {
    Codex: buildCodexProvider(configuredModel, codexCache),
    Claude: buildClaudeProvider(),
    Ollama: buildOllamaProvider(ollamaResult, ollamaShowResults),
  };
  return { version: 1, providers, profiles: buildProfiles(providers) };
}

function modelSelectionError(message) {
  const error = new Error(message);
  error.name = 'ModelSelectionError';
  error.code = 'INVALID_MODEL_SELECTION';
  error.statusCode = 400;
  return error;
}

function inactiveDefault(provider) {
  return provider?.defaultModelId || 'default';
}

function validateModelSelections(models, providerOrder, catalog) {
  if (!catalog || catalog.version !== 1 || !catalog.providers) {
    throw modelSelectionError('Der Modellkatalog ist ungültig oder nicht verfügbar.');
  }
  if (!Array.isArray(providerOrder)) {
    throw modelSelectionError('Die Providerreihenfolge für die Modellauswahl ist ungültig.');
  }

  const active = new Set();
  for (const value of providerOrder) {
    const providerName = String(value || '');
    if (!PROVIDER_NAMES.includes(providerName)) {
      throw modelSelectionError(`Unbekannter Provider in der Modellroute: ${providerName || '(leer)'}.`);
    }
    if (active.has(providerName)) {
      throw modelSelectionError(`Der Provider ${providerName} kommt mehrfach in der Modellroute vor.`);
    }
    active.add(providerName);
  }

  const source = models && typeof models === 'object' && !Array.isArray(models) ? models : {};
  const normalized = {};
  for (const providerName of PROVIDER_NAMES) {
    const provider = catalog.providers[providerName];
    if (!provider || !Array.isArray(provider.models)) {
      throw modelSelectionError(`Der Modellkatalog für ${providerName} ist ungültig.`);
    }
    if (!active.has(providerName)) {
      normalized[providerName] = inactiveDefault(provider);
      continue;
    }
    if (provider.status !== AVAILABLE) {
      throw modelSelectionError(`${provider.displayName || providerName} ist nicht verfügbar. ${provider.message || 'Kein ausführbares Modell gefunden.'}`);
    }

    const rawValue = source[providerName] === undefined || source[providerName] === null
      ? provider.defaultModelId
      : source[providerName];
    if (typeof rawValue !== 'string' || !rawValue.trim()) {
      throw modelSelectionError(`Für ${provider.displayName || providerName} wurde kein Modell ausgewählt.`);
    }
    let requestedId = rawValue.trim();
    if (providerName === 'Ollama' && requestedId.toLocaleLowerCase('en') === 'default') {
      requestedId = provider.defaultModelId;
      if (!requestedId) {
        throw modelSelectionError('Für Hermes + Ollama ist kein lokales Chatmodell als Standard verfügbar.');
      }
    }

    const selected = provider.models.find((model) => model.id.toLocaleLowerCase('en') === requestedId.toLocaleLowerCase('en'));
    if (!selected) {
      const choices = availableModels(provider, { includeDefault: true }).map((model) => model.id).join(', ');
      const suffix = choices ? ` Verfügbar: ${choices}.` : ' Es wurde kein verfügbares Modell erkannt.';
      throw modelSelectionError(`Das Modell „${requestedId}“ ist für ${provider.displayName || providerName} nicht verfügbar.${suffix}`);
    }
    if (selected.deprecated) {
      throw modelSelectionError(`Das Modell „${selected.id}“ für ${provider.displayName || providerName} ist veraltet und nicht mehr auswählbar.`);
    }
    if (selected.availability !== AVAILABLE) {
      throw modelSelectionError(`Das Modell „${selected.id}“ für ${provider.displayName || providerName} ist derzeit nicht verfügbar.`);
    }
    normalized[providerName] = selected.id;
  }
  return normalized;
}

module.exports = {
  PROVIDER_NAMES,
  buildModelCatalog,
  ollamaModelIdsFromList,
  validateModelSelections,
};
