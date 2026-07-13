# Decision Log

## 2026-07-13 - Multi-project portfolio supersedes the single-project overview

The Portfolio view shows one compact operational row for every registered project, with attention and exactly one next action. The global dropdown remains the canonical active-project selection and portfolio actions delegate to it. This supersedes `2026-07-12 - One active project overview` without reintroducing a separate project registry.

## 2026-07-13 - Remote task branches are not deleted during integration

Fast-forward integration and cleanup may remove a completed local task worktree and local `ai/*` branch. They preserve the corresponding remote branch. Remote deletion is a distinct destructive operation and requires proof that the branch is integrated plus an unchanged remote OID captured at confirmation time.

## 2026-07-13 - Read-only safety uses disposable content snapshots

Provider instruction compliance is not the security boundary for read-only work. Every read-only attempt executes in a disposable checkout populated from the current project snapshot. Content manifests before and after execution detect tracked, staged and untracked mutations; the canonical checkout remains untouched and cleanup runs on success and failure.

## 2026-07-13 - Explicit catalogued updates

Version checks may run read-only on project load and through `Neu prüfen`, but software updates require an owner-confirmed button. A system receives that button only when its system, package and official source form a valid catalog binding. A fresh check produces short-lived fingerprinted evidence that is consumed once. Unknown, dirty, ahead, diverged, stale or source-mismatched installations fail closed and remain manual.

## 2026-07-12 - Independent control-plane repository

AI Project Control is an independent project that manages Polis and future projects. It is not owned by the Polis repository.

## 2026-07-12 - No additional paid APIs

Only existing Codex/ChatGPT and Claude subscriptions may be used as cloud providers. API-key billing paths remain blocked. Ollama is the local fallback.

## 2026-07-12 - Repository authority

Project repositories contain canonical documentation. Obsidian is working knowledge and Graphify is a rebuildable discovery index.

## 2026-07-12 - No mandatory prompt-optimizer LLM

Ordinary dashboard messages are not routed through an additional LLM before Codex or Claude. The server preserves the owner's wording, adds a deterministic task envelope and uses Graphify for focused discovery. Optional local refinement may be added later only for long or ambiguous requests and must expose the original prompt alongside the refinement.

## 2026-07-12 - Tiered system inventory

The inventory separates required dashboard foundations, recommended AI-workflow components and project-specific tools. Automatic installation is limited to a reviewed server-side allowlist and never activates paid services or subscriptions.

## 2026-07-12 - Data-driven inventory and capability mapping

System definitions and reviewed installers live in `config/systems.json`, not application code. The server detects what is installed and maps project-specific tools from repository capabilities. A tool may be installed globally while being labelled as used only by the projects that require it.

## 2026-07-12 - Review before publication

The portfolio review state opens a dedicated Git surface. Reading status and diff is automatic; commit and push remain separate, explicit owner actions. The dashboard does not provide a repository text editor, automatic merge or force-push.

## 2026-07-12 - One active project overview

The global project dropdown is the only project switcher. Portfolio shows the selected project's current task, latest run, repository and knowledge health, blockers and next action instead of duplicating a cross-project list.

Superseded by `2026-07-13 - Multi-project portfolio supersedes the single-project overview`.

## 2026-07-12 - Selective ecosystem adoption

Stars are discovery signals, not installation criteria. New tools must add a measured capability without duplicating Hermes, Graphify, Obsidian, ECC or the dashboard. Serena and cli-continues may receive isolated pilots; skill and spec repositories are reference sources first.
