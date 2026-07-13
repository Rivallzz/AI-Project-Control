# Current Task

Improve or replace the local Hermes model/tool-calling profile until a two-file read-only task follows every instruction and reaches the required completion sentinel. Keep local Hermes write tasks disabled and read-only runs isolated in disposable worktrees until that gate passes. Serena, cli-continues, Flux detection and the real-time dashboard event stream are operational.

The Git review surface discovers project worktrees directly from Git and defaults to the latest changed task worktree. Write tasks branch from `develop` when present and otherwise from the default branch. The owner can inspect and commit the isolated task, then safely fast-forward it into `develop` or, when no separate integration branch exists, explicitly into `main`.

After a successful fast-forward, the dashboard removes the task worktree and safely deletes the integrated local task branch. If that task branch exists on `origin`, the remote branch is deleted as part of the same confirmed action. An already-integrated clean task branch exposes the same cleanup as a separate action. Completed runs are labelled `Aufgabe abgeschlossen` with an explicit review next step.

Provider results now distinguish completed, controlled blocked and failed runs. A valid blocked sentinel keeps the task non-successful while preserving its concrete reason in the dashboard instead of reporting a missing completion marker.

Project switching now reloads the currently visible project view. In particular, `Prüfen & Git` clears and disables the previous repository state before loading the selected project's worktrees and changes.

Git review now separates uncommitted status from ancestry, previews changed image files and offers confirmed bulk cleanup only for clean task worktrees already contained in the integration branch. Cross-project activity reports recent completion as an actionable review state. Chat and live-feed auto-follow stop when the owner intentionally scrolls away from the newest content.

The project workspace now uses one chat-centred timeline. Active provider phases, focused tool events and stop control appear directly in the current assistant response; verbose technical output remains available through progressive disclosure. The separate live-feed column no longer competes with the conversation.

Write tasks now use semantic outcome-oriented branch titles instead of truncating conversational prompts. Each task branch carries a locally persisted commit-message draft that is initialized deterministically, refined from the successful provider response, restored when switching worktrees and cleared after commit or cleanup.

The workspace stores a separate execution profile for each project. The execution panel now sits inside the workspace directly left of the chat instead of in the global sidebar. The owner enables Codex, Claude Code and Hermes/Ollama, chooses the provider used first with one control, sees the resulting fallback chain, selects a detected model per provider and chooses read-only or write mode. The local model catalog can be refreshed without restarting the dashboard. The selected route and models are validated, written into the task package and honored by quota handoff. Codex status parsing tolerates telemetry that omits the secondary reset window.
