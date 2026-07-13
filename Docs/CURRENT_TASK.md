# Current Task

## Graphify workflow status correction

The implementation is complete in the current working tree and awaits owner Git review.

The workflow status showed Graphify as missing because the first `python.exe` on `PATH` belonged to Hermes' private environment and did not contain the `graphify` module. The project index itself existed and was readable. Graphify runtime discovery now respects an explicit interpreter path and otherwise checks the Windows Python launcher before `PATH` Python. Runtime health and index health are exposed separately, while Portfolio freshness is derived only from the index and its `built_at_commit`.

Validation performed:

- `npm run check`: PASS.
- Focused Python-runtime tests: PASS, covering launcher preference, fallback and authoritative explicit configuration.
- `npm run test:router`: PASS (`ROUTER_READONLY_TEST_OK`).
- Local runtime check: PASS; `py.exe -m graphify --version` returns `graphify 0.9.10`, while the Hermes `python.exe` reproduces the original missing-module error.
- The new API regression covers an unavailable Graphify runtime with a readable stale index and verifies the Portfolio warning remains `veraltet`, not `fehlt`.
- `npm test` was run, but this controlled workspace blocks Node test-worker and server child processes with `spawn EPERM`; all test files were rejected before execution. The smoke test reached the server but its nested Git check was blocked by the same restriction. These environment failures must be rerun from a normal local shell.
- In-app browser QA was unavailable because no browser surface was connected in this session; no browser-side code or layout changed.

Next owner action: run `npm test` in a normal local shell, inspect the working-tree diff in `Prüfen & Git`, and separately authorize any commit, integration or push action.
