# Architecture

AI Project Control separates durable project state from local operator state.

Provider runs have three explicit terminal outcomes: completed, controlled blocked and failed. A valid `AI_PROJECT_TASK_BLOCKED` response remains non-successful, but its reason is preserved instead of being misreported as a missing completion marker.

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
        -> cli-continues minimal session extract on verified quota handoff
     -> Graphify index reader
     -> Serena MCP for on-demand symbol-level code navigation
     -> Obsidian project-area reader
     -> Git review API
        -> compact status plus on-demand per-file diff
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

Serena is global but project-activated. Its caches and project metadata live under `%LOCALAPPDATA%\AI Project Control\serena-projects`, not inside repositories. It is used after Graphify has narrowed a code task, when symbol lookup or reference navigation avoids broad file reads.

The local Hermes adapter receives the complete bounded execution prompt directly. It does not depend on the local model deciding to open an external prompt file. A 24,000-character guard keeps the invocation below the Windows command-line budget; larger local tasks must be narrowed or use Codex/Claude.

Write tasks receive a unique `ai/*` branch in an automatic worktree based on the project's integration branch. A local `develop` branch is preferred when present; otherwise the repository's default branch is used. The canonical checkout is never used as the write directory.

## Dynamic inventory

The server reads system definitions from `config/systems.json` and probes the current computer at runtime. Project capabilities are inferred from repository signals such as `project.godot`, package manifests, asset directories, workflow files and media files. Project-dependent tools are then labelled with the projects that use them. Adding a catalog entry or capability does not require editing `server.js`.

Catalog entries may also declare workflow role, activation and cost policy. These fields make the difference between software that is merely detected and an integration that has a bounded place in the workflow.

## Git boundary

The Git view is a review and publication surface, not an editor. It discovers every worktree registered with the selected project directly from Git, defaults to the latest changed task worktree and allows the owner to switch explicitly between task worktrees and the integration checkout. Status is compact and a read-only diff is loaded only for the file the owner opens. Checkboxes are reserved for commit selection. Commit and push commands run in the selected worktree, never silently in another checkout.

Changed PNG, JPEG, WebP and GIF files are previewed through a bounded local-only endpoint after the requested path is verified against the selected worktree's current Git status. The endpoint never exposes arbitrary repository files. Clean `ai/*` worktrees that Git proves are already ancestors of the integration branch are offered as explicit cleanup candidates; dirty or unmerged branches are never included.

Promotion follows one visible path: task branch → integration branch → `main`. When no separate integration branch exists, `main` is the explicit integration target. After a task branch is clean and committed, the dashboard may fast-forward it into the clean target checkout. It refuses divergent history and never starts a conflict-producing merge. Pushing the target branch remains a separate owner action; with a separate integration branch, promotion from there to `main` remains a reviewed pull request outside automatic task execution. Existing staged files outside the selection block the operation. Push never uses force. A clean task branch already contained in the target can be finalized without merging again, removing its worktree and local branch plus its remote branch when present.

## Active project overview

The Portfolio view derives one overview for the project selected in the global dropdown. It combines the current repository task, latest run, Git state, Graphify freshness, Obsidian note count, blockers and one recommended next action. It does not duplicate project switching or maintain a second project list.

The compact global activity control prioritizes running work in other projects and then recent completed, blocked or failed work that still needs acknowledgement. Opening it switches to the relevant project conversation. Conversation and live-feed scrolling follow new output only while the operator remains near the bottom; manual upward scrolling suspends following until the operator explicitly returns to the newest content.
