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

The `Ausführung` panel beside the chat stores its settings separately for each project. Use the arrow controls to place Codex or Claude first, uncheck providers that should not run and choose a model in each row. `Abo-Kontingente zulassen` off forces Hermes/Ollama regardless of cloud ordering. Write mode excludes Hermes because its local write-safety gate is still closed. A quota failure hands the same task and worktree to the next enabled provider; other failures stop for review.

## Review And Publish

Open `Prüfen & Git`. The left-aligned `Arbeitsstand` selector defaults to the latest changed task worktree. Click a file name to inspect only that file; its checkbox independently controls whether it belongs to the next commit. Commit the intended files locally. When the task branch is clean, based directly on the target branch and not yet integrated, `In <branch> übernehmen` performs a conflict-free fast-forward into its clean checkout. The target is `develop` when available and otherwise `main`; the confirmation calls out a direct `main` update. After that succeeds, the dashboard removes the task worktree and safely deletes the integrated local branch; when the branch was pushed to `origin`, it deletes that remote branch too. If the branch was already merged by another path, `Aufgabenbranch aufräumen` performs only this cleanup. If either side diverged or contains local changes, the dashboard stops without modifying the target checkout.

`Abgeschlossene Aufgaben aufräumen` removes multiple legacy worktrees only after Git confirms each clean `ai/*` branch is already contained in the target branch and the owner confirms the exact branch list. Image changes can be inspected directly in the file view; previews are limited to supported local image types and 20 MB.

Push the target branch separately after review. When `develop` exists, only that integration branch should be proposed to `main`; without a separate integration branch, the reviewed task is fast-forwarded directly to `main`. Existing staged files outside the selection remain a hard block and push never uses force.

## System inventory

`config/systems.json` is the reviewed catalog. Loading a project checks catalogued official update sources in the background and reuses the local six-hour cache. `Neu prüfen` probes the current machine and update sources again. This performs no installation and consumes no LLM or subscription tokens.

When a newer supported version exists, its system card shows the installed and available versions plus `Update`. Confirming that button starts the exact allowlisted Winget, npm or fast-forward Git command as a visible local setup job in the project conversation. It never updates silently. Git-based tools must be clean and use `pull --ff-only`; otherwise the action stops. Restart the dashboard after updating Node.js or another component used by the running process. A card without an update state has no reviewed automatic route and must be maintained through its official manual process.

Project-dependent tools are assigned from repository capabilities and show `Verwendet von: <Projekt>`. A present tool may remain visible without assignment so the machine inventory stays complete.

## Recovery

Runtime files are independent from the repository. To reset only the UI registry, stop the service and back up then remove `%LOCALAPPDATA%\AI Project Control\projects.json`. Do not delete project repositories or AI worktrees as part of a dashboard reset.
