# Changelog

## 2026-07-12

- Extracted AI Project Control from the Polis-specific runtime.
- Moved mutable dashboard state outside the source tree.
- Combined task composition and feedback into a larger chat-like workspace.
- Added automatic write-task worktrees and chat-based project registration.
- Added an explicit subscription-token toggle and clearer cost/credit status.
- Added MCP inventory plus documented ECC and Hermes responsibilities.
- Corrected MCP inventory to count servers without counting their environment sections twice.
- Added project-owned architecture, provider, integration and operation documentation.
- Fixed UTF-8 prompt delivery to Codex for German and other non-ASCII text.
- Persisted failed routing results and surfaced provider stderr as the task response.
- Removed ANSI control sequences from the live feed and corrected completed/failed job messaging.
- Forced UTF-8 console output for readable live events and reduced history responses to the final agent message.
- Prevented successful responses that mention quotas from being mislabeled as quota failures.
- Added a lightweight Graphify-first context policy for ordinary read-only questions to reduce unnecessary token use.
- Reworked task history into an oldest-first chat with user messages on the right, agent responses on the left and automatic scrolling to the newest response.
- Added responsive desktop and mobile layouts without nested message scroll areas.
- Added validated local image attachments that are stored with dashboard task artifacts rather than project repositories.
- Added a portfolio overview, attention inbox and derived project states based on repository, run and Graphify signals.
- Added important/error/all live-feed filters and compact run metadata for calmer daily operation.
- Removed redundant global/history refresh controls and run-folder/follow-up actions from the normal chat flow.
- Added clipboard screenshot paste with the same validated local attachment pipeline as file selection.
- Added a blocking, accessible loading state while project connections are switched and refreshed.
- Reorganized System Inventory into required, recommended and project-specific tiers with relevance explanations.
- Added an allowlisted local installer workflow plus `bootstrap.ps1` for first-run foundation checks on a new Windows PC.
- Installed and applied the open-source `ui-ux-pro-max` skill selectively; documented the adapted operational design system.
- Recorded the decision to avoid a mandatory prompt-optimizer LLM and keep deterministic, Graphify-focused task compilation.
- Moved system definitions, capability mappings and reviewed installers from `server.js` into the versioned `config/systems.json` catalog.
- Added dynamic repository capability detection and visible `Verwendet von` project assignments for project-dependent tools.
- Added catalog-driven discovery for portable tools outside `PATH`, including local Godot downloads.
- Added a dedicated Git review surface with changed-file selection, read-only diff, guarded local commits and separate non-force pushes.
- Combined Graphify relationships and Obsidian working notes into one automatically loaded knowledge view with shared search and graph zoom.
- Expanded each Obsidian project area with lightweight indexes for notes, research, drafts, reviews, prompts, lessons and AI runs.
