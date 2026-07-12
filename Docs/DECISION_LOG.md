# Decision Log

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
