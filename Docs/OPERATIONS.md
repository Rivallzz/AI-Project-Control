# Operations

## Start And Stop

Use `Open-Dashboard.ps1` to start the service and open the browser without interrupting a healthy existing instance. Use `Stop-Dashboard.ps1` to stop it. The desktop shortcut should point to `Restart-Dashboard.ps1` in the installed repository; it stops a running dashboard instance first, then starts the current repository version and opens it.

For a fresh local installation, run `scripts/Install-Local.ps1`. It refuses to overwrite an existing target, initializes Git, prepares the runtime registry and creates the Obsidian project area.

When the repository has already been downloaded on a new Windows PC, run `bootstrap.ps1`. It checks Node.js LTS, Git and PowerShell 7, offers to install missing foundations through `winget`, then starts the local dashboard. Remaining recommended tools appear in System Inventory and can be installed only through reviewed allowlisted package definitions.

## Projects

Use `Projekt hinzufügen` in the header to create a project. Git, baseline documentation, Obsidian and Graphify are prepared automatically. To register an existing repository, send a message such as:

```text
Projekt "C:\Repos\Example" hinzufügen
```

## Tasks

Read-only mode creates a disposable detached checkout, copies the current project snapshot into it and removes it after content-integrity verification. Write mode automatically creates an isolated worktree and task branch from the project's integration branch (`develop` when available). Run artifacts remain under `Documents\AI-Runs` for review and provider handoff.

The `Ausführung` panel beside the chat stores its settings separately for each project. Choose `Ausgewogen`, `Schnell`, `Qualität` or `Coding` for the common case. Open `Provider und konkrete Modelle` only when you need to select the first provider, disable a route or override an exact model. The decision hint explains the leading concrete model, intended use and privacy/cost boundary; `Modelle aktualisieren` re-reads local metadata without starting a provider. A stale, unknown, unavailable or deprecated choice is replaced by a valid catalog default with a visible explanation and is never sent to a CLI.

`Abo-Kontingente zulassen` off forces Hermes/Ollama regardless of cloud ordering. The local route is ready only when Hermes is available and `ollama show` confirms the selected installed model's `completion` capability. Write mode excludes Hermes because its local write-safety gate is still closed. While the catalog or provider state is loading, no valid route exists or a project task is already running, `Aufgabe starten` remains disabled and explains why. A quota failure hands the same task and worktree to the next enabled provider; other failures stop for review. The conversation timeline and run history show the provider and model actually used.

## Review And Publish

Open `Prüfen & Git`. The left-aligned `Arbeitsstand` selector defaults to the latest changed task worktree. Click a file name to inspect only that file; its checkbox independently controls whether it belongs to the next commit. Commit the intended files locally. When the task branch is clean, based directly on the target branch and not yet integrated, `In <branch> übernehmen` performs a conflict-free fast-forward into its clean checkout. The target is `develop` when available and otherwise `main`; the confirmation calls out a direct `main` update. After that succeeds, the dashboard removes the task worktree and integrated local branch. A branch already merged by another path receives cleanup only. Remote branches remain available for audit and are never implicitly deleted. If either side diverged or contains local changes, the dashboard stops without modifying the target checkout.

`Abgeschlossene Aufgaben aufräumen` removes multiple legacy worktrees only after Git confirms each clean `ai/*` branch is already contained in the target branch and the owner confirms the exact branch list. Image changes can be inspected directly in the file view; previews are limited to supported local image types and 20 MB.

Push the target branch separately after review. When `develop` exists, only that integration branch should be proposed to `main`; without a separate integration branch, the reviewed task is fast-forwarded directly to `main`. Existing staged files outside the selection remain a hard block and push never uses force.

## System inventory

`config/systems.json` is the reviewed catalog of official sources, package identities and system roles. Loading a project checks catalogued update sources in the background and reuses the local six-hour cache. `Neu prüfen` probes the current machine and update sources again. This performs no installation and consumes no LLM or subscription tokens.

When a newer supported version exists, its system card shows the installed and available versions plus `Update`. Confirming that button performs a fresh source check, consumes a fingerprinted one-use authorization and starts the derived Winget, npm or fast-forward Git command as a visible local setup job in the project conversation. It never updates silently. Only one mutating maintenance job runs at a time, and a running package-manager operation cannot be force-stopped from the UI. Git-based tools must use the catalogued remote, be clean and remain strictly behind; otherwise the action stops. Restart the dashboard after updating Node.js or another component used by the running process. A card without an update state has no reviewed automatic route and must be maintained through its official manual process.

Project-dependent tools are assigned from repository capabilities and show `Verwendet von: <Projekt>`. A present tool may remain visible without assignment so the machine inventory stays complete.

## Recovery

Runtime files are independent from the repository. To reset only the UI registry, stop the service and back up then remove `%LOCALAPPDATA%\AI Project Control\projects.json`. Do not delete project repositories or AI worktrees as part of a dashboard reset.

Completed job history is stored in `%LOCALAPPDATA%\AI Project Control\jobs.json`. After an unexpected dashboard restart, previously running jobs appear as interrupted failures rather than disappearing or remaining falsely active. Inspect their run artifacts before starting replacement work.
