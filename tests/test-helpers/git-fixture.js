'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const GIT = process.platform === 'win32' ? 'git.exe' : 'git';

function git(args, { cwd, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    execFile(GIT, args, { cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const result = { exitCode: error?.code && Number.isInteger(error.code) ? error.code : error ? 1 : 0, stdout, stderr };
      if (error && !allowFailure) {
        reject(new Error(`git ${args.join(' ')} failed.\n${stderr || stdout || error.message}`));
      } else {
        resolve(result);
      }
    });
  });
}

async function createRepository(root, { remote = false } = {}) {
  const repository = path.join(root, `repository-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const remotePath = remote ? path.join(root, `remote-${Date.now()}-${Math.random().toString(16).slice(2)}.git`) : null;
  await fs.mkdir(repository, { recursive: true });
  if (remotePath) await git(['init', '--bare', remotePath]);
  await git(['init', '-b', 'main'], { cwd: repository });
  await git(['config', 'user.name', 'AI Project Control Test'], { cwd: repository });
  await git(['config', 'user.email', 'test@localhost'], { cwd: repository });
  await fs.writeFile(path.join(repository, 'README.md'), '# Local test repository\n', 'utf8');
  await git(['add', 'README.md'], { cwd: repository });
  await git(['commit', '-m', 'Initialize local test repository'], { cwd: repository });
  if (remotePath) {
    await git(['remote', 'add', 'origin', remotePath], { cwd: repository });
    await git(['push', '-u', 'origin', 'main'], { cwd: repository });
  }
  return { remotePath, repository };
}

async function createTaskWorktree(fixture, branch = 'ai/security-contract') {
  const worktree = path.join(path.dirname(fixture.repository), `worktree-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await git(['worktree', 'add', '-b', branch, worktree, 'main'], { cwd: fixture.repository });
  await fs.writeFile(path.join(worktree, 'task-change.txt'), 'local task branch change\n', 'utf8');
  await git(['add', 'task-change.txt'], { cwd: worktree });
  await git(['commit', '-m', 'Add local task branch change'], { cwd: worktree });
  if (fixture.remotePath) await git(['push', '-u', 'origin', branch], { cwd: worktree });
  return { branch, worktree };
}

async function remoteBranchExists(remotePath, branch) {
  const result = await git(['--git-dir', remotePath, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { allowFailure: true });
  return result.exitCode === 0;
}

module.exports = { createRepository, createTaskWorktree, git, remoteBranchExists };
