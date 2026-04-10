# Popup

Chrome extension that turns ChatGPT's linear chat into a branching conversation. Highlight any part of a response, ask a follow-up in a floating popup, and keep going. Popups nest recursively, so you can drill as deep as you want without cluttering the main thread.

Built Feb to Mar 2026. Solo project.

## How it works

1. Highlight text in a ChatGPT response
2. A floating popup appears with an input field
3. Type a follow-up. It gets injected through ChatGPT's own chat input (no API key)
4. The Q&A pair is hidden from the main chat and displayed inside the popup
5. Highlight text inside the popup to open another popup. Nest as deep as you want

The AI sees every popup Q&A as real messages in the thread, so it keeps full context. Without the extension installed, the conversation is still there, just flat.

## Features

**Nested popups.** Follow-ups inside follow-ups, unlimited depth.

**Persistent.** Highlights and popup chains survive page reload, rebuilt via DOM text-matching.

**Search.** Full-text search across all popup content including hidden Q&A. Results return in reading order and auto-open the matching popup chain.

**Version history.** Edit a question to get a new response. Previous versions are preserved and navigable.

**Transition system.** Navigate between any two popups by computing their common ancestor, collapsing up, then opening down.

**Invisible injection.** Reverse-engineered ChatGPT's React/ProseMirror frontend to keep injected prompts hidden from the user.

**Highlight toolbar.** Color picker (3 colors), delete with cascade, hover/active states.

**Reply to whole response.** Follow up without highlighting specific text.

**Image galleries.** Multi-image responses shown as collapsed thumbnails with a lightbox carousel.

**Resizable popups.** Drag to resize, persisted per nesting level.

**Dark mode.** Matches ChatGPT's theme automatically.

## File structure

```
manifest.json          Extension config and permissions (Manifest V3)
content.js             Event listeners, popup transitions, initialization
storage.js             chrome.storage.local, persist/query highlights and Q&A
styles.css             All styles (no inline styles in JS)
src/
  jr-namespace.js      Shared state: global registry (completedHighlights Map),
                       popup stack, constants
  chat.js              Inject questions into ChatGPT's input, message queue
  popup.js             Popup creation, positioning, version nav, delete, resize
  popup-helpers.js     Stack push/pop, positioning helpers, highlight nav widget
  highlight.js         Highlight wrapping, restore on reload, cascade delete
  search.js            Custom search: tree index, DFS collection, mark insertion
  text-extraction.js   Sentence extraction, block detection, context formatting
  dom-helpers.js       Scroll, layout, DOM utilities
  console-bridge.js    Debug helpers (JR.go, JR.state inspection)
  early-hide.js        Hide Q&A turns before React renders them
```
