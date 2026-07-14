'use strict';

function stateClass(value) {
  const allowed = new Set(['active', 'ready', 'standby', 'waiting', 'complete', 'review', 'attention', 'blocked', 'not-required', 'not-used', 'unavailable']);
  return allowed.has(value) ? value : 'waiting';
}

function statusBadge(value, label) {
  const badge = document.createElement('span');
  badge.className = `workflow-status ${stateClass(value)}`;
  badge.textContent = label || value || 'unbekannt';
  return badge;
}

export function workflowCodeSignal(value) {
  return /\b(code|c#|godot|script|klasse|symbol|bug|test|integration|terrain|szene|scene|frontend|backend|api|css|html|javascript|typescript)\b/i.test(String(value || ''));
}

export function renderWorkflow(container, data) {
  const fragment = document.createDocumentFragment();
  const summary = document.createElement('section'); summary.className = `workflow-summary ${stateClass(data.summary.state)}`;
  const summaryMain = document.createElement('div'); summaryMain.className = 'workflow-summary-main';
  const eyebrow = document.createElement('span'); eyebrow.className = 'workflow-eyebrow'; eyebrow.textContent = `${data.summary.source} · ${data.summary.modeLabel}`;
  const titleRow = document.createElement('div'); titleRow.className = 'workflow-title-row';
  const title = document.createElement('h3'); title.textContent = data.summary.title;
  titleRow.append(title, statusBadge(data.summary.state, data.summary.stateLabel));
  const reason = document.createElement('p'); reason.textContent = data.summary.reason;
  summaryMain.append(eyebrow, titleRow, reason);
  const route = document.createElement('div'); route.className = 'workflow-route-summary';
  const routeLabel = document.createElement('span'); routeLabel.textContent = 'Aktuelle Route';
  const routeValue = document.createElement('strong'); routeValue.textContent = data.summary.routeLabel;
  route.append(routeLabel, routeValue);
  summary.append(summaryMain, route); fragment.append(summary);

  const explanation = document.createElement('section'); explanation.className = 'workflow-explanation';
  const explanationHeading = document.createElement('div'); explanationHeading.className = 'workflow-section-heading';
  const explanationTitle = document.createElement('h3'); explanationTitle.textContent = 'Warum wird dieser Ablauf angezeigt?';
  const explanationText = document.createElement('p'); explanationText.textContent = 'Die Herleitung folgt festen Projekt-, Job- und Git-Regeln.';
  explanationHeading.append(explanationTitle, explanationText);
  const facts = document.createElement('dl'); facts.className = 'workflow-facts';
  for (const fact of data.facts || []) {
    const item = document.createElement('div');
    const term = document.createElement('dt'); term.textContent = fact.label;
    const value = document.createElement('dd');
    const strong = document.createElement('strong'); strong.textContent = fact.value;
    const detail = document.createElement('span'); detail.textContent = fact.detail;
    value.append(strong, detail); item.append(term, value); facts.append(item);
  }
  explanation.append(explanationHeading, facts); fragment.append(explanation);

  const stageSection = document.createElement('section'); stageSection.className = 'workflow-stage-section';
  const stageHeading = document.createElement('div'); stageHeading.className = 'workflow-section-heading';
  const stageTitle = document.createElement('h3'); stageTitle.textContent = 'Ablauf und Freigabe-Gates';
  const stageText = document.createElement('p'); stageText.textContent = 'Jeder Schritt nennt Zustand, Begründung und beteiligte Werkzeuge.';
  stageHeading.append(stageTitle, stageText);
  const stages = document.createElement('ol'); stages.className = 'workflow-stages'; stages.setAttribute('aria-label', 'Aktueller Workflow in sieben Schritten');
  for (const entry of data.stages || []) {
    const item = document.createElement('li'); item.className = `workflow-stage ${stateClass(entry.state)}`;
    const head = document.createElement('div'); head.className = 'workflow-stage-head';
    const number = document.createElement('span'); number.className = 'workflow-stage-number'; number.textContent = String(entry.order);
    const stageName = document.createElement('h4'); stageName.textContent = entry.title;
    head.append(number, stageName, statusBadge(entry.state, entry.stateLabel));
    const stageSummary = document.createElement('strong'); stageSummary.className = 'workflow-stage-summary'; stageSummary.textContent = entry.summary;
    const stageReason = document.createElement('p'); stageReason.textContent = entry.reason;
    const toolList = document.createElement('div'); toolList.className = 'workflow-stage-tools'; toolList.setAttribute('aria-label', 'Beteiligte Werkzeuge');
    for (const tool of entry.tools || []) { const tag = document.createElement('span'); tag.textContent = tool; toolList.append(tag); }
    item.append(head, stageSummary, stageReason, toolList); stages.append(item);
  }
  stageSection.append(stageHeading, stages); fragment.append(stageSection);

  const toolSection = document.createElement('section'); toolSection.className = 'workflow-tool-section';
  const toolHeading = document.createElement('div'); toolHeading.className = 'workflow-section-heading';
  const toolTitle = document.createElement('h3'); toolTitle.textContent = 'Werkzeuge in diesem Workflow';
  const toolText = document.createElement('p'); toolText.textContent = '„Bei Bedarf“ bedeutet konfiguriert, aber nicht dauerhaft gestartet.';
  toolHeading.append(toolTitle, toolText); toolSection.append(toolHeading);
  const groups = [
    { title: 'Aktiv oder bereit', states: new Set(['active', 'ready', 'complete', 'review', 'attention']) },
    { title: 'Nur bei Bedarf', states: new Set(['standby', 'waiting']) },
    { title: 'Nicht eingeplant oder verfügbar', states: new Set(['not-required', 'not-used', 'blocked', 'unavailable']) },
  ];
  const groupContainer = document.createElement('div'); groupContainer.className = 'workflow-tool-groups';
  for (const group of groups) {
    const rows = (data.tools || []).filter((tool) => group.states.has(tool.state));
    if (!rows.length) continue;
    const groupElement = document.createElement('section'); groupElement.className = 'workflow-tool-group';
    const groupTitle = document.createElement('h4'); groupTitle.textContent = `${group.title} (${rows.length})`;
    const grid = document.createElement('div'); grid.className = 'workflow-tool-grid';
    for (const tool of rows) {
      const card = document.createElement('article'); card.className = `workflow-tool-card ${stateClass(tool.state)}`;
      const head = document.createElement('div'); head.className = 'workflow-tool-head';
      const nameBlock = document.createElement('div');
      const name = document.createElement('h5'); name.textContent = tool.name;
      const meta = document.createElement('span'); meta.textContent = `${tool.kind} · ${tool.scope}`;
      nameBlock.append(name, meta); head.append(nameBlock, statusBadge(tool.state, tool.stateLabel));
      const role = document.createElement('strong'); role.textContent = tool.role;
      const toolReason = document.createElement('p'); toolReason.textContent = tool.reason;
      card.append(head, role, toolReason); grid.append(card);
    }
    groupElement.append(groupTitle, grid); groupContainer.append(groupElement);
  }
  toolSection.append(groupContainer); fragment.append(toolSection);

  const policy = document.createElement('p'); policy.className = 'workflow-policy'; policy.textContent = data.policy?.explanation || '';
  fragment.append(policy);
  container.replaceChildren(fragment);
  container.setAttribute('aria-busy', 'false');
}
