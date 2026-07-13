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
- `config/systems.json`: versioned system definitions, detection rules, capability mapping plus reviewed install and update routes.
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

Execution preferences are local, project-scoped browser state. The operator can enable providers, reorder the fallback chain and select one model for each provider. The server validates the route and model names, records them in the task package and passes them to the router without a prompt-optimization call. Codex models are discovered from the local Codex cache, Ollama chat models from `ollama list`, and Claude exposes its stable CLI aliases. Write mode excludes Hermes/Ollama until its write-safety gate is approved.

Write tasks receive a unique semantic `ai/*` branch in an automatic worktree based on the project's integration branch. Deterministic intent and subject terms replace conversational prompt openings; after successful execution the provider may refine the branch to a concise implemented-outcome name without another LLM call. A local `develop` branch is preferred when present; otherwise the repository's default branch is used. The canonical checkout is never used as the write directory.

## Dynamic inventory

The server reads system definitions from `config/systems.json` and probes the current computer at runtime. Project capabilities are inferred from repository signals such as `project.godot`, package manifests, asset directories, workflow files and media files. Project-dependent tools are then labelled with the projects that use them. Adding a catalog entry or capability does not require editing `server.js`.

Update checks follow the same catalog boundary. Supported entries declare both an official `updateCheck` source and an allowlisted `update` command; neither half is accepted alone. Winget checks are batched, npm and Git checks target the exact catalog entry, and results are cached under `%LOCALAPPDATA%\AI Project Control\system-updates.json` for six hours. Project loading starts a background check against this cache. `Neu prüfen` bypasses it. Updates never run from a check: the owner must confirm the visible `Update` action, which then appears as a normal local setup job in the project conversation. Tools without a safe reviewed route remain detectable but cannot be updated from the dashboard.

Catalog entries may also declare workflow role, activation and cost policy. These fields make the difference between software that is merely detected and an integration that has a bounded place in the workflow.

## Git boundary

The Git view is a review and publication surface, not an editor. It discovers every worktree registered with the selected project directly from Git, defaults to the latest changed task worktree and allows the owner to switch explicitly between task worktrees and the integration checkout. Status is compact and a read-only diff is loaded only for the file the owner opens. Checkboxes are reserved for commit selection. Commit and push commands run in the selected worktree, never silently in another checkout.

Each branch owns one local commit-message draft under `%LOCALAPPDATA%\AI Project Control\git-drafts.json`. Write tasks start with a deterministic fallback and successful providers return a more precise suggestion as delivery metadata. User edits are saved by project and branch, survive worktree switching, and are removed after commit or branch cleanup. Drafts never enter project repositories.

Changed PNG, JPEG, WebP and GIF files are previewed through a bounded local-only endpoint after the requested path is verified against the selected worktree's current Git status. The endpoint never exposes arbitrary repository files. Clean `ai/*` worktrees that Git proves are already ancestors of the integration branch are offered as explicit cleanup candidates; dirty or unmerged branches are never included.

Promotion follows one visible path: task branch → integration branch → `main`. When no separate integration branch exists, `main` is the explicit integration target. After a task branch is clean and committed, the dashboard may fast-forward it into the clean target checkout. It refuses divergent history and never starts a conflict-producing merge. Pushing the target branch remains a separate owner action; with a separate integration branch, promotion from there to `main` remains a reviewed pull request outside automatic task execution. Existing staged files outside the selection block the operation. Push never uses force. A clean task branch already contained in the target can be finalized without merging again, removing its worktree and local branch plus its remote branch when present.

## Active project overview

The Portfolio view derives one overview for the project selected in the global dropdown. It combines the current repository task, latest run, Git state, Graphify freshness, Obsidian note count, blockers and one recommended next action. It does not duplicate project switching or maintain a second project list.

The compact global activity control prioritizes running work in other projects and then recent completed, blocked or failed work that still needs acknowledgement. Opening it switches to the relevant project conversation. Active provider phases and a short event timeline render as the current assistant response; full technical output is progressively disclosed inside that response instead of occupying a second feed column. Conversation scrolling follows new output only while the operator remains near the bottom; manual upward scrolling suspends following until the operator explicitly returns to the newest content.
