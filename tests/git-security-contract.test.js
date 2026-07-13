'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { createRepository, createTaskWorktree, remoteBranchExists } = require('./test-helpers/git-fixture');
const { postJson, requestJson } = require('./test-helpers/http-client');
const { createSandbox, removeSandbox, startServer } = require('./test-helpers/server-harness');

let fixture;
let project;
let root;
let server;

before(async () => {
  root = await createSandbox();
  server = await startServer({ root });
  fixture = await createRepository(root, { remote: true });
  const registered = await postJson(server.baseUrl, '/api/projects', {
    name: 'Git Security Contract',
    repository: fixture.repository,
    graphPath: path.join(fixture.repository, 'graphify-out', 'graph.json'),
    obsidianPath: path.join(root, 'obsidian', 'Git Security Contract'),
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  project = registered.body;
});

after(async () => {
  await server?.stop();
  if (root) await removeSandbox(root);
});

async function createEscapingLinkOrSkip(t, target, fileLink, junctionLink) {
  try {
    await fs.symlink(target, fileLink, 'file');
    return { cleanupPath: fileLink, gitPath: path.basename(fileLink) };
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      try {
        await fs.symlink(path.dirname(target), junctionLink, 'junction');
        return { cleanupPath: junctionLink, gitPath: `${path.basename(junctionLink)}/${path.basename(target)}` };
      } catch (junctionError) {
        if (junctionError.code === 'EPERM' || junctionError.code === 'EACCES') {
          t.skip(`File symlinks and directory junctions are unavailable: ${junctionError.code}`);
          return null;
        }
        throw junctionError;
      }
    }
    throw error;
  }
}

test('the Git text-diff endpoint never follows a changed symlink outside the worktree', async (t) => {
  const secret = 'outside-worktree-secret-4d9ac1';
  const outside = path.join(root, 'outside-text');
  const target = path.join(outside, 'outside-secret.txt');
  const fileLink = path.join(fixture.repository, 'linked-secret.txt');
  const junctionLink = path.join(fixture.repository, 'linked-secret-dir');
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(target, secret, 'utf8');
  const link = await createEscapingLinkOrSkip(t, target, fileLink, junctionLink);
  if (!link) return;
  try {
    const response = await requestJson(
      server.baseUrl,
      `/api/git/diff?projectId=${encodeURIComponent(project.id)}&worktree=${encodeURIComponent(fixture.repository)}&path=${encodeURIComponent(link.gitPath)}`,
    );
    assert.equal(response.status, 400);
    assert.equal(JSON.stringify(response.body).includes(secret), false);
  } finally {
    await fs.unlink(link.cleanupPath).catch(() => {});
  }
});

test('local integration preserves the remote task branch for a separate confirmed cleanup', async () => {
  const task = await createTaskWorktree(fixture);
  assert.equal(await remoteBranchExists(fixture.remotePath, task.branch), true);

  const state = await requestJson(
    server.baseUrl,
    `/api/git?projectId=${encodeURIComponent(project.id)}&worktree=${encodeURIComponent(task.worktree)}`,
  );
  assert.equal(state.status, 200, JSON.stringify(state.body));
  assert.equal(state.body.integration.canFastForward, true, state.body.integration.reason);

  const integrated = await postJson(server.baseUrl, '/api/git/integrate', {
    projectId: project.id,
    worktree: task.worktree,
  });
  assert.equal(integrated.status, 200, JSON.stringify(integrated.body));
  assert.equal(integrated.body.deletedRemoteBranch, false);
  assert.equal(await remoteBranchExists(fixture.remotePath, task.branch), true);
});

test('the Git image endpoint never follows a changed symlink outside the worktree', async (t) => {
  const outside = path.join(root, 'outside-image');
  const target = path.join(outside, 'outside.png');
  const fileLink = path.join(fixture.repository, 'linked.png');
  const junctionLink = path.join(fixture.repository, 'linked-image-dir');
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(target, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
  const link = await createEscapingLinkOrSkip(t, target, fileLink, junctionLink);
  if (!link) return;
  try {
    let response;
    try {
      response = await fetch(
        `${server.baseUrl}/api/git/image?projectId=${encodeURIComponent(project.id)}&worktree=${encodeURIComponent(fixture.repository)}&path=${encodeURIComponent(link.gitPath)}`,
      );
    } catch (error) {
      const logs = server.logs();
      assert.fail(`Git image request terminated the server: ${error.message}\nstdout:\n${logs.stdout}\nstderr:\n${logs.stderr}`);
    }
    assert.equal(response.status, 400);
  } finally {
    await fs.unlink(link.cleanupPath).catch(() => {});
  }
});
