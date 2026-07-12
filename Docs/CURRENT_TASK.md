# Current Task

Improve or replace the local Hermes model/tool-calling profile until a two-file read-only task follows every instruction and reaches the required completion sentinel. Keep local Hermes write tasks disabled and read-only runs isolated in disposable worktrees until that gate passes. Serena, cli-continues, Flux detection and the real-time dashboard event stream are operational.

The Git review surface discovers project worktrees directly from Git and defaults to the latest changed task worktree. Write tasks branch from `develop` when present and otherwise from the default branch. The owner can inspect and commit the isolated task, then safely fast-forward it into `develop` or, when no separate integration branch exists, explicitly into `main`.

After a successful fast-forward, the dashboard removes the task worktree and safely deletes the integrated local task branch. If that task branch exists on `origin`, the remote branch is deleted as part of the same confirmed action. An already-integrated clean task branch exposes the same cleanup as a separate action. Completed runs are labelled `Aufgabe abgeschlossen` with an explicit review next step.

Provider results now distinguish completed, controlled blocked and failed runs. A valid blocked sentinel keeps the task non-successful while preserving its concrete reason in the dashboard instead of reporting a missing completion marker.

Project switching now reloads the currently visible project view. In particular, `Prüfen & Git` clears and disables the previous repository state before loading the selected project's worktrees and changes.
