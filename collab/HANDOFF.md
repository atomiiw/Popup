# HANDOFF — ChatGPT 2026-10 redesign fix (Popup 1.2.0)

Last updated: 2026-10-27. Read this first, then `collab/PLAN.md` (approved plan, Chinese) and `docs/DEBUG.md` #44–#52.

## Status in one paragraph
Popup broke when ChatGPT redesigned its frontend (Oct 2026). Phase 1 (DOM migration) and Phase 2 (keys-only storage + performance) are implemented and verified live as **1.2.0-dev.55** by a Codex "operator" session in the user's Chrome: core flow, nested popups (5 levels), reply-to-whole, cascade delete, reload restore, read-back of answers not in the DOM, asking from the middle of a long chat, queued sends, 20-question stress test (~8 KB storage). Since dev.12: the search bar and transition API were removed (user request), a ponytail simplicity pass deleted ~1,900 lines, per-mount work runs in idle slices, the × on ChatGPT's "Ask ChatGPT" button was removed (user request), and **hidden Popup Q&As no longer leave gaps**: `src/net-tap.js` filters them out of the conversation data the page receives and fixes the parent of the user's next message so ChatGPT keeps the Popup context (DEBUG #52; verified: normal send, edit, regenerate, ChatGPT recalled the hidden question; T24 regression passed). Since dev.37: a ponytail-audit of the whole repo was fixed (timeouts measured from the last answer progress, repeated-word highlights restored at the same occurrence via `nth`, multi-line questions keep their line breaks, retries queue, "Popup was updated, refresh" notice after an extension reload, ~150 dead lines removed), popups reopen on the version viewed last, dark mode uses an ice-blue accent, highlights change shade on hover / while open; verified live in dark mode + Chinese UI (T27–T28). The extension-updated notice was verified live (T29). Formulas (KaTeX) are handled exactly: questions carry TeX, quotes show the rendered formula with the exact selected characters marked (DEBUG #54, T30–T31). "This response couldn't load" on regenerated answers is a ChatGPT bug (reproduced with Popup disabled in a new chat, DEBUG #51). **Not yet done:** version 1.2.0 without `version_name`, Chrome Web Store upload, items under "Not verified".

## How Popup works now (new modules)
| File | World | Role |
|---|---|---|
| `src/site-adapter.js` | isolated | The ONLY place with ChatGPT DOM selectors (`JR.site`, `JR.SEL`). Candidate lists per hook (newest DOM first), visible-only composer/buttons, everything scoped to the visible page (ChatGPT keeps hidden SPA copies of other pages). `JR.diagnose()` → `#jr-diagnostics[data-json]`, health banner. |
| `src/qa-content.js` | isolated | Message format (`JR.buildMessage` / `JR.parsePopupMessage`), CSS hiding by turn key (`JR.hideTurnKeys`), session-only content cache `JR.qa` (DOM harvest → conversation API `JR.qa.ensure`), turn-mount observer (re-apply highlights, self-heal hide of Popup-format turns), markdown renderer for network text, perf counters (`JR.perf`, long tasks). |
| `src/chat.js` | isolated | Injection with verification, freeze (MutationObserver hides new turns before paint), new-turn detection by key + exact question text, incremental streaming mirror (`syncAnswerInto`), network-stream fallback, rejection detection + one resend, queue. |
| `storage.js` | isolated | v2: one key per conversation `popup:conv:<uuid>`, items store keys only (question kept only while pending/failed), serialized writes, v1 migration (backup kept in `jumpreturn_highlights_v1_backup`). |
| `src/scroll-guard.js` | MAIN | While `html[data-jr-scroll-lock]` (timestamp, 2-min expiry) ignores ChatGPT's programmatic scrolls of the thread. |
| `src/net-tap.js` | MAIN | (1) Filters Popup turns out of `GET /backend-api/conversations/<id>?num_turns=…` and `…/messages` responses and rewrites `parent_message_id` of conversation POSTs when removed Popup messages follow the page's chosen parent (DEBUG #52, test `tools/net-tap-test.js`, off with `#jr-nofilter`). (2) Tees ChatGPT's response stream ONLY for Popup-format questions; emits `jr-net` events (start/turn/text/done). `input_message.id` == the turn's `data-turn-key`. Batched patches arrive as `{"v":[...]}` with `"o":"patch"` omitted. Last request's raw events in `#jr-netlog`. |

Key facts about the new ChatGPT DOM (measured): one `[data-turn-key=UUID]` per question+answer; thread virtualized (4–8 turns in DOM); answer body `[data-markdown-text-style="assistant-message"]` (or `[data-dil-message-id]`); composer `.ProseMirror[data-composer-markdown]` (hidden duplicates exist); send `button[aria-label="Send"]`, stop `aria-label="Stop"`; scroll container `[data-app-action-timeline-scroll]`; popups are hosted in the full-height list under `[data-thread-find-target=conversation]`; after a send ChatGPT adds a spacer (`div.shrink-0` after the list) — hidden while the newest turn is a Popup Q&A (`html.jr-tail-hidden`). ChatGPT sometimes shows "This response couldn't load" (`[data-dil-render-failed]`) — a ChatGPT bug (verified with Popup disabled); Popup never caches that text.

## Not verified / known limits
- Branch switching inside one page load (ChatGPT now only previews other versions in a "See versions" dialog, which does not reload data); the parent fix resets on every first-screen load.
- First screen made only of Popup turns (≥10 Popup Q&As after the last normal message): left unfiltered by design (CSS hiding); not seen live.
- Simulated hook failure banner (`JR.diagnose({break:"composer"})` in DevTools) — not run live.
- Sidebar open/close and dark mode with a popup open (clicking the sidebar button closes the popup, same as 1.1.3).
- Old-data migration with real v1 data (the test install had none).
- No side-by-side perf comparison against 1.1.3; longest single long task seen: 461 ms during 5-level nesting.
- Deep nested popups can partly scroll above the viewport; edit-mode cannot open the length menu (pre-existing).

## Next steps
1. User reloads, quick smoke test (select → ask → answer; reload → reopen).
2. Set `manifest.json` version 1.2.0 without `version_name`, build the store zip (extension files only: manifest, storage.js, content.js, styles.css, src/, icons/), user uploads to the Chrome Web Store.
3. Optional: the "Not verified" items; phase-2 polish (nested popup viewport clamp).

## Working setup (for agents)
- User is not an admin on this Mac. `git` via `/Applications/Xcode.app/Contents/Developer/usr/bin/git`; Python via `~/.venvs/collab/bin/python` (uv). Never ask for sudo.
- Loading: user loads `~/Documents/Popup` unpacked in `chrome://extensions` and clicks ↻ after every change (agents cannot open chrome:// pages). Bump `version_name` on each change so the running version can be checked in `#jr-diagnostics`.
- Live testing: a Codex session "operator" drives the user's Chrome through the ChatGPT-for-Chrome extension (DOM read/click/type only; no page JS, no fetch). Protocol: `collab/PROTOCOL.md`, tools in `tools/`. The message board `collab/BOARD.md` and screenshots/JSON in `collab/evidence/` are local-only (gitignored: they contain the user's conversation content).
- Sending messages from the user's account always needs the user's explicit OK and a message budget; only in conversations the user named.
- Checks without a browser: syntax via `osascript -l JavaScript` with `new Function(src)` over each file; load order `osascript -l JavaScript tools/load-smoke.js "$PWD"`; filter/parent logic `osascript -l JavaScript tools/net-tap-test.js "$PWD"`; message format `node tools/qa-content-test.js "$PWD"`; text matching: open `tools/dom-test.html` in Chrome (headless command in the file).
