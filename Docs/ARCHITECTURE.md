# Architecture

AI Project Control separates durable project state from local operator state.

Provider runs have three explicit terminal outcomes: completed, controlled blocked and failed. A valid `AI_PROJECT_TASK_BLOCKED` response remains non-successful, but its reason is preserved instead of being misreported as a missing completion marker.

```text
Browser UI
  -> local Node server
     -> loopback, same-origin and JSON request boundary
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
     -> read-only MCP inventory API
        -> Codex global and project TOML configuration
        -> Claude global and project JSON configuration
        -> redacted normalized server contracts without process startup
     -> read-only current-workflow projection
        -> current form route or authoritative running job
        -> explicit reasons for context, route, agent and Git gates
        -> capability-gated CLI, provider and MCP tool roles
     -> Git review API
        -> compact status plus on-demand per-file diff
        -> explicitly confirmed commit
        -> explicitly confirmed non-force push
     -> versioned system catalog
        -> official sources and one-to-one package bindings
        -> machine detection
        -> repository capability detection
        -> short-lived, fingerprinted update authorization
```

## Ownership

- `server.js`: HTTP API orchestration, project registry, task dispatch and Git workflow.
- `lib/http`, `lib/projects` and `lib/runtime`: request boundaries, project metadata and serialized atomic state writes.
- `lib/systems`: catalog validation, source-specific checks, authorization, maintenance serialization and cancellation policy.
- `lib/integrations/mcp-inventory.js`: read-only Codex/Claude MCP configuration parsing, redaction and normalized integration contracts.
- `lib/workflow/current-workflow.js`: pure, read-only projection of the current workflow, its reasons, delivery gates and capability-gated tool participation.
- `config/systems.json`: versioned sources, package identities, system detection and capability mapping.
- `public/app.js`: browser orchestration; `public/modules/` owns project-scoped request, conversation state and the current-workflow renderer.
- `router/`: provider status, quota guards, routing and handoff packages.
- `Docs/`: canonical product and operating documentation.
- `%LOCALAPPDATA%\AI Project Control`: mutable machine state and logs.
- `%USERPROFILE%\Documents\AI-Runs`: persistent task packages, outputs and handoffs.

Image attachments are accepted only as PNG, JPEG, WebP or GIF, limited to four files and 15 MB total per task. The server decodes them into `_dashboard_tasks/<task-id>-attachments`, records a manifest and passes local file paths to the selected agent. Base64 payloads and attachments are never written into a project repository.

## Project contract

Each registered project has a repository path, a Graphify graph path and an Obsidian project path. Repository files remain authoritative. Graphify selects likely files; the agent must read those files directly. Obsidian stores working notes, prompts, run links and owner-approved lessons.

Serena is global but project-activated. Its caches and project metadata live under `%LOCALAPPDATA%\AI Project Control\serena-projects`, not inside repositories. It is used after Graphify has narrowed a code task, when symbol lookup or reference navigation avoids broad file reads.

The local Hermes adapter receives the complete bounded execution prompt directly. It does not depend on the local model deciding to open an external prompt file. A 24,000-character guard keeps the invocation below the Windows command-line budget; larger local tasks must be narrowed or use Codex/Claude.

Every read-only provider attempt runs in a disposable detached checkout. The router copies the current tracked and untracked, non-ignored project content plus the rebuildable Graphify index into that checkout, records a content manifest, verifies it after execution and removes the checkout in a `finally` path. Any content change blocks the attempt even when `git status` alone would not reveal it. The canonical checkout is never the read-only provider working directory.

Execution preferences are local, project-scoped browser state. Inside the workspace, immediately left of the chat, the operator first chooses a task profile (`Ausgewogen`, `Schnell`, `Qualität` or `Coding`) and may then disclose the advanced route to enable providers, choose the provider used first and select one exact model for each provider. Profiles resolve to concrete catalog IDs; when local metadata does not justify a specialized choice, they deliberately retain the provider's safe default instead of inferring capability from a model name. The remaining active providers form the visible fallback chain.

The server owns a versioned model catalog and validates every active model against current provider availability before it creates a task process or worktree. Catalog entries expose a technical ID, display name, provider, description, capability tags, recommended uses, known context window, speed class, privacy location, availability and deprecation state. Codex metadata comes from the local Codex cache, Ollama installations from `ollama list`, and Claude aliases from the reviewed server catalog. Each Ollama entry is additionally checked through `ollama show`; only models that report the `completion` capability become executable chat models, while names never prove a role or capability by themselves. The same exact model map is recorded in the task package, passed to the router and returned in execution history without a prompt-optimization call. Project switches and catalog refreshes are generation-guarded so an older response cannot overwrite the active project's choice. Write mode excludes Hermes/Ollama until its write-safety gate is approved.

Write tasks receive a unique semantic `ai/*` branch in an automatic worktree based on the project's integration branch. Deterministic intent and subject terms replace conversational prompt openings; after successful execution the provider may refine the branch to a concise implemented-outcome name without another LLM call. A local `develop` branch is preferred when present; otherwise the repository's default branch is used. The canonical checkout is never used as the write directory.

## Dynamic inventory

The server reads system definitions from `config/systems.json` and probes the current computer at runtime. Project capabilities are inferred from explicit `.ai-project-control.json` declarations and bounded repository signals such as `project.godot`, package manifests, asset workflow files and media files. A generic asset directory alone does not activate image generation. Project-dependent tools are then labelled with the projects that use them. Adding a catalog entry or capability does not require editing `server.js`.

Update checks follow the same catalog boundary. Each updateable system references exactly one package, and each package references one catalogued official source. Winget checks are source-pinned and batched, npm checks use the exact package and registry, and Git checks verify remote identity plus `behind/current/ahead/diverged`. Results are cached under `%LOCALAPPDATA%\AI Project Control\system-updates.json`, bound to catalog and package fingerprints and expire after six hours. `Neu prüfen` bypasses the cache. The confirmed update consumes a one-use authorization and derives its command from the current catalog; catalog changes, stale evidence, source mismatches, dirty Git tools and non-fast-forward Git states fail closed. Mutating maintenance jobs are serialized and cannot be killed once their package manager is running.

Catalog entries may also declare workflow role, activation and cost policy. These fields make the difference between software that is merely detected and an integration that has a bounded place in the workflow.

## MCP inventory boundary

`GET /api/mcp` reads the selected project's effective local MCP configuration surface without launching a configured command or contacting a remote endpoint. It combines the global Codex `~/.codex/config.toml`, project `.codex/config.toml`, global Claude `~/.claude.json`, the selected Claude project entry and project `.mcp.json`. Other Claude project registrations are excluded from the selected-project response.

Rows state client, scope, STDIO/HTTP transport, safe start target, activation, cost boundary, explicit tool filters and configured timeouts. URL credentials, query values, environment values and header values never enter the response; only environment or header names may be shown. A detected row therefore says `konfiguriert`, not `verbunden`: live health belongs to the owning MCP client and is not inferred by starting arbitrary commands from the dashboard.

## Git boundary

The Git view is a review and publication surface, not an editor. It discovers every worktree registered with the selected project directly from Git, defaults to the latest changed task worktree and allows the owner to switch explicitly between task worktrees and the integration checkout. Status is compact and a read-only diff is loaded only for the file the owner opens. Checkboxes are reserved for commit selection. Commit and push commands run in the selected worktree, never silently in another checkout.

Each branch owns one local commit-message draft under `%LOCALAPPDATA%\AI Project Control\git-drafts.json`. Write tasks start with a deterministic fallback and successful providers return a more precise suggestion as delivery metadata. User edits are saved by project and branch, survive worktree switching, and are removed after commit or branch cleanup. Drafts never enter project repositories.

Changed PNG, JPEG, WebP and GIF files are previewed through a bounded local-only endpoint after the requested path is verified against the selected worktree's current Git status. The endpoint never exposes arbitrary repository files. Clean `ai/*` worktrees that Git proves are already ancestors of the integration branch are offered as explicit cleanup candidates; dirty or unmerged branches are never included.

Promotion follows one visible path: task branch → integration branch → `main`. When no separate integration branch exists, `main` is the explicit integration target. After a task branch is clean and committed, the dashboard may fast-forward it into the clean target checkout. It refuses divergent history and never starts a conflict-producing merge. Pushing the target branch remains a separate owner action; with a separate integration branch, promotion from there to `main` remains a reviewed pull request outside automatic task execution. Existing staged files outside the selection block the operation. Push never uses force. A clean task branch already contained in the target can be finalized by removing only its worktree and local branch. Any remote task branch is deliberately preserved; remote deletion needs a separate action with an unchanged remote-OID lease and is not part of integration.

## Portfolio and project state

The Portfolio view derives one compact row for every registered project and highlights the globally selected project. Each row combines execution state, delivery state, current repository task, latest run, Git state, Graphify freshness, Obsidian note count, attention items and one recommended next action. The global dropdown remains the primary switcher; portfolio actions use the same selection operation rather than maintaining a second registry.

The compact global activity control prioritizes running work in other projects and then recent completed, blocked or failed work that still needs acknowledgement. Opening it switches to the relevant project conversation. Active provider phases, the latest meaningful activity, start/update timestamps and a short event timeline render as the current assistant response; full technical output is progressively disclosed inside that response instead of occupying a second feed column. While a run directory exists but has no terminal routing result, its owning live or recovered job remains authoritative. An orphaned incomplete directory is labelled `unvollständig` and never presented as active work. Conversation scrolling follows new output only while the operator remains near the bottom; manual upward scrolling suspends following until the operator explicitly returns to the newest content.

Jobs persist outside the repository with bounded logs. A dashboard restart reloads terminal jobs and converts interrupted `running` or `stopping` records into explicit failed/interrupted history. Execution state and delivery state remain separate so a successful analysis is not mislabeled as an unpublished code change.

## Current workflow projection

`GET /api/workflow` combines the selected project, the visible execution settings, bounded job snapshots, component health, the redacted MCP inventory and—only for a completed write task—the relevant Git state. A running task is authoritative and overrides form changes made after it started. Without a running or still-open write task, the projection explains the current workspace configuration instead of assigning unrelated repository changes to a new workflow.

The projection is deliberately deterministic and read-only. It contains safe names and reasons, but no task body, raw logs, local paths, MCP start targets, arguments, environment values or credentials. It does not start an MCP server or provider and cannot cross the independent commit, integration or push owner gates. The browser renders the seven linear stages as text-rich cards so the same meaning remains accessible without relying on color or a graph layout.
