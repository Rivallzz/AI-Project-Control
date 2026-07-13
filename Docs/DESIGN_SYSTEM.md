# Design System

AI Project Control is a quiet local operations tool, not a marketing dashboard. This file adapts the open-source `ui-ux-pro-max` guidance to the product instead of copying its generic landing-page recommendations.

## Product Character

- Operational, restrained and information-dense.
- Charcoal surfaces with green for healthy local state, amber for attention and red for blockers.
- Native system fonts to avoid network requests, font-loading delay and layout shift.
- One primary action per surface. Secondary details use progressive disclosure.
- Repository state is authoritative; Graphify and Obsidian sources are labelled by role.

## Interaction Rules

- Async operations lasting more than 300 ms show a blocking status dialog or an inline loading state.
- The conversation uses one scroll region. User messages appear right, agent responses left, oldest first.
- Running work appears as a bordered in-conversation assistant response with the explicit text `Agent arbeitet`, provider/model, current phase, latest meaningful activity and start/update timestamps. A short phase timeline remains visible even before the first provider event; raw provider and tool output stays inside an optional technical disclosure. Amber is never the only evidence of work. Incomplete run artifacts without a live job say `unvollständig` and explicitly state that no active work is confirmed.
- Project execution controls live inside the workspace immediately left of the conversation, while the global sidebar remains reserved for workflow status. A visible task-profile selector covers the common intent (`Ausgewogen`, `Schnell`, `Qualität`, `Coding`); exact provider and model controls remain available through progressive disclosure. Presets cover automatic routing, local-only use and a disclosed custom route. One labelled `Zuerst verwenden` control chooses the primary provider, and numbered rows make the resulting fallback order visible without repeated move-button interactions.
- Model choices always show a human-readable name and a concise decision hint; technical IDs remain available where they differ. Loading, empty, stale, unavailable and provider-error states are explicit, stale IDs are never restored as selectable options, and task start remains disabled until the active route has a current valid model.
- Provider and model are separate decisions: task profiles select capability intent, while route presets control cost and privacy. The execution summary states the leading concrete model, local/subscription boundary and quota-only fallback rule before the task starts.
- Project switching keeps the previous screen visible beneath a clear loading scrim.
- Buttons exist only for distinct commands. Conversation continuation uses the composer, not a separate follow-up action.
- Image attachments support file selection and clipboard paste with the same validation limits.
- Install actions use a server-side allowlist and require explicit confirmation.
- Portfolio gives every registered project one compact operational row, while the global dropdown remains the canonical active-project switcher.
- Knowledge search updates Graphify and Obsidian together; source badges keep discovery, working context and authority distinct.
- Git checkboxes select commit scope; opening a row controls only the inspected file diff.
- Execution state and delivery state use separate labels; a completed analysis is not displayed as unpublished code.
- The graph uses direct manipulation: wheel zooms around the pointer and pointer drag pans the view.

## Responsive Rules

- No horizontal page scrolling at 375, 768, 1024, 1366, 1920 or 2560 pixel widths.
- Provider and component details compact below 1500 pixels; full details remain in System Inventory.
- Message width is constrained for readable lines while the workspace itself uses available screen area.
- Controls wrap before labels truncate.
- Below desktop width, the workflow panel forms a compact band above the workspace; execution controls and chat collapse from two columns to one on narrow screens.

## Accessibility And Performance

- Visible focus states and semantic labels are mandatory.
- Status is communicated with text as well as color.
- Primary, secondary and destructive actions use distinct semantics; icon-only controls keep a minimum 44-by-44-pixel target and an accessible name.
- `prefers-reduced-motion` disables nonessential transitions and spinner motion.
- No cloud fonts, decorative images, large UI frameworks or client-side telemetry.
- Background refresh is automatic and cached; manual refresh controls are reserved for explicit diagnostic views.
- Knowledge uses the page as its only scroll container. Note lists and note content do not introduce nested scrollbars.

## Avoid

- Marketing heroes, decorative cards, gradients, glass effects or glow-heavy visuals.
- A second LLM call for every ordinary chat message.
- Nested message scrollbars, ambiguous status percentages or raw logs as the default view.
- A separate live-feed column that competes with the project conversation.
- Installing project-specific tools globally when the active project does not need them.
