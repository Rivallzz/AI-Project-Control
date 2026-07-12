# Architecture

AI Project Control separates durable project state from local operator state.

```text
Browser UI
  -> local Node server
     -> project registry and run history
     -> portfolio and attention state derived from local signals
     -> validated image attachments in the run root
     -> provider router
        -> Codex subscription
        -> Claude Code subscription
        -> Hermes + Ollama fallback
     -> Graphify index reader
     -> Obsidian project-area reader
     -> Git review API
        -> read-only status and diff
        -> explicitly confirmed commit
        -> explicitly confirmed non-force push
     -> versioned system catalog
        -> machine detection
        -> repository capability detection
```

## Ownership

- `server.js`: HTTP API, project registry, task dispatch, worktree isolation and inventory detection.
- `config/systems.json`: versioned system definitions, detection rules, capability mapping and reviewed installers.
- `public/`: local browser interface.
- `router/`: provider status, quota guards, routing and handoff packages.
- `Docs/`: canonical product and operating documentation.
- `%LOCALAPPDATA%\AI Project Control`: mutable machine state and logs.
- `%USERPROFILE%\Documents\AI-Runs`: persistent task packages, outputs and handoffs.

Image attachments are accepted only as PNG, JPEG, WebP or GIF, limited to four files and 15 MB total per task. The server decodes them into `_dashboard_tasks/<task-id>-attachments`, records a manifest and passes local file paths to the selected agent. Base64 payloads and attachments are never written into a project repository.

## Project contract

Each registered project has a repository path, a Graphify graph path and an Obsidian project path. Repository files remain authoritative. Graphify selects likely files; the agent must read those files directly. Obsidian stores working notes, prompts, run links and owner-approved lessons.

Write tasks receive a unique `ai/*` branch in an automatic worktree. The canonical checkout is never used as the write directory.

## Dynamic inventory

The server reads system definitions from `config/systems.json` and probes the current computer at runtime. Project capabilities are inferred from repository signals such as `project.godot`, package manifests, asset directories, workflow files and media files. Project-dependent tools are then labelled with the projects that use them. Adding a catalog entry or capability does not require editing `server.js`.

## Git boundary

The Git view is a review and publication surface, not an editor. Status and diff are read-only. A commit requires an explicit file selection, message and confirmation. Existing staged files outside the selection block the operation. Push is a separate confirmation and never uses force.
