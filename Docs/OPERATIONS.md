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

Read-only mode uses the registered repository. Write mode automatically creates an isolated worktree and branch. Run artifacts remain under `Documents\AI-Runs` for review and provider handoff.

## Review And Publish

Open `Prüfen & Git`. Click a file name to inspect only that file; its checkbox independently controls whether it belongs to the next commit. Select the intended files, enter a concise message and choose either a local commit or `Committen & pushen`. Existing local commits can be pushed separately when the branch is ahead. The operation refuses to hide already staged files outside the selection and never force-pushes.

## System inventory

`config/systems.json` is the reviewed catalog. `Neu prüfen` probes the current machine again. Project-dependent tools are assigned from repository capabilities and show `Verwendet von: <Projekt>`. A present tool may remain visible without assignment so the machine inventory stays complete.

## Recovery

Runtime files are independent from the repository. To reset only the UI registry, stop the service and back up then remove `%LOCALAPPDATA%\AI Project Control\projects.json`. Do not delete project repositories or AI worktrees as part of a dashboard reset.
