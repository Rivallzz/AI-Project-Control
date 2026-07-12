# Current Task

Improve or replace the local Hermes model/tool-calling profile until a two-file read-only task follows every instruction and reaches the required completion sentinel. Keep local Hermes write tasks disabled and read-only runs isolated in disposable worktrees until that gate passes. Serena, cli-continues, Flux detection and the real-time dashboard event stream are operational.

The Git review surface now discovers project worktrees directly from Git and defaults to the latest changed task worktree. Write tasks branch from `develop` when present. The owner can inspect and commit the isolated task, fast-forward a clean non-divergent task branch into the clean integration checkout, then push only the integration branch. Direct task-branch promotion to `main` is outside the supported flow.

After a successful task-to-integration fast-forward, the dashboard removes the task worktree and safely deletes the integrated local task branch. If that task branch exists on `origin`, the remote branch is deleted as part of the same confirmed action.
