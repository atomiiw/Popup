# DeepSeek support (Step 4) — design, probe, evals

Owner: background worker (2026-11-17), for the commander. Source of truth for Step 4. ChatGPT work (R36) runs in parallel and owns the shared files; nothing here edits them yet — §8 is the exact edit list to apply after R36.

## 1. User decisions (2026-11-17)
- DeepSeek supports **everything ChatGPT has**: highlights, popup questions, streaming, hidden Q&As, nested popups, Reply, edit versions, retry, attachments, reload restore / read-back, scroll lock / placement.
- DeepThink / Search toggles: **keep whatever the user has set** — Popup sends exactly like the user would (types into DeepSeek's box and presses send). No special handling.
- Release together with claude.ai (later).
- Hard rules: no answer content stored; the popup shows **DeepSeek's own rendered DOM** (mirror), never a Popup re-render (lesson of ChatGPT R34/R36); no DevTools/CDP driving; human pace.

## 2. Probe 2026-11-17 (read-only, Apple Events; tabs opened in the background and closed)
| | Finding | vs 2026-10-28 |
|---|---|---|
| Login | user logged in; body class `apple en_US light` | same |
| Composer | one `textarea` (`name="search"`, placeholder "Message DeepSeek"); no `<form>` | same |
| Send / stop | one round button `[role=button].ds-button--primary.ds-button--circle` (icon changes to a square while answering) | same |
| Scroller | `.ds-virtual-list` (overflow auto), top 60 px | same |
| List | `.ds-virtual-list-items` (min-height = whole conversation, padding centres the column) > `.ds-virtual-list-visible-items` (`transform: translateY(...)` window) > items | **new detail**: a sliding window |
| Virtualization | ~**14 items mounted** around the screen; the window slides as you scroll (42-item chat: keys 1–14, 2–15, 4–17 …) | confirmed |
| Items | each message is its own `[data-virtual-list-item-key=<message id>]`; user item then answer item | same |
| Ids | server message ids, **not always consecutive**: chat dcb32740 has 1,2,4,5 (3 = a regenerated branch) | **new**: the "N / N+1" pairing in PLAN-next.md is wrong — pair by DOM order (user item = the answer's previous sibling) |
| Answer body | `.ds-markdown.ds-assistant-message-main-content` > `p.ds-markdown-paragraph`, `h3`, `hr` … | class names confirmed |
| User text | `.ds-message .ds-collapsible-text` | — |
| Code / math | none in the probed chats → **unconfirmed** (`.md-code-block > pre` per Oct; KaTeX assumed) — browser request B1 | open |
| Framing | `Content-Security-Policy: frame-ancestors 'none'` | **new and decisive**: no hidden iframe is possible (ChatGPT's R34 render frame can't be reused) |
| History API | `GET /api/v0/chat/history_messages?chat_session_id=<uuid>` (no `cache_version` param now) | changed |
| Page load also calls | `create_pow_challenge`, `chat_session/create`, `chat/status`, `users/auth_token/check_device` | new (anti-bot proof-of-work on send — Popup sends through DeepSeek's own UI, so it's DeepSeek's own code that solves it) |
| CSS hiding gaps | Oct P3: `display:none` closes fully, ~200 scrolls without blanks. Re-check today failed (background tab not rendering) → browser request B7 | to re-verify |

## 3. Site interface (src/sites/deepseek.js → `JR.sites.deepseek`)
Every `JR.site.*` Popup calls, DeepSeek's answer. "Turn" = the **answer item**, keyed by the answer's message id; its user item is the previous sibling.
| Function | DeepSeek |
|---|---|
| turns / turnOf / turnKey | answer items; a node in a user item → its answer; key = item key, a temporary (negative) key → its real id once `jr-net turn` named it, else null |
| turnSelector(key) | `[key=K], [item]:has(+ [key=K])` — answer + user item; also under the temporary keys mapped to K |
| findTurnByKey | real key or its temporary keys |
| assistantBodies / HTML / Text | `.ds-assistant-message-main-content` (fallback `.ds-markdown`); DeepThink's reasoning not included |
| userText | previous sibling's `.ds-message` text |
| composer / composerText / composerBox | the visible textarea; `.value`; nearest ancestor holding the send button |
| sendButton / stopButton / isStopButton / isGenerating | the primary round button; generating = `<html data-jr-ds-generating>` set by deepseek-net.js while any completion streams |
| composerButtons / composerHasAttachments / attachmentsUploading | stubs until B5 |
| scrollContainer / chatColumn | `.ds-virtual-list` |
| popupHost | `.ds-virtual-list-items` (never unmounted) |
| visibleBand | scroller top → composer box top − 8 |
| codeBlocks / codeText | `.md-code-block > pre`, textContent (B1 confirms) |
| math selectors | KaTeX, same as ChatGPT (B1 confirms) |
| citation / entity / chart / answerComponents / renderFailed / undrawnWidget | none (`:not(*)`, empty, false) |
| frameScroller / frameTurn / frameTurnCount | null / 0 (render frame impossible) |
| conversationId / isChatPage | `/a/chat/s/<uuid>` |
| turnSelectorAll (→ JR.SEL.turn) | `[data-virtual-list-item-key]` |

## 4. Network listener (src/sites/deepseek-net.js, MAIN world)
- Wraps XHR (DeepSeek's send in Oct) and fetch: `POST /api/v0/chat/completion`, body JSON `prompt`.
- Every completion sets `<html data-jr-ds-generating>` until it ends (Popup's or the user's).
- Popup-format prompts only: `jr-net` events exactly as net-tap.js: `start`, `turn {turnKey: response_message_id, userKey: request_message_id}` (from `event: ready`), `text {text}` (cumulative answer), `done`.
- Answer text = the response part only; DeepThink reasoning skipped. Two stream shapes handled: path patches (`response/content` vs `…thinking_content`, bare `{v}` continues the last path) and fragments (`response/fragments` APPEND `[{type, content}]`, `fragments/-1/content` APPEND; type THINK skipped). Which one DeepSeek uses today → B1/B2.
- No data filtering, no parent rewrite: hidden Q&As stay in DeepSeek's data and context.
- Temporary keys: deepseek.js listens to `jr-net turn` and maps the newest negative answer key (and its user item) to the real ids, so chat.js's existing turn handling (`qaKeys.push(d.turnKey)`, `hideTurnKeys`, `findTurnByKey`) works unchanged and the stored keys are the real ids that survive a reload.

## 5. Hiding
CSS only (early-hide at document_start + JR.hideTurnKeys), on both items of a Q&A via `turnSelector`. No network filtering (Oct P3: no gaps; re-verify B7).

## 6. Mirror — decided (user, 2026-11-17)
**Design: mirror DeepSeek's own DOM whenever DeepSeek has the item on the page (same session); the old method after a reload.** No extra window or tab (user: not acceptable), no iframe (DeepSeek: `frame-ancestors 'none'`).
- **While the answer item is mounted**: Popup's incremental mirror (chat.js `syncAnswerInto`) copies `.ds-assistant-message-main-content` as DeepSeek draws it — DeepSeek's fade-in included — and the result is kept **in memory** for the rest of the session (the ChatGPT R36 design: keep the mirrored DOM once captured, no rebuild at the end; nothing stored). DeepThink's reasoning is never copied (`assistantBodies` skips anything inside a `…think…` container).
- **Where that can fail**: DeepSeek mounts ~14 items around the screen (sliding window). Idle, it does **not** keep the newest item mounted far away (42-item chat at the top: keys 1–14 only). Whether it pins the item that is *streaming* is unknown → B9. If it doesn't, a popup on a highlight more than ~6 Q&As above the bottom has no mounted item while it streams; then the popup streams from the network text (the old method, below) until/unless the item mounts.
- **After a reload — the old method**: Popup renders the answer's Markdown from `history_messages` itself (`JR.sites.deepseek.answerMarkdown` → `renderAnswer`), dressed in **DeepSeek's own answer classes** so DeepSeek's page CSS styles it like the real answer: root `.ds-markdown.ds-assistant-message-main-content`, `p.ds-markdown-paragraph`, plain `h3`/`hr` (measured); code block / table / list / KaTeX classes to be measured from B1 and added to `DS_CLASS` in deepseek.js. If the real item is mounted (scrolled near), the mirror replaces it.
- Ruled out: a minimized window / background tab (user), an iframe (DeepSeek's CSP), moving the reader (changes the user's place).

## 7. Read-back after a reload
`JR.sites.deepseek.fetchHistory(conv)` → `GET /api/v0/chat/history_messages?chat_session_id=<id>` with the page's own login (same origin; `Authorization: Bearer <localStorage userToken>` as the page sends it) → `data.biz_data.chat_messages` (shape to confirm with B1). Used to link stored items to their messages and for the old-method render (§6); nothing stored.

## 8. Step 4a refactor — exact edits to shared files — **applied 1.2.13-dev.32** (see "Wiring" at the end)
1. **manifest.json**: add `https://chat.deepseek.com/*` to `host_permissions` and to every content-script `matches` except net-tap.js / chatgpt-render.js / scroll-guard's ChatGPT part; in the ISOLATED document_idle list insert `src/sites/deepseek.js` **before** `src/site-adapter.js`; add a MAIN-world document_start entry for `https://chat.deepseek.com/*` with `src/sites/deepseek-net.js` (+ scroll-guard.js); keep `src/net-tap.js` and `src/chatgpt-render.js` matched to ChatGPT only (split the entries by matches).
2. **src/site-adapter.js**: at the end, `if (/(^|\.)chat\.deepseek\.com$/.test(location.hostname) && JR.sites && JR.sites.deepseek) { JR.site = JR.sites.deepseek; JR.SEL.turn = JR.site.turnSelectorAll; }`; make `JR.diagnose` use only `JR.site.*` (its `visibleScroller()` / `all("scrollContainer")` / `used` are ChatGPT internals → read `JR.site.scrollContainer()` there).
3. **One conversation-id rule**: storage.js and early-hide.js each parse `/c/<uuid>` themselves; make them use the site's rule (early-hide runs at document_start before the adapters: inline a 2-line per-host regex there, comment "keep in sync with JR.sites.*.conversationId").
4. **Per-site storage key prefix**: ChatGPT keeps `popup:conv:<id>` (no migration); DeepSeek `popup:deepseek:conv:<id>` — storage.js `CONV_PREFIX` by hostname; early-hide.js the same; site-adapter.js `writeDiagnostics` convKey the same.
5. **early-hide.js** hide rule: on DeepSeek build `turnSelector`'s form (`[data-virtual-list-item-key="K"], [data-virtual-list-item-key]:has(+ [data-virtual-list-item-key="K"])`) instead of `[data-turn-key="K"]`.
6. **src/scroll-guard.js**: `SCROLLER` by hostname (`.ds-virtual-list` on DeepSeek).
7. **ChatGPT-only code off on DeepSeek; DeepSeek read-back on**: qa-content.js `fetchConversation`/`JR.qa.ensure`/`popupTurnsFromApi` → on DeepSeek use `JR.site.fetchHistory(conv)` (messages by `message_id`; answer = the assistant message whose `parent_id` is the question) and draw with `JR.site.renderAnswer(JR.site.answerMarkdown(msg))` instead of `JR.renderMarkdown` (§6–7); chatgpt-render.js not loaded (JR.qa.upgrade already no-ops without `JR.chatgptRender`); chat.js `setTailHidden` harmless (ChatGPT selector); chat.js `captureResponse` keeps the mirrored DOM (R36 design) — on DeepSeek when the item was never mounted, `renderNetText` should use `JR.site.renderAnswer` too.
8. **styles.css** dark mode: everywhere `html.dark` sets Popup's theme, add `body.dark` (DeepSeek's class; 3 places: lines ~29, ~175, ~954) — confirm the class name with B3.
9. **tools**: add `tools/dom-test-deepseek.html` to the test list in CLAUDE.md's Dev Rules (user's call) / run it with the others.

## 9. DeepSeek eval set (fixed; run every iteration; same style as docs/EVALS.md)
Every case: Codex does the browser step (human pace, DeepSeek test chat only), the commander observes read-only (`tools/chrome_js.py --url chat.deepseek.com`, recorders adapted for `.ds-virtual-list`). Pass criteria in brackets.
- DS-E1 Highlight → popup opens next to it, arrow on the highlight [arrow x inside the highlight's x range; popup fully in visibleBand].
- DS-E2 New question (Return) from a middle answer [highlight moves 0 px in every drawn frame (SMOOTHNESS 0 ms); no page jump/flash; the Q&A pair never visible in the chat (both items hidden from the first frame)].
- DS-E3 Same with the send arrow; DS-E4 Reply; DS-E5 edit + resend (new version); DS-E6 retry after a failure [all as E2; versions switch].
- DS-E7 Streaming in the popup, highlight near the bottom (item mounted) [popup content is DeepSeek's DOM (`ds-markdown` classes), words appear with DeepSeek's own animation, no chunk jumps; final frame identical to the last streamed frame (no rebuild: same block styles/line-height)].
- DS-E7b Same, highlight more than 7 Q&As above the bottom [record whether DeepSeek keeps the streaming item mounted (B9); if not: the popup still streams (old method) and switches to the mirror without a jump once the item mounts].
- DS-E7c Same session, close and reopen the popup after the answer item scrolled out of DeepSeek's window [shows the in-memory mirror, identical to before; no Popup re-render].
- DS-E7d After a reload [the old-method render uses DeepSeek's classes: computed font/line-height/margins of its paragraphs equal those of a real DeepSeek answer paragraph on the same page].
- DS-E8 Rich answer: code block, LaTeX, table, bold, lists [indentation, KaTeX, table as DeepSeek draws them; no literal `**`/`$`].
- DS-E9 DeepThink ON [popup shows only the answer — **never the reasoning** (user, 2026-11-17), neither while streaming nor after a reload; hiding covers the whole item].
- DS-E10 Search ON [citations as DeepSeek draws them].
- DS-E11 Reload → highlights restored, popups reopen with DeepSeek's rendering [no Popup re-render; keys are real ids].
- DS-E12 Context: in the main chat ask "what was my last popup question?" [DeepSeek answers it — the hidden Q&A is in its context].
- DS-E13 Nested popup inside a popup [opens on the first click (R35); same smoothness].
- DS-E14 Attachments: paste/drop a file into a popup question [DeepSeek uploads it; the popup shows it].
- DS-E15 Light + dark; English + another UI language.
- Edge cases for E2–E6: first send after a page load vs later; highlight on the first line of an answer / at a boundary between answers / near the bottom; highlight more than 7 Q&As above the bottom (the item is not mounted while streaming — §6); long answer that scrolls inside the popup; queued second send while the first streams.
- Regression: the full ChatGPT eval set (docs/EVALS.md) after the 4a refactor.

## 10. Browser requests for the commander (Codex, DeepSeek test chat fb177f05 or a new test chat; human pace)
- **B1** Install the raw stream logger first: `python3 tools/chrome_js.py --url chat.deepseek.com @tools/ds-sse-log.js` (read back `JSON.stringify({raw: window.__dsRaw, keys: window.__dsKeys})`), then send one normal message (DeepThink OFF): "用一个小表格、一个公式和一小段 Python 代码解释光合作用". Read: raw SSE (ready ids, patch shape), DOM keys during streaming (negative?) and after, `.md-code-block` / KaTeX / table DOM.
- **B2** Same with DeepThink ON → reasoning path/fragment shape and its DOM (is it inside `.ds-assistant-message-main-content`?).
- **B3** Switch DeepSeek to dark mode → body/html class.
- **B4** (covered by B1) KaTeX present?
- **B5** Paste an image into DeepSeek's box (don't send) → file card DOM, remove button, upload progress marker; then remove it.
- **B7** Re-verify hiding: commander injects the hide CSS for one Q&A pair in a long chat (visible tab), Codex scrolls up/down ~30 times with the wheel → gap between the neighbours stays the normal item gap, no blank flash.
- **B9** In a long chat (e.g. 7c99de0c, 42 items), scroll to the top, then send a normal message from DeepSeek's own box while staying at the top (Codex: don't scroll) → with `tools/ds-sse-log.js` on, `window.__dsKeys` shows whether the new (negative-key) items are mounted while it streams far from the screen.
- (B6/B8 dropped: no extra window or tab — user, 2026-11-17.)

## 11. claude.ai (decision relayed by the commander, 2026-11-17)
"c then b": first find the root cause of the blank flash when scrolling past CSS-hidden Q&As (e.g. `height:0; overflow:hidden` vs `display:none`, virtual-list row estimates); if it can't be solved, CSS-only anyway; never rewrite claude.ai's binary (protobuf) data. Not started here (out of this worker's scope; the user's claude.ai tab is in use).

Also decided (user, 2026-11-17): claude.ai popups show only the response — **never Claude's status lines** (thinking/tool/"searching…" lines).

## 12. Decisions taken (were open questions)
1. No extra window/tab; mirror while mounted (kept in memory for the session), old method after a reload, in DeepSeek's classes (§6).
2. DeepThink reasoning: never shown in popups.

## 13. Review (ponytail-review, 2026-11-17) — fixed
1. `ready` can arrive before DeepSeek adds the answer item → the user item was mapped to the answer id. Now pending until a temporary *answer* item exists (test). 2. `o:"BATCH"` patches with relative child paths were misread → handled (test). 3. `composer` took the first textarea in DOM order (an edit box of an older message) → `textarea[name="search"]` first (test). 4. DeepSeek's send `div` never looked disabled → also a `…disabled` class (test). 5. SEARCH fragments counted as answer → only RESPONSE / untyped (test). Left: `textWithBreaks` duplicates site-adapter.js's private one — export it in 4a. Offline: `tools/dom-test-deepseek.html` 31/31.
Second pass (after the user's decisions): DeepThink exclusion (`inThinking`), `answerMarkdown` (RESPONSE fragments, falls back to `content`), `fetchHistory` (same origin, the page's own token), `renderAnswer` (DeepSeek's classes) — tested offline, 37/37. Risk to check with B2: if DeepSeek ever wraps the whole answer (not just the reasoning) in a `…think…` container, `inThinking` would hide the answer too.

## Browser results 2026-11-17 (Codex Computer Use + read-only Apple Events; new test chat ab210d2f, created for this)
- **Test chat:** https://chat.deepseek.com/a/chat/s/ab210d2f-53c2-4aa4-88fb-1b1fa8ea2fad (8 long answers + D2 + D3).
  DeepThink was off; **Search was ON (the user's setting) and Codex switched it off** for these probes — switch it back
  on at the end (user decision: keep the user's own toggles). The user's other DeepSeek tab/chats untouched.
- **Late network patches catch nothing:** `tools/ds-sse-log.js` / `ds-mount-log.js` (XHR open/send patched after load)
  recorded 0 requests, although resource timing shows the send is still `XHR POST /api/v0/chat/completion` → DeepSeek
  (or its anti-bot SDK) keeps references to XHR taken at load. **`deepseek-net.js` must be a MAIN-world
  `document_start` script** (before DeepSeek's own code) — verify after wiring. Resource timing stops at 250 entries
  (the buffer is full on a long session), so it can't be used to watch later sends either.
- **DeepSeek scrolls on a send:** the view jumps to the new question at once and moves down as the answer streams
  (like claude.ai) → Popup's scroll guard is needed on DeepSeek too (document_start).
- **B1 — answer DOM (table + formula + Python, DeepThink off):** `div.ds-markdown.ds-assistant-message-main-content`;
  formula = KaTeX (`.katex-display` ×1); table inside `div.ds-scroll-area…`; code = `div.md-code-block.md-code-block-light`
  › banner (`Copy`, `Download`), `<pre>` (no `<code>`), 2 svg; `white-space: pre-wrap`; 64 token spans with **Prism-style
  classes** (`token keyword`, `token function`) styled by DeepSeek's global stylesheet (theme in the class:
  `md-code-block-light`) → a same-page mirror keeps the styling; 0 `…think…` elements with DeepThink off. Temporary
  keys before a reload: the new question and answer were **-20 and -21** (both negative).
- **B9 — is the streaming item kept on the page while the reader is far up? NO.** Message 10 sent while the view was
  at the top (a time-based logger, every 200 ms; after DeepSeek's jump the script pulled the view back to the top the
  way Popup's lock would): at the jump the mounted items were `18,-20,-21`; for the next 65 s (326 samples) only the
  first 14 items (`-2,2,…,14`) were mounted — the streaming Q&A (-20/-21) was never on the page.
  → For a highlight more than ~6 Q&As above the bottom, **the same-session mirror has no source** on DeepSeek (iframe
  forbidden, background window declined by the user). Open question for the user. Evidence:
  `collab/evidence/deepseek/2026-11-17/B9-mount-time.json`.
- **B7 — hiding, confirmed live:** two Q&A pairs (`[data-virtual-list-item-key="-4"|"4"|"-6"|"6"]`) hidden with
  `display:none`; Codex wheel-scrolled from the top to the bottom and back (≥ 30 steps each way, 0.5 s pauses);
  observer sampled every frame after paint the largest gap between consecutive visible items: **0 frames with a gap
  > 80 px out of 185 139, largest gap 0 px**; Codex saw the neighbours join directly, no blank. → DeepSeek's list
  measures hidden items correctly; `display:none` is fine here (unlike claude.ai).
- **B2 — DeepThink, confirmed live (2026-11-17 13:53):** the reasoning is a sibling block before the answer (`div._74c0879`, hashed classes, title "Thought for 1 second", collapsible), NOT inside `.ds-assistant-message-main-content` → mirroring only the main content excludes it; the `inThinking` risk does not apply. History: the assistant message has `thinking_enabled:true`, `fragments:[{type:"THINK"},{type:"RESPONSE"}]`, top-level `content`/`thinking_content` absent → `answerMarkdown` (RESPONSE fragments) is right. DeepThink switched back off afterwards.
- **B3 — dark mode, confirmed live:** `<body class="apple en_US dark" data-ds-dark-theme="dark">` (html has no theme class); page bg rgb(21,21,23); code blocks switch `md-code-block-light` → `md-code-block-dark` (a mirrored copy keeps the class it was copied with — re-copy or swap the class on theme change). The user's setting was System; restored after the check.
- **B5 — pasted image, live (not sent):** card = `.ds-animated-size-item > div[role=button]` (hashed classes) holding `img` (blob: URL), a progress overlay div (ring + "0%" while uploading, gone when done; send arrow turns bright blue when ready) and a `.ds-icon` corner div (remove button, visible on hover). No file-name text on the page (AX name "image.png"). → composerHasAttachments = `.ds-animated-size-item img` inside the composer; attachmentsUploading = the overlay's ring present; selectors must use structure/roles, not the hashed classes.

## Wiring (1.2.13-dev.32, applied for DeepSeek and claude.ai together)
- `src/site-hosts.js` (document_start, before early-hide.js): per site the storage key prefix (`popup:conv:` ChatGPT unchanged, `popup:deepseek:conv:`, `popup:claude:conv:`), the conversation id in the URL, `hide(k)` (= the site layer's `turnSelector(k)` for a real key, tested) and the hide CSS (`decl`: ChatGPT height 0 (R36a), DeepSeek height 0 (dev.57; was `display:none`, B7), claude.ai height 0 (C2)). early-hide.js, storage.js, the diagnostics and the site layers' `hideDeclaration` all read it.
- manifest: host permissions + matches for both sites; MAIN document_start per site (ChatGPT scroll-guard + net-tap; DeepSeek scroll-guard + deepseek-net; claude.ai scroll-guard); `sites/deepseek.js` / `sites/claude.js` load only on their host, before site-adapter.js, which hands over `JR.site` (and `JR.SEL.turn`); `site-render.js` (was chatgpt-render.js, `frame.src = JR.site.chatUrl(conv)`, returns `{html, question}`) on ChatGPT + claude.ai.
- scroll-guard.js picks the scroller by hostname. styles.css: Popup's dark theme also for `body.dark` (DeepSeek) and `html[data-mode=dark]` (claude.ai).
- qa-content.js read-back: ChatGPT REST only on ChatGPT; DeepSeek `fetchHistory` → question = parent message, answer = `renderAnswer(answerMarkdown)` (kept: no frame possible); claude.ai reads its conversation JSON (`fetchConversation`, dev.102: also the turn order), held for claude.ai's own drawing from the frame (`JR.qa.upgrade`); DeepSeek's and ChatGPT's read-backs are held the same way for the site's own drawing. Since dev.105 there is no deadline: a popup shows only the site's drawing (a failed render is tried again), never Popup's own (user 2026-11-18). Network-stream fallback text is drawn with `JR.renderAnswerText` (DeepSeek's classes).
- Not done (lean, later): `textWithBreaks` ×3; DeepSeek code blocks keep the light/dark class they were copied with after a theme switch (B3).

