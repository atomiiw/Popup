# Features

## Current

### Attachments in popups (1.2.11)
- Paste or drop any file into a popup question; it shows in its own layer between the quote and the question as 45 px squares (images as thumbnails, other files as an icon with the name shortened in the middle, extension kept)
- Sending hands the files to ChatGPT's own composer (synthetic paste), waits for the uploads, then sends the hidden Popup question with them; files ChatGPT refuses are listed in a one-line grey note (this session only) and the rest is sent
- Answered popups show the attachments of each version, also after a reload (read from the conversation data); edits start with no attachments
- Popup does not send while the user's own files wait in ChatGPT's input box (one-line note instead)

### ChatGPT's rich answer formats (1.2.10–1.2.11)
- Highlights work on step cards, CodeMirror code blocks (whole touched lines, monospace quote), SVG charts (axis labels; quote "Chart: <title>"), tables, maps (marker text skipped); highlighted text is always white (light) / dark (dark mode)
- Popup answers show ChatGPT's rich formats: fresh answers are a copy of ChatGPT's own rendering; after a reload Popup draws them itself — cards and grids, title rows, badges, icons as symbols, code blocks with Copy, line/bar charts from the answer's data (other chart kinds as a table), maps as a place list with map links, checklists, links; source markers and image placeholders are hidden; answers with a chart or map are always drawn by Popup (ChatGPT's copy would be blank)
- Popups can be dragged from 280 to 720 px wide: wide tables scroll sideways, card grids drop columns when narrow
- Known limits: formulas after a reload show as TeX; Mermaid diagrams show as code

### Highlight-to-Popup (Step 1 — ChatGPT only)
- Select any text inside a ChatGPT AI response to open a floating popup
- Popup displays the highlighted text in a blockquote and provides an inline contenteditable input for follow-up questions with a send arrow (hover to pick Brief/Elaborate)
- Popup positions itself centered below the selection; flips above if it would overflow the viewport; clamps horizontally to stay on screen
- Dismisses on click outside, Escape key, or SPA navigation (route change)
- Send arrow with hover dropdown (Brief/Elaborate) submits the follow-up question through ChatGPT's real chat input
- Dark mode support — automatically matches ChatGPT's theme

### Sentence Context Extraction (Step 1b)
- When text is highlighted, the extension extracts the full containing sentence(s) from the block-level ancestor (paragraph, list item, heading, etc.)
- If the selection spans multiple sentences, the context expands to cover all touched sentences (from start of first to end of last)
- Popup shows the full sentence context in a blockquote with the exact selection highlighted inline via a colored background mark
- When the selection equals the full sentence, the entire text is wrapped in the mark (consistent blue highlight always visible)
- Code blocks (`<pre>`) use the entire block as the "sentence" since periods aren't sentence boundaries in code
- Injected messages include both the context sentence and the exact quote for better AI context
- Cross-block selections (e.g. multiple bullet points) collect the full text of each selected block, joined with newlines
- Cross-block selections trim start and end blocks to sentence boundaries, so only the relevant sentence from each block is shown
- Bullet points (`<ul>`) render as bulleted lists; numbered lists (`<ol>`) render with decimal numbering — matching the original content
- Single-block selections inside a bullet point show the bullet marker if and only if the selected sentence is the first sentence of that bullet (no period between the bullet marker and the selection)
- Non-first sentences from a bullet point (in cross-block selections) are still indented at list level but rendered without a bullet marker, so they stay visually aligned with neighboring bulleted items
- Numbered list items preserve their original ordinal: selecting item 4 shows "4." not "1."; selecting items 4–8 shows "4. 5. 6. 7. 8."
- Mixed content (e.g. heading + bullet list) groups consecutive list items into their appropriate list type while rendering non-list blocks as plain divs
- Nested list levels are indented with distinct marker styles (ul: disc → circle → square; ol: decimal → lower-alpha → lower-roman)
- Multi-paragraph bullet points (single `<li>` with multiple `<p>` or `<br>` elements) are rendered correctly without extra bullet markers
- Inline citation references (`data-testid="webpage-citation-pill"`) are detected via DOM walking and displayed as boxed pills in the context blockquote, visually separated from surrounding text — works in both single-block and multi-block selections
- Bold text (`<strong>`, `<b>`) is preserved in the context blockquote — bolded words in the original content render as bold in the popup
- Block detection uses `range.intersectsNode()` to find which blocks are actually selected, making it robust against browser Range positioning quirks (casual drags from left edge, selections ending below the last line, container blocks like `<li>` wrapping `<p>`, etc.)
- Sentence context never starts with a citation pill — if a sentence boundary falls right before a pill, the pill is trimmed from the start of the context
- Graceful fallback: if sentence extraction fails, the popup and message use the highlighted text alone

### Chat Injection (Step 2 — ChatGPT only)
- Follow-up question is formatted with the highlighted text quoted as context
- Message is injected into ChatGPT's ProseMirror contenteditable input and dispatched via native input event
- ChatGPT's send button is programmatically clicked after a short delay for React to process
- Graceful error handling: logs to console if chat input or send button is not found

### Response Length Toggle (Step 2b)
- Both the initial question input and the edit question send use a hover dropdown with **Brief** and **Elaborate** options
- Hovering the send arrow reveals the dropdown below; the user must pick a mode to send
- **Brief** mode appends a one-time instruction to keep it to 2-3 sentences, explicitly scoped to this single response only
- **Elaborate** mode appends an instruction to respond at natural length, ignoring any prior brevity requests
- Dropdown appears below the send arrow, themed via CSS variables for light/dark mode

### Response Capture & Hide Q&A (Step 3 — ChatGPT only)
- After sending a follow-up question, the popup transitions to a loading state ("Waiting for response…")
- The extension polls for new conversation turns appearing in the DOM
- When the injected question turn appears, it is hidden from the main chat (`jr-hidden` class)
- When the AI response turn finishes streaming, it is also hidden from the main chat
- The AI response content (rendered markdown) is extracted and displayed inside the popup in a scrollable area (max 300px)
- The highlight and its Q&A turn numbers are saved to `chrome.storage.local`
- If the user dismisses the popup during loading (click outside or Escape), the response watch detaches: the source highlight becomes immediately clickable (`jr-source-highlight-done`), hidden turns remain hidden, and polling continues in the background
- Clicking a detached highlight during generation opens a popup showing "Generating..." — when the response finishes, the popup updates in-place with the actual response
- If the popup is not open when the response arrives, the highlight stays clickable and clicking it shows the completed response
- If the response times out while detached, turns are unhidden, the highlight is removed from `completedHighlights`, and spans are unwrapped
- Gives up only when nothing happens: 100 s without new answer text while ChatGPT is idle (10 min while it says it is generating, e.g. thinking or searching); the item is saved as failed with a retry button and its turns stay hidden
- On page reload, hidden turns reappear (persistence is handled in Step 4)

### Source Text Shadow Highlight & Popup Anchoring (Step 3b)
- When the popup opens from a text selection, the original source text in the AI response is wrapped in persistent highlight spans (`jr-source-highlight`) with a subtle blue tint matching the popup's inline mark
- The highlight remains visible even after the browser's native selection is cleared (e.g. when clicking into the popup's textarea)
- The popup is appended inside the chat's scroll container (not `document.body`), so it scrolls naturally with the content — no scroll/resize listeners or requestAnimationFrame jank
- Popup is positioned to the right of the highlight; falls back to the left side if there isn't enough space on the right
- When the highlight scrolls out of view, the popup scrolls away with it naturally (not stuck at the viewport edge)
- On popup dismiss (click outside, Escape, or SPA navigation), all highlight spans are unwrapped and the original DOM is restored cleanly, with text nodes normalized
- Works with selections spanning bold, italic, code, and other inline elements — each text segment gets its own wrapper
- Falls back gracefully if wrapping fails: popup still works, just without the visual source highlight
- Response detection uses the send button state: ChatGPT's send button disappears during generation and reappears when done — this is a definitive, binary signal (replaces the fragile `.result-streaming` class + MutationObserver stability check)
- Chat scroll position is preserved during injection — `lockScroll()` intercepts both scroll events and programmatic `scrollTo()` calls to prevent ChatGPT's auto-scroll

### Persistent Highlights & Re-open Popup (Step 3c)
- After a response is captured, the source text highlight stays visible even after the popup is closed
- Completed highlights get a `jr-source-highlight-done` class with `cursor: pointer` to signal interactivity
- Clicking a completed highlight re-opens a read-only popup showing the original context blockquote and the AI response (no input row or send button)
- Dismissing a re-opened popup preserves the highlight — it can be clicked again any time
- Multiple completed highlights can coexist in the same conversation
- In-progress or pre-send popups still fully clean up on dismiss (highlight unwrapped, no stale state)
- SPA navigation cleans up all completed highlights (unwraps spans, clears in-memory state)
- In-memory only for this step — highlights do not survive page reload

### Copyable Highlight Text (Step 3d)
- Clicking on source highlight spans while a popup is open programmatically selects all the highlight text for Ctrl+C / Cmd+C
- Works in all popup states: while typing a follow-up question, while the response is generating, and when viewing the completed response
- The popup remains visible while the highlight text is selected — it is not dismissed
- Clicking back into the popup input re-enters edit mode (restores focus for typing a follow-up)
- For completed highlights: first click opens the popup, subsequent clicks on the highlight select text for copy
- Works inside chained popups: clicking a child's source highlights in a parent popup's response selects text for copy instead of spawning another chain
- CSS `user-select: text` ensures highlight text is selectable regardless of host site styles

### Storage Layer (v2, 1.2.0)
- One `chrome.storage.local` key per conversation: `popup:conv:<id>` = `{ v: 2, items: [...], hidden: [turnKey...] }`
- Each item (one version of a highlight) stores keys only: id, quoteId, text, nth (which occurrence of text in its answer), parentId, parentItemId, sourceTurnKey, turnKeys, status, active, wholeResponse, createdAt; the question only while the item is pending or failed
- Answers and questions are read back from ChatGPT (mounted turn, session cache, or ChatGPT's conversation data) — never stored
- Writes go through one serialized chain; other tabs' writes invalidate the cache via `storage.onChanged`
- `getChildHighlights()`, `countDescendants()` (delete confirmation), cascade `deleteHighlight()` (turn keys move to `hidden` so the Q&A stays out of the main chat)

### Persistence Across Reload (Step 4)
- On page load, `restoreHighlights()` queries storage for the current conversation URL
- Event-driven: whenever ChatGPT mounts a turn (it virtualizes the thread), highlights whose source turn is present are re-applied
- For each saved highlight: finds the source turn by `sourceTurnKey`, locates the text via `findTextRange(root, text, nth)` (the nth occurrence, so a repeated word is restored where it was selected), wraps it with `highlightRange()`
- All Q&A turns (level-1 and chained, all versions) are hidden from the main chat on reload
- Restored highlights are fully interactive — clicking re-opens the read-only popup with the saved AI response
- SPA navigation cleans up old highlights and restores for the new conversation after React re-renders
- Highlights that can't be matched (e.g., conversation was edited) are silently skipped

### Chained Popups (Step 4b)
- Highlighting text inside a popup's response area spawns a new child popup **next to the parent** — both popups visible simultaneously
- The selected text in the parent popup's response is wrapped in source highlight spans (same `highlightRange()` as the main chat)
- The chained popup shows the selected text as context in a blockquote, with a contenteditable input and send arrow
- Chained questions are injected into the same ChatGPT thread, so the AI retains full context from the entire conversation
- After response capture, highlight spans in the parent response become clickable (`jr-source-highlight-done`) — clicking reopens the chained popup
- Popup stack: Escape peels off the topmost popup (returning to parent), click outside closes the entire chain
- Infinite chaining depth: a chained popup's response can itself be highlighted to create deeper follow-ups
- When a parent popup is reopened, chained highlights are restored via the same `findTextRange()` + `highlightRange()` text-matching used for page-reload restore — no baked spans in `responseHTML`
- Parent-child relationships are stored via `parentId` in both the in-memory Map and `chrome.storage.local`
- Response mode toggle (Regular/Brief) works in chained popups identically to regular popups

### Resizable Popup (Step 5a)
- Drag the left or right edge of any popup to resize its width
- A `col-resize` cursor appears when hovering within 6px of the popup's left or right edge
- On mousedown at the edge, mousemove tracks in real time to adjust the popup width
- Minimum width: 280px; maximum width: viewport width minus 32px padding
- Level-1 and chained (level 2+) popups have independent widths — resizing a chained popup only affects other chained popups, not level-1
- Each width persists for its level within the same page session
- Works for regular popups, completed popups, and chained popups
- All positioning logic (initial placement, reposition, window resize) uses the popup's actual `offsetWidth` instead of a hardcoded 360px

### Response Markdown Formatting (Step 5b)
- The AI response inside `.jr-popup-response` faithfully reproduces ChatGPT's rendered markdown formatting
- Paragraphs (`<p>`) have proper bottom margins with spacing between sections
- Headings (`<h1>`–`<h6>`) have top/bottom margins, bold weight, and tighter line height
- Horizontal rules (`<hr>`) render as visible 1px separator lines using `--jr-border`
- Code blocks (`<pre>`) have a background tint, border, rounded corners, padding, and horizontal scroll
- Inline code (`<code>`) has a subtle background tint, rounded corners, and padding; nested inside `<pre>` it inherits the block's styles
- Blockquotes have a left border, background tint, and muted text color — matching the popup's context blockquote style
- Lists (`<ul>`, `<ol>`) have proper margins, padding, and explicit `list-style-type` to override host site resets
- Tables have collapsed borders, themed header backgrounds, and consistent cell padding
- Links use the accent color with underline; images are constrained to `max-width: 100%`

### Streaming Response in Popup (Step 6)
- While the AI is generating a response, the popup streams partial content in real time instead of showing a static "Waiting for response…" message
- The response turn is hidden from the main chat immediately when detected; a `MutationObserver` on the response turn fires on every DOM change — the same events that drive ChatGPT's own rendering — so the popup updates at exactly the same speed
- Updates are coalesced via `requestAnimationFrame` (one sync per frame) and use `cloneNode` + `replaceChildren` instead of `innerHTML` to avoid flicker
- The response area auto-scrolls to the bottom during streaming so users can follow along as new content appears
- Works for both level-1 popups and chained popups
- Works with detached popups: if the user dismisses the popup during generation, the observer keeps running in the background; reopening the highlight shows the current partial response and continues streaming
- On timeout, any partial streaming content is replaced with the "Response timed out." message and hidden turns are unhidden

### Popup Anchor Arrow (Step 5c)
- Each popup has a small CSS triangle arrow on its edge pointing toward the source highlight it belongs to
- Arrow sits on the top edge when the popup is below the highlight (up-pointing), or bottom edge when above (down-pointing)
- Arrow position tracks the horizontal center of the source highlight, clamped within the popup's border-radius
- Two-layer border trick: outer pseudo-element in `--jr-border` color, inner in `--jr-bg` — matches the popup's border and background
- Arrow updates automatically on popup position, window resize, parent scroll, and drag-to-resize
- Works for level-1 popups, completed popups, and chained popups in both light and dark mode

### Show Question in Popup (Step 5d)
- After a response is captured, the user's follow-up question is displayed inside the popup between the context blockquote and the AI response
- Styled with a subtle background (`--jr-highlight-bg`), 14px font, medium weight — visually distinct from both the context quote and the response text
- The question appears immediately after sending (before the response arrives), so the user knows what they asked
- Persisted in `chrome.storage.local` via the `question` field on each highlight entry
- Shows on popup reopen and after page reload for both regular and chained popups

### Edit Question & Response Versions (Step 5e)
- Clicking the question text of a completed popup enters edit mode: it becomes editable in place with a subtle underline
- A send arrow appears during edit mode, greyed out until the text actually changes from the original
- Hovering the send arrow reveals a Brief/Elaborate dropdown (same as initial question); Escape cancels edit mode
- On send: the new question is injected into the chat thread, the response is replaced with loading/streaming for the new response
- Both old and new responses are kept as **versions** — a version nav bar (`◀ 1 / 2 ▶`) appears when multiple versions exist
- Clicking version nav arrows switches the displayed question text and response HTML
- Reopening the popup (also after reload) shows the version viewed last; finishing an edit makes the new version current (1.2.0; before: always the newest)
- All versions' Q&A turns stay hidden in the main chat (both on page and after reload)
- Storage: `versions` array and `activeVersion` index on each highlight; backward compatible with single-version highlights
- Dismissing the popup during an edit response detaches (keeps polling), same as new popups
- Works for both level-1 and chained popups

### Delete (Step 7a; the color picker was removed before 1.1.3 — one highlight color)
- A trash button on completed popups opens a confirmation overlay inside the popup showing how many chained follow-ups will also be deleted
- On confirm: highlight spans are unwrapped, Q&A turns stay hidden (not returned to chat), all descendants are cascade-deleted from storage, popup closes
- Deleted turns persist as hidden across page reload (the conversation record's `hidden` list)
- On cancel: popup returns to its normal state
- The trash button only appears on completed highlights, not on new/in-progress popups
- Works in both light and dark mode

### Highlight Hover & Active States (Step 7b)
- One highlight color everywhere (page highlights and popup quote marks): no hover or open-popup shades; the open popup is shown by the underline
- Works for both level-1 highlights in the chat and chained highlights inside popup responses
- Light and dark mode have independently tuned alpha values

### Highlight Navigation Arrows (Step 7d)
- A floating vertical widget appears on the right side of the viewport (middle of the right-side white gap) when there is 1+ level-1 highlight
- Contains up/down arrow buttons and a position indicator (e.g. "2 / 5")
- Only navigates level-1 (outer-layer) highlights in document order — chained/nested highlights are ignored
- Clicking an arrow scrolls the chat to the target highlight and opens its popup
- When no highlight is focused, the indicator shows just the total count; clicking an arrow starts navigation from the first or last highlight
- Buttons are disabled at the endpoints (first highlight disables up, last disables down)
- The widget updates automatically when highlights are created, deleted, restored, or when popups open/close
- `navNavigating` flag suppresses intermediate widget updates during navigation (prevents flicker)
- Cleaned up on SPA navigation and re-created after highlights are restored for the new conversation
- `position: fixed`, vertically centered, no background/border — just arrows and indicator

### Removed in 1.2.0
- Custom search bar (Step 8d) and the popup transition API it relied on (Step 8c: `JR.openHighlight`, `JR.transitionTo`, `JR.go`), removed at the user's request to keep Popup to popups + the highlight navigation widget. The storage model notes from 8c (`quoteId` groups versions, `parentItemId` scopes children to a parent version) still apply.
- The × that hid ChatGPT's own "Ask ChatGPT" selection button (Step 8h): removed at the user's request; Popup no longer touches that button.
- Console API is now only `JR.diagnose()` (hook self-check, see `src/site-adapter.js`).
- The nav widget counts every level-1 highlight in the conversation (including turns ChatGPT has virtualized away) and scrolls to unmounted ones.

## Planned
- **Debugging & polish** (Step 8) — right-side popup placement, delete confirmation refinements, nav widget fix, export highlights, disable toggle, public release prep
