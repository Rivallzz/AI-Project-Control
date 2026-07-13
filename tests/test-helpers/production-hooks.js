'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { REPOSITORY_ROOT } = require('./server-harness');

async function loadBrowserModule(relativePath) {
  const modulePath = path.join(REPOSITORY_ROOT, relativePath);
  try {
    const source = await fs.readFile(modulePath, 'utf8');
    return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function loadUiStateHooks() {
  const [requestState, projectUiState] = await Promise.all([
    loadBrowserModule(path.join('public', 'modules', 'request-state.js')),
    loadBrowserModule(path.join('public', 'modules', 'project-ui-state.js')),
  ]);
  return requestState || projectUiState ? { ...requestState, ...projectUiState } : null;
}

module.exports = { loadBrowserModule, loadUiStateHooks };
