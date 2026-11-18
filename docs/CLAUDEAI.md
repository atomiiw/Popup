# claude.ai support (Step 4, after DeepSeek) — design, probe, evals

Owner: background worker (2026-11-17), for the commander. Source of truth for claude.ai. R36 (ChatGPT) owns the
shared files; nothing here edits them yet — §8 lists the shared-file edits to apply with DeepSeek's (docs/DEEPSEEK.md §8).
Structure follows docs/DEEPSEEK.md.

## 1. User decisions (2026-11-17)
- claude.ai supports **everything ChatGPT has**; released together with DeepSeek (one version).
- Hidden Q&As: **"c then b"** — first find the root cause of the blank flash when scrolling past CSS-hidden Q&As;
  if unsolvable, CSS-only and accept the flash. **Never rewrite claude.ai's binary (connect+proto) data.**
- Mirror rule: the popup shows **claude.ai's own rendered DOM**, never a Popup re-render; **no answer content stored**.
- No DevTools/CDP driving; browser actions only via the Codex operator (Computer Use), human pace.

## 2. Probe 2026-11-17 (read-only, Apple Events; one background tab opened by the worker and closed; the user's own claude.ai tab untouched)
| | Finding | vs 2026-10-28 |
|---|---|---|
| Framing | `frame-ancestors 'self'` (read in-page; curl only sees Cloudflare's challenge) | **new, decisive**: the hidden same-origin render frame (src/chatgpt-render.js) works here — verified: a frame of `/chat/<id>` loaded in ~14 s, rendered 7 rows / 4 replies, no Cloudflare challenge |
| Scroller | `div[data-autoscroll-container=true]` (overflow-y auto) | new selector |
| Virtual list | **"rocksteady"**: `[data-testid=transcript-sizer][data-rocksteady-sizer][data-sizer-excess]` (full height, `position:relative`) > `transcript-leading` (absolute overlay) · top `transcript-spacer` (height = rows above the window) · mounted rows · bottom `transcript-spacer` | **new library**; 30-row chat: 7 rows mounted, sizer 8429 px |
| Rows | `[data-testid=transcript-row]` with `data-index`, `data-rs-index`, `data-perf-row=human|assistant`, `data-perf-row-from-tail`, `data-perf-row-streaming`; inline `display:flow-root; position:relative`; padding/margin 0 | was `[data-testid=transcript-row]` — same id, new attributes |
| Keys | human: `[data-cds=UserMessage][data-turn-key=K]`; assistant: `[data-cds=AssistantMessage][data-testid=assistant-message][data-turn-key="K-hub-reply"][data-is-streaming]` — K = the user message uuid (v7) | same idea; exact elements confirmed |
| Reply body | `[data-cds=AssistantMessage] [data-cds=Prose]` (class `prose`); before it `[data-cds=TurnStatus]` ("Checking …", tool/thinking line) — not part of the answer | new |
| Actions | `[data-cds=MessageActions]` with `data-testid=action-bar-retry`, `action-bar-read-aloud` | new |
| Composer | `div.tiptap.ProseMirror[data-cds=Editor][data-testid=chat-input][contenteditable]` (one); send `button[data-testid=chat-input-send]` (`disabled` while empty, aria-label "Send message"); stop `[data-testid=chat-input-stop]`; attach `[data-testid=chat-input-attach]`; no `<form>` | same + stop/attach ids |
| Theme | `<html class="light">`, `data-mode=light` on cds roots | dark class to confirm (C3) |
| Conversation data | `POST /claudeai-rpc/…ConversationService/StreamTimeline` (connect+proto, binary); send via `ConversationService/PerformAction` (binary); REST also has `chat_conversations/<id>/chat_messages`, `current_leaf_message_uuid`, `side_question` | binary as in October — **not parsed** (user rule) |
| Own scroll anchoring | `[data-transcript-stays-put-scope]` / "held height" (`data-sizer-excess`) module keeps the reading place when rows change | new — interacts with Popup's scroll lock (§8) |
| Debug trace | rocksteady logs to `window.__rsTrace` (an array; `push({t, ev, …})`) when it exists: `ro` (row measured), `ro-skip` (row skipped), `fold`, held-height events | useful for the browser checks (C2) |
| Code / math | none in the probed chats → **unconfirmed** (assumed `pre > code.language-x`, KaTeX) | C1 |

## 3. Site interface (src/sites/claude.js → `JR.sites.claude`)
"Turn" = the **assistant row**, keyed by K (the user message uuid, no `-hub-reply`); its human row is the previous sibling.
| Function | claude.ai |
|---|---|
| turns / turnOf / turnKey | assistant rows; a node in a human row → the next (assistant) row; key = AssistantMessage key minus `-hub-reply` |
| turnSelector(K) | `row:has(UserMessage[key=K]), row:has(AssistantMessage[key="K-hub-reply"])` — both rows |
| findTurnByKey | the assistant row holding `K-hub-reply` |
| hideDeclaration | **`height:0; min-height:0; overflow:hidden; pointer-events:none`** (all `!important`) — never `display:none` (§5) |
| frameScroller / frameTurn / frameTurnCount | real: the render frame works on claude.ai |
| assistantBodies / HTML / Text | `[data-cds=AssistantMessage] [data-cds=Prose]` (not TurnStatus) |
| userText | previous sibling row's `[data-cds=UserMessage]` text (null if the window unmounted it) |
| composer / composerText / composerBox | the visible `[data-testid=chat-input]`; `textContent`; nearest ancestor holding send/stop |
| sendButton / stopButton / isStopButton / isGenerating | send if not `disabled`; `[data-testid=chat-input-stop]`; generating = a reply with `data-is-streaming="true"` or the stop button up |
| composerButtons / composerHasAttachments / attachmentsUploading | stubs until C6 |
| scrollContainer / chatColumn | `[data-autoscroll-container]` |
| popupHost | `[data-testid=transcript-list]` (full-height column above the sizer; not a row) |
| visibleBand | scroller top → composer box top − 8 |
| codeBlocks / codeText | `pre` > `code.language-x` (C1 confirms) |
| math selectors | KaTeX (C1 confirms) |
| citation / entity / chart / answerComponents / renderFailed / undrawnWidget | none |
| conversationId / isChatPage | `/chat/<uuid>` |
| turnSelectorAll (→ JR.SEL.turn) | `[data-testid=transcript-row]` |

## 4. Network / streaming — no binary parsing
- Popup sends exactly like the user: types into the tiptap editor (same ProseMirror insertion as ChatGPT), waits for the
  send button to be enabled, clicks it. No request rewriting, no response parsing (binary stays untouched).
- New-turn detection: chat.js's DOM path (turns before vs after + exact question text) — the K of the new human row.
  To verify (C4): K is final from the first render (not a temporary id replaced later), else stored keys break after a reload.
- Streaming: mirror the hidden assistant row's `[data-cds=Prose]` (claude.ai's own rendering, incl. its streaming
  animation) — like ChatGPT's `syncAnswerInto`. No network text fallback (there is none without parsing binary).
  Generating = `data-is-streaming="true"` / stop button.
- Risk (C4): if rocksteady unmounts the new (hidden, 0-height) tail rows while the reader is far above, there is no source
  to mirror → the popup must then use the render frame (§6) after the answer ends, and show a "answering…" state
  meanwhile. rocksteady has `keptTailIndexes` / `trailsLatestExchange` (keeps the latest exchange mounted) — likely fine.

## 5. Hiding — root cause of the 2026-10 blank flash (found, code-level)
- rocksteady measures rows with a ResizeObserver. Its callback (claude.ai bundle `shared-31-*.js`):
  `let l = t.borderBoxSize?.[0]; if (l) { if (l.blockSize === 0 && l.inlineSize === 0) { skipped.add(row); continue } … }`
  — a row whose border box is **0×0 is skipped and keeps its old/estimated height**. `display:none` makes a row 0×0, so the
  spacers keep counting the hidden rows' old heights → blank space while scrolling past them (P3), gone when not hiding (P3b).
- Fix (CSS only, no binary): hide with **height 0 and the row's width kept** (`JR.sites.claude.hideDeclaration`). The border
  box is then `blockSize 0, inlineSize > 0` → measured and stored as 0 → the spacers are right → no blank.
  Offline proof: tools/dom-test-claude.html (display:none → 0×0 "skipped"; hideDeclaration → 0 × width "measured";
  the row takes 0 px in the flow). Live proof: C2 (with `window.__rsTrace = []`: hidden rows give `ro` with h 0, no `ro-skip`;
  ~30 wheel scrolls past hidden Q&As: no blank).
- Both rows of a Q&A are hidden; `:has()` selectors (the keys are inside the rows).
- Watch (C2): claude.ai's "held height" (`data-sizer-excess`) may hold the old height of the just-hidden tail rows for a
  moment after a send (blank at the bottom) — measure; if so, the early-hide rule must apply before the rows' first paint.

## 6. Mirror plan
- **While streaming:** mirror the hidden assistant row (claude.ai's DOM) into the popup — no Popup re-render.
- **After it ends / after a reload:** the hidden same-origin render frame (src/chatgpt-render.js, generalized as the site's
  render frame — it calls `JR.site.frame*` / `assistantHTML` / `assistantText` / `conversationId`, but **hard-codes
  ChatGPT's URL** `"/c/" + conv`: it must use `JR.site.chatUrl(conv)` — §8.8): load `/chat/<id>` in an
  off-screen iframe (Popup doesn't run in frames → nothing hidden there), scroll its list to the row with `K-hub-reply`,
  copy `[data-cds=Prose]` when its text is stable. Nothing stored. Verified it loads and renders (§2).
- Lessons from ChatGPT (R36f/g): keep the streamed DOM at the end (no rebuild); styles that claude.ai generates at runtime
  inside the frame (if any, e.g. code highlighting) must be scoped to frame-sourced answers (R36g plan) — check in C1.

## 7. Read-back after a reload
- No REST/JSON read of answers needed: the render frame gives claude.ai's own rendering. (If ever needed, REST
  `chat_conversations/<id>/chat_messages` may be JSON — not probed; binary StreamTimeline is off limits.)

## 8. Shared-file edits beyond DeepSeek's list — **applied 1.2.13-dev.32** (docs/DEEPSEEK.md "Wiring")
1. `manifest.json`: host `https://claude.ai/*`; load `src/sites/claude.js` before `site-adapter.js`; `chatgpt-render.js`
   also on claude.ai (rename to a neutral name, e.g. `site-render.js`); `net-tap.js` stays ChatGPT-only (no claude-net).
2. `site-adapter.js`: pick `JR.sites.claude` on `claude.ai`.
3. Hiding (`qa-content.js` `JR.hideTurnKeys`, `early-hide.js`): use `JR.site.hideDeclaration || "display: none !important"`
   instead of a hard-coded `display:none`. **Required for claude.ai** (else the blank flash returns).
4. `scroll-guard.js`: scroller selector by hostname (`[data-autoscroll-container]` on claude.ai). Check its interplay with
   claude.ai's own stays-put/held-height anchoring (they also scroll programmatically) — C4.
5. `storage.js`: key `popup:claude:conv:<id>`; conversation id from `/chat/<uuid>`.
6. Popup's dark theme: add claude.ai's dark marker (C3) wherever `html.dark` sets Popup's theme.
7. `JR.qa.ensure` / conversation-API read-back (ChatGPT REST) off on claude.ai; `JR.qa.upgrade` → render frame.
8. `chatgpt-render.js`: `frame.src = JR.site.chatUrl(conv)` instead of `"/c/" + conv`; add `chatUrl` to ChatGPT's
   site-adapter (`"/c/" + conv`) and DeepSeek's (`"/a/chat/s/" + conv`, unused there: no framing).
9. `early-hide.js` (runs at document_start, before the site layer, and builds its own `[data-turn-key="K"]` rules): on
   claude.ai it must hide **both rows** — `row:has(UserMessage[key=K]), row:has(AssistantMessage[key="K-hub-reply"])`
   with the height-0 declaration. As it is now it would hide only the inner UserMessage div (display:none) and leave the
   answer row visible — a bug the moment claude.ai is wired in. Cleanest: early-hide gets the selector + declaration from
   one small per-host table shared with the site layers.
10. Lean: `textWithBreaks` exists three times (site-adapter.js, sites/deepseek.js, sites/claude.js) — move one copy to
    dom-helpers.js (loaded before the site layers) and use it from all three.

## 9. claude.ai eval set (fixed; run every iteration; same style as docs/EVALS.md)
| id | case | edge | pass |
|---|---|---|---|
| CL-hide-1 | hide a Q&A, scroll ~30 wheel steps past it both ways | several hidden in a row; first/last row of the chat | no blank (screenshots + `__rsTrace`: no `ro-skip` for hidden rows) |
| CL-hide-2 | send from a popup, watch the bottom of the chat | first send after load | no held-height blank at the bottom |
| CL-send-1…5 | as EVALS E-send-1…5 (Return / arrow / Reply / edit / retry) | first send after load; boundary between answers; near bottom | P-still, P-noflash |
| CL-place-1 | popup on a first-line highlight under the user bubble | above/below side | P-place |
| CL-render-1 | answer with table + formula + code, watch the end of streaming | same session | P-chatgpt-equivalent (claude.ai's own DOM: `data-cds` marks, KaTeX), P-same, P-code |
| CL-render-2 | reopen it after a reload (render frame) | after reload | claude.ai's DOM, no change after opening |
| CL-stream-1 | long answer streaming in a popup | — | claude.ai's own streaming animation, no chunks |
| CL-key-1 | send, then reload | — | the stored key K matches the row after reload (popup reopens, Q&A stays hidden) |
| CL-context-1 | after a popup Q&A, ask in the main chat "what did I just ask?" | — | Claude knows (Q&A is in its context) |
| CL-nest-1 | nested popup + Reply | — | opens on first press; works |
| CL-theme-1 | dark mode | — | Popup's dark theme |
| CL-think-1 | extended thinking / web search on | — | popup shows the reply (TurnStatus excluded or shown — Q2) |
| CL-regress | ChatGPT + DeepSeek eval sets | — | unchanged |

## 10. Browser requests for the commander (Codex, a claude.ai test chat, human pace)
- **C1** In a new claude.ai test chat send one normal message asking for a small table, a formula and a short Python code
  block (thinking off). Observer reads the answer DOM: code block / KaTeX / table structure, any runtime `<style>` it adds.
- **C2** Hiding check (no messages): in a chat with ≥ 6 rows, observer sets `window.__rsTrace = []` and injects a test
  `<style>` hiding 2 Q&As with `JR.sites.claude.hideDeclaration` (vs a second run with `display:none`); Codex scrolls
  ~30 wheel steps past them both ways; screenshots + trace. Expected: display:none → `ro-skip` + blank; hideDeclaration → no blank.
- **C3** Toggle dark mode: observer reads `<html>` class / `data-mode`.
- **C4** Send one message via the normal composer while scrolled far up: does the new tail exchange stay mounted while it
  streams (rows with `data-perf-row-streaming=true`)? Is K the same from the first render to after a reload? Does
  claude.ai scroll programmatically (stays-put) during the send?
- **C5** Same as C1 with extended thinking on (and web search on): what the AssistantMessage contains (TurnStatus, thinking).
- **C6** Paste an image into the composer without sending: the file chip's DOM.

## 11. Open questions for the user
1. (none blocking) The blank flash has a CSS-only fix (no binary) — once C2 confirms it, "b" (accept the flash) isn't needed.
2. Extended thinking / tool use: should the popup show claude.ai's status line ("Searched the web", "Thought for 12s")
   above the reply, like claude.ai does, or only the reply text? (Default in claude.js: reply only.)

## 12. Review (ponytail-review, 2026-11-17)
- Interface complete: all 52 `JR.site` members ChatGPT's adapter has exist in `JR.sites.claude` (+ `hideDeclaration`,
  `chatUrl`, `name`, `turnSelectorAll`). Checked in headless Chrome.
- Must fix (wiring): render frame hard-codes ChatGPT's URL → `JR.sites.claude.chatUrl` added (+ test), §8.8;
  early-hide.js would hide only the inner user div with display:none on claude.ai → §8.9 (shared file, Step 4a).
- Should fix (lean): `textWithBreaks` ×3 → §8.10.
- Not checked: cost of the `:has()` hide rules while an answer streams with many hidden Q&As (Chrome re-checks `:has`
  on DOM insertions) — measure in C2 (frame times with ~20 hidden Q&As while streaming).

## Browser results 2026-11-17 (Codex Computer Use + read-only Apple Events; test chat b405b841, created for this)
- **Test chat:** https://claude.ai/chat/b405b841-d9b0-4045-8de5-385de0dc2683 (Fable 5.2, effort Low; no separate
  extended-thinking switch in the model menu; web search off). 8 Q&As. The user's own claude.ai tab (8e9d…) untouched.
- **C1 — answer DOM (table + formula + Python):** `[data-cds=Prose]` › `div.standard-markdown`; formula = KaTeX
  (`.katex-display` ×1); table in `div.md-table-scroll`; code = plain `<pre><code class="language-python">` inside
  `div.relative.group/copy` with a "Copy to clipboard" button — **no CodeMirror**; 59 token spans whose colors are
  **inline styles** (`style="color: rgb(…)"`) and `white-space: pre` → a copied/mirrored answer keeps code colors and
  indentation without any runtime stylesheet (no R36g-type problem). No `[data-cds=TurnStatus]` on a plain answer.
- **C2 — hiding (the blank flash), confirmed live:** same chat after it was made long enough to virtualize (16 rows,
  8 mounted, scrollHeight 5224); the top 3 Q&As hidden by an injected style; Codex wheel-scrolled down to the bottom and
  back up (~35/40 steps, 0.5 s each); observer sampled every frame after paint (largest gap between visible rows, blank
  above the first row).
  | hide rule | frames with a blank > 80 px | largest blank | Codex saw |
  |---|---|---|---|
  | `display:none` (X4) | 8 618 of 55 873 | 774 px (whole view) | whole-screen blank at the top for ≥ 12 s, ~350 px blanks mid-way |
  | `JR.sites.claude.hideDeclaration` (height 0, width kept) (X5, after a reload) | **0 of 22 687** | **0 px** | content continuous; only claude.ai's normal ~150 px gap above the composer at the bottom |
  → the root cause in §5 is right and the CSS-only fix works; the "accept the flash" fallback is not needed. Evidence:
  `collab/evidence/claude/2026-11-17/X2-top-none.png, X4-blank-{1,2,3}.png, X5-top.png, X5-blank-1.png`.
  Note: `window.__rsTrace = []` set after load recorded nothing (probably read at module start) — not needed.
- **C4 — send while scrolled up (X6, X7):** claude.ai **scrolls the thread itself on a send**: the new question is put
  at the top of the view at once (scrollTop 1606 → 4942; 666 → 5566), and it keeps moving down while the answer
  streams. A scroll guard patched into the page *after load* (scrollTo/scroll/scrollBy/scrollIntoView and the
  `scrollTop` setter on the thread scroller) intercepted **0** calls and the page still jumped → claude.ai uses
  references it took at load (or another path), so Popup's guard must be installed at `document_start` in the MAIN
  world (like ChatGPT's scroll-guard.js) — verify after wiring. The new exchange's rows were mounted (`data-perf-row-
  streaming=true`) from their first appearance to the end; whether they stay mounted while the reader stays far up is
  still open (needs the document_start guard). **K is stable**: the new exchange's key (89f49055…) was the same after a
  reload.
- **C5 — status line, live (2026-11-17 14:03, Fable 5.2):** this account's model menu has no "Extended thinking" switch (only Effort Low…Max) and no Web search switch (search runs on its own); tested with Effort High, restored to Low. While generating, a grey progress line (`Building the table…`, timer) sits above the reply; when done it becomes a collapsed `[data-cds=TurnStatus]` "Searched the web" (expands to the search steps). TurnStatus is a sibling of `[data-cds=Prose]`, never inside it → `answerBody` = Prose excludes the status line as the user decided. 1 Prose + 1 TurnStatus in the turn; `answerBodies` already returns every Prose of a turn.
- **C3 — dark mode, live:** `<html data-mode="dark" data-theme="claude">` (no `dark` class; light = `data-mode="light"`); body bg rgb(25,25,25). Popup's dark theme rules (styles.css `html.dark` ×3) need `html[data-mode=dark]` added. Inner `[data-mode]` roots ("cowork", "code") are not the theme. The user's setting was System; restored after the check.
- **C6 — pasted image, live (not sent):** stable markers: `[data-composer-attachments] [data-cds=MessageAttachments] [data-cds-attachment]` (image: `data-cds=MessageAttachmentsImage`, `data-testid=file-thumbnail`), remove = `button[data-cds-attachment-remove]` (aria-label "Remove <name>", shown on hover). No file name text; small images show a "Low res" warning. No upload spinner seen (small file uploaded at once) → attachmentsUploading still needs a big-file check. → composerHasAttachments = `!!document.querySelector("[data-composer-attachments] [data-cds-attachment]")`.
