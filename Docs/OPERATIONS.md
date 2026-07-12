# Operations

## Start And Stop

Use `Open-Dashboard.ps1` to start the service and open the browser. Use `Stop-Dashboard.ps1` to stop it. The desktop shortcut should point to `Open-Dashboard.ps1` in the installed repository.

For a fresh local installation, run `scripts/Install-Local.ps1`. It refuses to overwrite an existing target, initializes Git, prepares the runtime registry and creates the Obsidian project area.

When the repository has already been downloaded on a new Windows PC, run `bootstrap.ps1`. It checks Node.js LTS, Git and PowerShell 7, offers to install missing foundations through `winget`, then starts the local dashboard. Remaining recommended tools appear in System Inventory and can be installed only through reviewed allowlisted package definitions.

## Projects

Create a new project in the Projects view. Git, baseline documentation, Obsidian and Graphify are prepared automatically. To add an existing repository, send a message such as:

```text
Projekt "C:\Repos\Example" hinzufügen
```

## Tasks

Read-only mode uses the registered repository. Write mode automatically creates an isolated worktree and task branch from the project's integration branch (`develop` when available). Run artifacts remain under `Documents\AI-Runs` for review and provider handoff.

## Review And Publish

Open `Prüfen & Git`. The left-aligned `Arbeitsstand` selector defaults to the latest changed task worktree. Click a file name to inspect only that file; its checkbox independently controls whether it belongs to the next commit. Commit the intended files locally. When the task branch is clean, based directly on the integration branch and not yet integrated, `In <branch> übernehmen` performs a conflict-free fast-forward into the clean integration checkout. If either side diverged or contains local changes, the dashboard stops without modifying the integration checkout.

Push the integration branch separately after review. Only the integration branch should be proposed to `main`; task branches must never target `main` directly. Existing staged files outside the selection remain a hard block and push never uses force.

## System inventory

`config/systems.json` is the reviewed catalog. `Neu prüfen` probes the current machine again. Project-dependent tools are assigned from repository capabilities and show `Verwendet von: <Projekt>`. A present tool may remain visible without assignment so the machine inventory stays complete.

## Recovery

Runtime files are independent from the repository. To reset only the UI registry, stop the service and back up then remove `%LOCALAPPDATA%\AI Project Control\projects.json`. Do not delete project repositories or AI worktrees as part of a dashboard reset.
