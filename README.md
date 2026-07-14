# AI Project Control

AI Project Control is a local, multi-project workspace for running controlled tasks through Codex, Claude Code and Hermes with Ollama while keeping project knowledge connected through Graphify, Serena and Obsidian.

## What it provides

- One chat-like task and feedback timeline per project.
- One compact Portfolio row per registered project with attention, execution, delivery and next-action state.
- Per-project provider routing with an operator-defined Codex, Claude Code and Hermes/Ollama order.
- Project-scoped task profiles (`Ausgewogen`, `Schnell`, `Qualität`, `Coding`) plus an advanced, exact per-provider model selection from a versioned catalog of detected Codex and Ollama models and reviewed Claude CLI aliases.
- A visible switch that disables subscription-token use and forces the local Hermes/Ollama path.
- Automatic isolated Git worktrees with semantic task branches, based on the project's integration branch (`develop` when present).
- Disposable, content-verified checkouts for every read-only provider attempt.
- Live provider, handoff and tool progress directly inside the project conversation, with technical output available on demand.
- A read-only current-workflow view that explains the active route, seven execution and Git gates, and why each installed tool is active, ready, on demand or unused.
- Unified Graphify relationship explorer and automatically loaded Obsidian working notes.
- Worktree-aware per-file Git review with branch-specific persisted commit suggestions and a guarded task-branch → integration-branch → `main` promotion path.
- Automatic local project provisioning with Git, documentation, Graphify and Obsidian.
- A read-only MCP Server view for Codex and Claude Code configuration, with local/remote, scope, activation, cost and health boundaries; machine diagnostics remain available separately.
- Symbol-level code navigation through Serena and compact quota handoffs through cli-continues.
- Dynamic machine inventory, project capability mapping and reviewed installers for missing local foundations.
- Source-bound, fingerprinted update checks with explicit one-use owner authorization and no silent maintenance.

## Cost boundary

The router accepts ChatGPT/Codex and Claude subscription authentication. It refuses OpenAI and Anthropic API-key billing paths. Ollama, Graphify, Obsidian, Hermes, ECC and MCP itself are local/open-source components; a third-party service connected through MCP can still have its own cost.

## Start

```powershell
.\Open-Dashboard.ps1
```

On a newly downloaded Windows setup, run `bootstrap.ps1` first. It checks the three foundations needed to launch and route work: Node.js LTS, Git and PowerShell 7.

The dashboard listens only on `http://127.0.0.1:8765`.

Runtime state is stored under `%LOCALAPPDATA%\AI Project Control`; task runs under `%USERPROFILE%\Documents\AI-Runs`; automatic worktrees under `%USERPROFILE%\Documents\AI-Worktrees`.

## Documentation

- `Docs/ARCHITECTURE.md`
- `Docs/PROVIDER_POLICY.md`
- `Docs/INTEGRATIONS.md`
- `Docs/OPERATIONS.md`
- `Docs/CONTEXT_BUDGET.md`
- `Docs/DESIGN_SYSTEM.md`
- `Docs/ECOSYSTEM_REVIEW.md`
- `Docs/INTEGRATION_LIFECYCLE.md`
- `Docs/HERMES_ORCHESTRATION.md`
