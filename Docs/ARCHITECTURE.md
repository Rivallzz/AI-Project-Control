# Architecture

AI Project Control separates durable project state from local operator state.

```text
Browser UI
  -> local Node server
     -> project registry and run history
     -> provider router
        -> Codex subscription
        -> Claude Code subscription
        -> Hermes + Ollama fallback
     -> Graphify index reader
     -> Obsidian project-area reader
```

## Ownership

- `server.js`: HTTP API, project registry, task dispatch, worktree isolation and system inventory.
- `public/`: local browser interface.
- `router/`: provider status, quota guards, routing and handoff packages.
- `Docs/`: canonical product and operating documentation.
- `%LOCALAPPDATA%\AI Project Control`: mutable machine state and logs.
- `%USERPROFILE%\Documents\AI-Runs`: persistent task packages, outputs and handoffs.

## Project contract

Each registered project has a repository path, a Graphify graph path and an Obsidian project path. Repository files remain authoritative. Graphify selects likely files; the agent must read those files directly. Obsidian stores working notes, prompts, run links and owner-approved lessons.

Write tasks receive a unique `ai/*` branch in an automatic worktree. The canonical checkout is never used as the write directory.

