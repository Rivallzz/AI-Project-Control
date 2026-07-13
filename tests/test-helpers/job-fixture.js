'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createRepository } = require('./git-fixture');
const { postJson, requestJson, waitFor } = require('./http-client');

async function defaultProject(baseUrl) {
  const response = await requestJson(baseUrl, '/api/projects');
  if (response.status !== 200) throw new Error(`Could not load projects: ${response.status}`);
  return response.body.projects.find((project) => project.id === response.body.activeProjectId) || response.body.projects[0];
}

async function createCompletedDashboardJob(server, name = 'RecoveryProject') {
  const fixture = await createRepository(server.root);
  await fs.mkdir(path.join(fixture.repository, 'graphify-out'), { recursive: true });
  await fs.writeFile(path.join(fixture.repository, 'graphify-out', 'graph.json'), '{"nodes":[],"edges":[]}', 'utf8');
  const project = await defaultProject(server.baseUrl);
  const response = await postJson(server.baseUrl, '/api/tasks', {
    projectId: project.id,
    task: `Projekt "${fixture.repository}" hinzufugen`,
    provider: 'Ollama',
    providerOrder: ['Ollama'],
    mode: 'ReadOnly',
    useSubscriptionTokens: false,
  });
  if (response.status !== 202) throw new Error(`Could not create dashboard job: ${response.status} ${JSON.stringify(response.body)}`);
  const job = await waitFor(async () => {
    const jobs = await requestJson(server.baseUrl, '/api/jobs');
    return jobs.body.find((candidate) => candidate.id === response.body.id && candidate.status !== 'running') || null;
  }, { description: 'dashboard job completion' });
  return { fixture, job };
}

module.exports = { createCompletedDashboardJob, defaultProject };
