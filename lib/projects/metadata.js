'use strict';

function safeId(value) {
  const base = String(value || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return base || 'project';
}

function projectDisplayName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('Project name must contain between 1 and 80 printable characters.');
  }
  return name;
}

function yamlScalar(value) {
  return JSON.stringify(String(value || ''));
}

module.exports = { safeId, projectDisplayName, yamlScalar };
