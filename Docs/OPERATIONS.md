# Operations

## Start And Stop

Use `Open-Dashboard.ps1` to start the service and open the browser. Use `Stop-Dashboard.ps1` to stop it. The desktop shortcut should point to `Open-Dashboard.ps1` in the installed repository.

For a fresh local installation, run `scripts/Install-Local.ps1`. It refuses to overwrite an existing target, initializes Git, prepares the runtime registry and creates the Obsidian project area.

## Projects

Create a new project in the Projects view. Git, baseline documentation, Obsidian and Graphify are prepared automatically. To add an existing repository, send a message such as:

```text
Projekt "C:\Repos\Example" hinzufügen
```

## Tasks

Read-only mode uses the registered repository. Write mode automatically creates an isolated worktree and branch. Run artifacts remain under `Documents\AI-Runs` for review and provider handoff.

## Recovery

Runtime files are independent from the repository. To reset only the UI registry, stop the service and back up then remove `%LOCALAPPDATA%\AI Project Control\projects.json`. Do not delete project repositories or AI worktrees as part of a dashboard reset.
