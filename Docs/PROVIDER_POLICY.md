# Provider And Cost Policy

## Routing

With subscription usage enabled, new projects initially route in this order:

1. Codex through ChatGPT authentication.
2. Claude Code through a Claude subscription.
3. Hermes using local Ollama.

The operator may choose a task profile, enable or disable individual providers and choose which active provider is used first per project. Profiles are deterministic shortcuts to concrete entries in the current catalog; they do not trigger a model call, and missing metadata falls back to the provider default instead of guessing from names. The remaining active providers form the visible fallback order, and a task uses that exact route. Each provider also receives the selected model: Codex uses either its configured default or a locally discovered Codex model, Claude uses its default or a reviewed CLI alias, and Hermes uses an installed Ollama chat model through the Hermes `-m` argument. The operator can refresh this local catalog without starting a provider or incurring usage.

The server rejects unknown, unavailable or deprecated active model IDs before task execution. It also requires Hermes and an installed selected Ollama model whose local metadata explicitly reports the `completion` capability before exposing the local route; model names are not used as capability evidence. Unavailable providers are skipped while preserving the remaining order, and the UI prevents a task when no valid route remains. A non-quota provider failure still stops the workflow for inspection instead of silently switching engines. Every started attempt and completed run records the actual provider and model for auditability, independently of bounded raw-log retention.

When a recognized quota limit interrupts a task, the router records output, Git status and the working-tree diff, then gives the same worktree and a handoff package to the next provider. If cli-continues can identify the exact local session by provider, working directory and run time, a minimal session extract is attached. The router never selects an unrelated latest session.

With subscription usage disabled, only Hermes with local Ollama is allowed. The visible route collapses to the local provider and no subscription provider starts.

Read-only questions use a lightweight advisory context policy: `AGENTS.md` remains mandatory, Graphify narrows discovery, and only the minimum relevant original files are read. Every provider receives a disposable checkout containing a snapshot of the current project content; a before/after manifest blocks the result if that content changes. Full documentation scans and test suites are reserved for explicit audits or write tasks.

Provider completion markers are interpreted explicitly. `AI_PROJECT_TASK_COMPLETE` is successful, `AI_PROJECT_TASK_BLOCKED: <reason>` is a controlled non-success result whose reason is retained, and output containing neither marker is incomplete or malformed.

Read-only safety is independent of model obedience. A provider that writes inside its disposable checkout cannot change the canonical repository, and the router reports the content mutation as blocked before cleanup. Write tasks continue to use explicit task worktrees and remain subject to human Git review.

Successful write-task responses also provide one concise branch name and one imperative commit message before the completion marker. These fields are local workflow metadata, not an instruction to commit or push. They reuse the executing provider and never trigger a second prompt-optimization call.

## Billing guard

The router refuses to start a cloud provider when `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `ANTHROPIC_BASE_URL` would create an API-billing path. Numeric Claude subscription credits are not exposed by Claude Code, so the dashboard reports availability and known backoff rather than inventing a balance.

Codex rate-limit percentages and reset times come from local Codex session telemetry. Additional API-credit balances, when visible there, are displayed as blocked and are not consumed by the router.
