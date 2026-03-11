# Style Guide

## General Rules
- All styles live in `styles.css` — no inline styles in JS (only computed `left`/`top` for positioning)
- Every class is prefixed with `jr-` to avoid collisions with host site styles
- Use CSS custom properties (`--jr-*`) for all colors, radii, shadows, and fonts so theming is centralized

## CSS Variables

Defined on `:root` and overridden for dark mode.

| Variable | Light | Dark | Usage |
|---|---|---|---|
| `--jr-bg` | `#ffffff` | `#1e1e2e` | Popup & input background |
| `--jr-border` | `#e0e0e0` | `#3a3a4a` | Borders |
| `--jr-text` | `#1a1a1a` | `#e4e4e7` | Primary text |
| `--jr-text-muted` | `#6b7280` | `#9ca3af` | Blockquote / secondary text |
| `--jr-accent` | `#2563eb` | `#3b82f6` | Send button, focus ring |
| `--jr-accent-hover` | `#1d4ed8` | `#2563eb` | Button hover state |
| `--jr-highlight-bg` | `#f3f4f6` | `#2a2a3c` | Blockquote background |
| `--jr-highlight-border` | `#d1d5db` | `#4a4a5a` | Blockquote left border |
| `--jr-mark-bg` | `rgba(37,99,235,0.12)` | `rgba(59,130,246,0.2)` | Inline selection mark |
| `--jr-radius` | `12px` | `12px` | Border radius |
| `--jr-shadow` | light shadow | deeper shadow | Popup box shadow |
| `--jr-font` | system stack | system stack | Font family |
| `--jr-color-blue` | `rgba(37,99,235,0.15)` | `rgba(37,99,235,0.25)` | Blue highlight color |
| `--jr-color-yellow` | `rgba(234,179,8,0.15)` | `rgba(234,179,8,0.25)` | Yellow highlight color |
| `--jr-color-green` | `rgba(34,197,94,0.15)` | `rgba(34,197,94,0.25)` | Green highlight color |
| `--jr-color-pink` | `rgba(236,72,153,0.15)` | `rgba(236,72,153,0.25)` | Pink highlight color |
| `--jr-color-purple` | `rgba(168,85,247,0.15)` | `rgba(168,85,247,0.25)` | Purple highlight color |

## Dark Mode
Dark mode activates when the `<html>` element has class `dark` or any class containing `"dark"`:
```css
html.dark,
html[class*="dark"] { ... }
```
This covers ChatGPT's dark mode toggle. Other sites may need additional selectors in the future.

## Components

### `.jr-popup`
- `position: absolute`, `z-index: 999999`
- 360px wide, 14px padding, 12px border radius
- Subtle fade-in animation (`jr-fade-in`, 0.15s ease-out)
- Only `left` and `top` are set via JS; everything else is in CSS

### `.jr-popup-arrow`
- Positioned absolutely inside `.jr-popup`, `pointer-events: none`
- 18px wide, 9px tall — subtle but visible
- Two pseudo-elements: `::before` (outer border triangle in `--jr-border`) and `::after` (inner fill triangle in `--jr-bg`, offset 1px inward)
- `.jr-popup-arrow--up` — sits at `top: -9px`; uses `border-bottom` triangles; shown when popup is below the highlight
- `.jr-popup-arrow--down` — sits at `bottom: -9px`; uses `border-top` triangles; shown when popup is above the highlight
- Horizontal `left` set by JS (`JR.updateArrow`) to track highlight center, clamped to `[12, popupWidth - 30]`

### `.jr-popup-highlight`
- Blockquote-style display of the selected text
- 3px solid left border using `--jr-highlight-border`
- Muted text color, 13px font size, `word-break: break-word`

### `.jr-popup-context-list`
- List rendered inside the blockquote for both single-block (first sentence of bullet) and multi-block selections across list items
- Created as `<ul>` for bullet lists or `<ol>` for numbered lists, matching the original content
- `margin: 0`, `padding-left: 1.2em`; explicit `list-style-type` overrides ChatGPT's CSS reset (`list-style: none` on `<ul>`)
- `<ol>` uses `start` attribute to preserve original ordinal numbers (e.g. item 4 shows as "4." not "1.")
- Depth classes (`jr-depth-1`, `jr-depth-2`) provide indentation and alternate marker styles
  - `ul`: disc → circle → square
  - `ol`: decimal → lower-alpha → lower-roman
- `jr-li-cont` class on continuation items (same `<li>`, second `<p>`) suppresses the bullet marker

### `.jr-popup-context-block`
- Block-level `<div>` wrapper for paragraphs and headings in mixed list/non-list content
- `margin-bottom: 6px` (last child 0)
- `.jr-popup-context-heading` variant: `font-weight: 600`, primary text color

### `.jr-edit-send-wrapper`
- Relative container for the send arrow icon and its hover dropdown
- `flex-shrink: 0`, positioned to the right of the question text

### `.jr-popup-edit-send`
- Send arrow SVG icon used for both initial questions and editing existing questions
- `24px × 24px`, `color: var(--jr-accent)`, hover: `background: var(--jr-highlight-bg)`
- `:disabled` — `color: var(--jr-text-muted)`, `opacity: 0.35`, greyed out when input is empty or unchanged

### `.jr-edit-send-dropdown`
- `position: absolute`, anchored below the send icon (`top: 100%`), `padding-top: 4px` as invisible hover bridge
- Shown on hover of `.jr-edit-send-wrapper` when not disabled (`.jr-disabled` class prevents show)
- Inner `.jr-edit-send-dropdown-menu` — `background: var(--jr-bg)`, `border: 1px solid var(--jr-border)`, `border-radius: 8px`, `white-space: nowrap`

### `.jr-edit-send-dropdown-item`
- `padding: 5px 10px`, `font-size: 12px`, `cursor: pointer`
- Hover: `background: var(--jr-highlight-bg)`
- Two items: "Brief" and "Elaborate"

### `.jr-popup-mark`
- Inline `<span>` within the blockquote that highlights the exact selection
- `background: var(--jr-mark-bg)` — subtle accent-colored background
- `border-radius: 2px`, `padding: 1px 0`
- Always rendered when sentence context is available — wraps the entire text when the selection equals the full sentence

### `.jr-popup-pill`
- Inline `<span>` for citation references detected via `data-testid="webpage-citation-pill"`
- Boxed appearance: `border: 1px solid var(--jr-border)`, `border-radius: 4px`, `padding: 1px 5px`
- Slightly smaller font (`0.85em`) with `--jr-highlight-bg` background
- Visually separates citation references from surrounding sentence text
- Can overlap with `.jr-popup-mark` when a citation is inside the highlighted selection

### `.jr-source-highlight`
- Inline `<span>` wrapping text nodes in the AI response to create a persistent "shadow highlight"
- `background: var(--jr-mark-bg)` — same subtle accent tint as `.jr-popup-mark` for visual consistency
- `border-radius: 2px`
- `user-select: text` — ensures text is natively selectable for copy even if the host site disables selection
- Dynamically added when a popup opens from a selection; removed (unwrapped) when the popup is dismissed
- Multiple spans may exist simultaneously when the selection spans multiple text nodes (e.g. across bold/italic boundaries)

### `.jr-source-highlight-done`
- Added to `jr-source-highlight` spans after a response is captured, signaling the highlight is completed and clickable
- `cursor: pointer` — indicates the highlight can be clicked to re-open the popup
- `transition: background 0.12s ease` — smooth color transitions for hover/active states
- Persists after popup dismiss (unlike plain `jr-source-highlight` which is unwrapped on dismiss for in-progress highlights)
- Used as click target selector: `document.addEventListener("click", ...)` checks for this class
- Each span also gets `data-jr-highlight-id` attribute linking to the in-memory `completedHighlights` Map
- **Hover** (`:hover`): background darkens — uses `--jr-mark-bg-hover` (default) or `--jr-color-*-hover` (colored highlights)
- **Active** (`.jr-source-highlight-active`): even darker background when popup is open — uses `--jr-mark-bg-active` or `--jr-color-*-active`; active overrides hover

### `.jr-hidden`
- Applied to conversation turns to hide injected Q&A from the main chat flow
- `display: none !important` — ensures the turn is fully hidden regardless of host styles
- Added/removed dynamically by the response capture logic

### `.jr-popup-question`
- Used for both initial question input and completed question display
- `display: flex`, `align-items: flex-start`, `gap: 6px` — flex layout for question text + send/edit buttons
- `margin-top: 10px`, `font-size: 16px`, `font-weight: 400`, primary text color, `line-height: 1.6`
- Initial input: `.jr-popup-question-text` with `contenteditable="true"` + placeholder + `.jr-edit-send-wrapper` (send arrow where pencil would be)
- Completed: `.jr-popup-question-text` (read-only) + `.jr-edit-send-wrapper` (hidden) + `.jr-popup-edit-btn` (pencil)
- `.jr-popup-question-text[contenteditable="true"]` — `border-bottom: 1px solid var(--jr-border)`, focus: `border-bottom-color: var(--jr-accent)`
- `.jr-popup-question-text[data-placeholder]:empty::before` — shows placeholder text in muted color via CSS `content: attr(data-placeholder)`

### `.jr-popup-edit-btn`
- Pencil SVG toggle button next to the question text in completed popups
- `24px × 24px`, `padding: 4px`, no border, transparent background
- `color: var(--jr-text-muted)`, hover: `color: var(--jr-text)`, `background: var(--jr-highlight-bg)`
- SVG is `14px × 14px`, stroke-based pencil icon
- Click toggles edit mode on/off — when active (pressed), question text becomes editable in place; when clicked again, changes are discarded and original text restored
- `.jr-popup-edit-btn--active` — active state: `color: var(--jr-accent)`, `background: none` (blue, no backdrop)
- `.jr-popup-edit-btn--active:hover` — `color: var(--jr-accent-hover)`, `background: var(--jr-highlight-bg)`

### `.jr-popup-version-nav`
- Navigation bar for switching between response versions, shown when `versions.length > 1`
- `display: flex`, `align-items: center`, `justify-content: center`, `gap: 8px`, `margin-top: 8px`
- Positioned between the question and the response

### `.jr-popup-version-prev`, `.jr-popup-version-next`
- `24px × 24px` arrow buttons (`◀` / `▶`)
- `border: 1px solid var(--jr-border)`, `border-radius: 4px`, `background: var(--jr-bg)`
- Hover: `background: var(--jr-highlight-bg)`; disabled: `opacity: 0.3`, no cursor

### `.jr-popup-version-indicator`
- `font-size: 13px`, `color: var(--jr-text-muted)`, `min-width: 40px`, centered
- Shows "1 / 3" format — current version / total versions

### `.jr-popup-loading`
- Loading indicator shown inside the popup while waiting for the AI response
- `padding: 12px 0 4px 0`, centered text
- `font-size: 13px`, muted text color (`--jr-text-muted`)
- Text content changes: "Waiting for response…" → "Response timed out." on timeout

### `.jr-popup-response`
- Container for the AI response content displayed inside the popup
- `margin-top: 12px`, `padding-top: 12px`, separated by a top border (`--jr-border`)
- `max-height: 350px` with `overflow-y: auto` for scrollable long responses
- `font-size: 16px`, `line-height: 1.6`, `word-break: break-word`
- `user-select: text` — ensures response text is selectable for chained popup highlighting even if the host site disables selection
- **Markdown formatting** (Step 5b): targeted child rules restore spacing and visual structure for elements cloned from ChatGPT's rendered markdown:
  - `p`: `margin: 0 0 1em 0` (last-child 0)
  - `h1`–`h6`: `margin: 1.25em 0 0.5em 0`, `font-weight: 600`, `line-height: 1.3` (first-child margin-top 0)
  - `hr`: `border: none; border-top: 1px solid var(--jr-border); margin: 1em 0`
  - `pre`: background tint, 1px border, `border-radius: 6px`, `padding: 12px`, `overflow-x: auto`
  - `code`: background tint, `border-radius: 3px`, `padding: 2px 4px`; `pre code` resets to inherit
  - `blockquote`: 3px left border, background tint, muted text color
  - `ul`/`ol`: `margin: 1em 0`, `padding-left: 1.5em`; explicit `list-style-type`
  - `table`: `border-collapse: collapse`, `width: 100%`; `th`/`td` borders, padding; `th` background tint
  - `a`: accent color, underline
  - `img`: `max-width: 100%`, `height: auto`

### Resizable Popup (Step 5a)
- Popups are resizable by dragging the left or right edge
- 6px edge detection zone within the popup's 14px padding — does not overlap content areas
- `col-resize` cursor shown on hover near edges; reverts on mouse leave
- During drag: `document`-level `mousemove`/`mouseup` listeners track resize; `preventDefault` on initial mousedown prevents text selection
- Minimum width: 280px; maximum width: `window.innerWidth - 32`
- `customPopupWidth` (module-level variable) persists the last resized width for the page session
- All popup creators (`createPopup`, `openCompletedPopup`, `createChainedPopup`) apply `customPopupWidth` as an inline `style.width` override
- `positionPopup()` measures `popup.offsetWidth` from the DOM (after offscreen append) instead of using a hardcoded value
- `repositionPopup()` and window resize handlers use `popup.offsetWidth` / `activePopup.offsetWidth`

### Highlight Toolbar (Step 7a)

#### `.jr-popup-toolbar`
- Floating bar near the highlighted text, separate from the popup: `position: absolute`, `z-index: 50`
- Positioned on the opposite side of the highlight from the popup (popup below → toolbar above, and vice versa)
- Pill-shaped: `border-radius: 20px`, `padding: 4px 8px`, `gap: 4px`
- `background: var(--jr-bg)`, `border: 1px solid var(--jr-border)`, subtle shadow
- Repositions on window resize, scroll, and popup reposition

#### `.jr-toolbar-swatch`
- 18×18px color circles: `border-radius: 50%`, `cursor: pointer`, `border: 2px solid transparent`
- `.jr-toolbar-swatch--active` → `border-color: var(--jr-text)`
- Hover (non-active) → `border-color: var(--jr-text-muted)`
- Color variants: `--blue`, `--yellow`, `--green`, `--pink`, `--purple` using `--jr-color-*` variables

#### `.jr-toolbar-delete`
- Trash icon button: `margin-left: auto` (pushed to right end), `color: var(--jr-text-muted)`
- Hover: `color: #ef4444`, `background: var(--jr-highlight-bg)`
- 16×16px SVG icon

#### `.jr-highlight-color-*`
- Applied to `.jr-source-highlight` spans to override default `--jr-mark-bg` background
- 5 classes: `-blue`, `-yellow`, `-green`, `-pink`, `-purple` → `var(--jr-color-*)` backgrounds
- Color CSS variables: light mode `rgba(R,G,B, 0.15)`, dark mode `rgba(R,G,B, 0.25)`

#### `.jr-popup-confirm`
- Centered overlay inside popup for delete confirmation
- `display: flex`, `flex-direction: column`, `align-items: center`, `gap: 14px`, `padding: 20px 14px`
- `.jr-popup-confirm-btn` — standard button with border, `.jr-popup-confirm-btn--danger` — red background

### Highlight Navigation Widget (Step 7d)

#### `.jr-nav-widget`
- `position: fixed`, `top: 50%`, `right: 80px`, `transform: translateY(-50%)`, `z-index: 999999`
- Vertical layout: `flex-direction: column`, `align-items: center`, `gap: 0`
- No background, no border, no box shadow — transparent floating arrows
- `animation: jr-fade-in 0.15s ease-out`
- Contains up/down buttons and a position indicator

#### `.jr-nav-up`, `.jr-nav-down`
- `36px × 36px`, no border/background, `color: #191414`, cursor pointer
- SVG chevrons at `20px × 20px`
- Hover (non-disabled): `transform: scale(1.3)`
- `:disabled`: `color: #c0c0c0`, default cursor

#### `.jr-nav-indicator`
- `font-size: 13px`, `color: var(--jr-text-muted)`, centered, `white-space: nowrap`
- Shows "2 / 5" when a highlight is focused, or just "5" when no highlight is active

## Naming Convention
All classes follow the pattern: `.jr-<component>-<element>`
- `.jr-popup` — the container
- `.jr-popup-highlight` — the blockquote inside the popup
- `.jr-popup-question` — the question input / display row
- `.jr-popup-edit-send` — the send arrow icon
