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
- Project switching keeps the previous screen visible beneath a clear loading scrim.
- Buttons exist only for distinct commands. Conversation continuation uses the composer, not a separate follow-up action.
- Image attachments support file selection and clipboard paste with the same validation limits.
- Install actions use a server-side allowlist and require explicit confirmation.
- Portfolio states that imply review open the Git review surface instead of a generic workspace.
- Knowledge search updates Graphify and Obsidian together; source badges keep discovery, working context and authority distinct.
- Commit and push are separate actions with separate confirmations.

## Responsive Rules

- No horizontal page scrolling at 375, 768, 1024, 1366, 1920 or 2560 pixel widths.
- Provider and component details compact below 1500 pixels; full details remain in System Inventory.
- Message width is constrained for readable lines while the workspace itself uses available screen area.
- Controls wrap before labels truncate.

## Accessibility And Performance

- Visible focus states and semantic labels are mandatory.
- Status is communicated with text as well as color.
- `prefers-reduced-motion` disables nonessential transitions and spinner motion.
- No cloud fonts, decorative images, large UI frameworks or client-side telemetry.
- Background refresh is automatic and cached; manual refresh controls are reserved for explicit diagnostic views.
- Graph zoom uses compact familiar controls and preserves the canvas dimensions so the layout does not shift.

## Avoid

- Marketing heroes, decorative cards, gradients, glass effects or glow-heavy visuals.
- A second LLM call for every ordinary chat message.
- Nested message scrollbars, ambiguous status percentages or raw logs as the default view.
- Installing project-specific tools globally when the active project does not need them.
