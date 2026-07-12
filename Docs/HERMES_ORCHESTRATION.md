# Hermes Orchestration

Hermes is the controlled local orchestrator. It plans and executes a bounded task with the repository's agent rules, Graphify discovery, Serena code navigation, direct source reads and a project skill. Ollama supplies the local model; Hermes supplies the workflow and tools.

## Start From The Dashboard

Choose `Hermes lokal (Read-only, experimentell)` only for an isolated local experiment, or turn off `Codex-/Claude-Kontingent verwenden` to force the same local path. `Auto` continues to prefer Codex and Claude before Hermes. Local Hermes write tasks are blocked until the read-only instruction-adherence gate passes.

The normal chat field is sufficient. AI Project Control adds project path, mode, Graphify path, Obsidian path, reviewed memory and system state to the task package.

## A Good Assignment

Describe:

- **Goal** - the finished result.
- **Non-goals** - nearby work that must stay untouched.
- **Acceptance** - observable completion criteria.
- **Validation** - tests or checks that must pass.
- **Owner gates** - decisions Hermes must return instead of making.

Example:

```text
Goal: Review the current terrain-layer import code and identify the smallest safe next implementation step.
Non-goals: No gameplay changes, no asset regeneration and no commits.
Acceptance: Cite the authoritative Polis documents and exact code symbols; report risks and one next action.
Validation: Read-only; repository status must remain unchanged.
Owner gate: Stop if a new permanent art or gameplay decision is required.
```

## Controlled Flow

1. Read `AGENTS.md` and required owner documents.
2. Check Git status and task mode.
3. Use Graphify to narrow repository context.
4. Use Serena only for relevant code symbols and references.
5. Read the selected original files.
6. Execute the project skill and required checks.
7. Write results into the external AI Run directory.
8. Return risks, open gates and the next recommendation.
9. Stop for human approval.

## Safety Boundary

Hermes has no autostart, scheduler or unattended loop in this setup. It must not select work from `CURRENT_TASK.md`, commit, push, merge, approve assets or resolve permanent design decisions without an explicit owner instruction. Local read-only runs execute in disposable detached worktrees; any attempted write fails the run and the isolated worktree is removed.

Use Codex or Claude for high-risk implementation and independent review while their subscription quota is available. Use Hermes directly for local preflight, focused analysis, repeatable orchestration and low-risk work where the local model is sufficient.

The Serena MCP connection and local tool startup are operational. The local `polis-coder` model must still prove consistent multi-step instruction adherence before Hermes/Ollama is treated as an autonomous production orchestrator. The router therefore requires an explicit completion sentinel and stops safely when the model returns early.

## Current Validation

- PASS: Hermes starts locally through Ollama at $0 API cost.
- PASS: Serena starts inside Hermes, activates the current repository and exposes 13 selected symbol/diagnostic tools.
- PASS: The dashboard receives job events through a local server-sent-event stream instead of waiting for periodic refreshes.
- PASS: Local read-only runs use disposable Git worktrees, and the active Polis worktree is clean after validation.
- PASS: The router rejects an early model response without the completion sentinel.
- FAIL: `polis-coder` stopped after a directory listing in a two-file read-only task and omitted the completion sentinel.
- FAIL SAFELY: In a separate validation it attempted writes despite ReadOnly mode. The router detected the violation, the affected active files were restored, and subsequent local runs are isolated from the active worktree.
- LIMITATION: Use the explicit Hermes option only for observation of isolated read-only experiments. Codex and Claude remain the approved production providers.
