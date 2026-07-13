# Current Task

No active implementation task.

The 2026-07-13 model-selection, execution-UX, live-progress and desktop-launcher hardening is implemented in the current working tree and awaits owner Git review. It adds a versioned server-owned model catalog, deterministic task profiles, strict pre-execution model validation, exact Ollama/Hermes model routing, visible provider/model audit data, project-safe refresh handling and explicit loading, empty, unavailable, stale and running states. The execution panel now uses progressive disclosure, clearer action semantics and responsive layouts without horizontal page overflow. Live jobs remain visible over their incomplete run directories and show current activity plus timestamps; interrupted and orphaned runs can no longer masquerade as active work. The desktop shortcut uses the dedicated restart entry point so it replaces an already running dashboard service with the current repository version before opening the browser.

Validation completed:

- `npm test`: PASS, including 39 Node tests, Router isolation and product smoke coverage.
- Targeted API boundaries: PASS, including rejection of an invented active model before provider execution.
- Local Ollama capability check: PASS; six installed Completion models were executable and the installed embedding-only model was rejected with a specific reason.
- `git diff --check`: PASS.
- In-app browser QA: PASS at 375, 768, 1024 and 1920 pixels with no horizontal page overflow, no sub-44-pixel visible buttons and no browser console errors.
- Interactive browser QA: PASS for profile changes, an exact model override and reset, catalog/model decision details, loading-to-ready task gating and the keyboard-visible skip link.
- Desktop restart shortcut: PASS; the previous dashboard PID was stopped, a different PID became healthy on port 8765 and the shortcut target was verified.
- Live-progress recovery: PASS; an interrupted real job is rendered as failed instead of `EXTERNAL`, current activity is exposed through a polite live region and incomplete run/job reconciliation is covered by behavior tests.

Next owner action: inspect the working-tree diff in `Prüfen & Git` and separately authorize any commit, integration or push action.
