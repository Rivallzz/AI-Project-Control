# Current Task

Improve or replace the local Hermes model/tool-calling profile until a two-file read-only task follows every instruction and reaches the required completion sentinel. Keep local Hermes write tasks disabled and read-only runs isolated in disposable worktrees until that gate passes. Serena, cli-continues, Flux detection and the real-time dashboard event stream are operational.

The Git review surface now discovers project worktrees directly from Git and defaults to the latest changed task worktree. Write tasks branch from `develop` when present. The owner can inspect and commit the isolated task, fast-forward a clean non-divergent task branch into the clean integration checkout, then push only the integration branch. Direct task-branch promotion to `main` is outside the supported flow.

The dashboard now exposes running tasks across projects in a global sidebar tracker backed by the existing real-time event stream. Product readiness remains pre-1.0 while the controlled local Hermes instruction-adherence gate above is open.
