'use strict';

export async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

export function createRequestState(getProjectId) {
  const generations = new Map();
  let projectGeneration = 0;

  function begin(scope, projectId = getProjectId() || null) {
    const generation = (generations.get(scope) || 0) + 1;
    generations.set(scope, generation);
    return { scope, generation, projectId, projectGeneration };
  }

  function isCurrent(token) {
    return generations.get(token.scope) === token.generation
      && token.projectGeneration === projectGeneration
      && token.projectId === (getProjectId() || null);
  }

  function invalidateProject() {
    projectGeneration += 1;
    for (const scope of generations.keys()) generations.set(scope, generations.get(scope) + 1);
  }

  function invalidate(scope) {
    generations.set(scope, (generations.get(scope) || 0) + 1);
  }

  return { begin, isCurrent, invalidate, invalidateProject };
}
