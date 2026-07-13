# Provider And Cost Policy

## Routing

With subscription usage enabled, new projects initially route in this order:

1. Codex through ChatGPT authentication.
2. Claude Code through a Claude subscription.
3. Hermes using local Ollama.

The operator may enable or disable individual providers and choose which active provider is used first per project. The remaining active providers form the visible fallback order, and a task uses that exact route. Each provider also receives the selected model: Codex uses either its configured default or a locally discovered Codex model, Claude uses its default or a CLI alias, and Hermes uses an installed Ollama chat model. The operator can refresh this local catalog without starting a provider or incurring usage. Unavailable providers are skipped while preserving the remaining order. A non-quota provider failure still stops the workflow for inspection instead of silently switching engines.

When a recognized quota limit interrupts a task, the router records output, Git status and the working-tree diff, then gives the same worktree and a handoff package to the next provider. If cli-continues can identify the exact local session by provider, working directory and run time, a minimal session extract is attached. The router never selects an unrelated latest session.

With subscription usage disabled, only Hermes with local Ollama is allowed. The visible route collapses to the local provider and no subscription provider starts.

Read-only questions use a lightweight advisory context policy: `AGENTS.md` remains mandatory, Graphify narrows discovery, and only the minimum relevant original files are read. Full documentation scans and test suites are reserved for explicit audits or write tasks.

Provider completion markers are interpreted explicitly. `AI_PROJECT_TASK_COMPLETE` is successful, `AI_PROJECT_TASK_BLOCKED: <reason>` is a controlled non-success result whose reason is retained, and output containing neither marker is incomplete or malformed.

Successful write-task responses also provide one concise branch name and one imperative commit message before the completion marker. These fields are local workflow metadata, not an instruction to commit or push. They reuse the executing provider and never trigger a second prompt-optimization call.

## Billing guard

The router refuses to start a cloud provider when `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `ANTHROPIC_BASE_URL` would create an API-billing path. Numeric Claude subscription credits are not exposed by Claude Code, so the dashboard reports availability and known backoff rather than inventing a balance.

Codex rate-limit percentages and reset times come from local Codex session telemetry. Additional API-credit balances, when visible there, are displayed as blocked and are not consumed by the router.
