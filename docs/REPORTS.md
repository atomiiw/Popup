# User reports — log (append-only)

Every bug the user reported, in their words, with status and evidence. Never delete an entry; add
observations / hypotheses / fixes under it. The eval cases that check each one are in
[EVALS.md](EVALS.md) (re-run the whole set after every change). Evidence folders are local
(`collab/evidence/`, gitignored).

Status words: open · fixing · fixed (dev.N, eval ids) · reopened.

---

## R33 — sending from a popup moves the page (2026-11-16)
User:
- "whenever i send a message through the popup the popup would jump away from the highlight … and i will jump away from both of them. if i do return for send the whole thing just disappears from the page and i need to scroll to relocate. if i do send button the popup wont move but where it is on the page will shift and it gets detached from the highlight."
- "现在任何时候我重新发信息 包括点reload的时候它都会跳一下跳走我还划不回去"
- "单条消息正常发除了闪一下之外都可以。但是在reply里发会跳走 同一条消息重新编辑再发会小跳 highlight会移动half screen height"
- "现在popup倒是不跳走了 但是chatgpt自己scroll away啊 导致popup还是没站到highlight上"
- "现在displacement好像好一点了但还是闪好几下会上下跳几下才回到原位"
Status: fixed for placement (dev.14/16: E3, E5–E8 = 0 ms, all four send paths, first send after a load) — the flash is tracked as **R36a**.
Root causes found (details in TODO R33): Return keydown inside the popup taken for user scrolling (target detached → `composedPath`); each send path passed its own anchor (Reply none, edit/retry stale spans → `JR.viewAnchor()`, one place); ChatGPT's virtual list re-estimates turns after a send and the lock corrected a frame late and stored fake positions (→ ResizeObserver before paint, `savedTop` only from the user). Tried and reverted: letting ChatGPT scroll (dev.4/7), only non-bottom scrolls (dev.11), re-sending a scroll event (dev.9/15).
Evidence: `collab/evidence/T2…T18-E9`.

## R34 — popup answers don't look like ChatGPT's (2026-11-16)
User:
- (screenshot) formula shown as raw TeX, a diagram as its `<svg viewBox…>` template with `{d.x+9}`. "chatgpt modifies its md representation every week and your transplant code is just too fragile … can't you just use chatgpt's whatever state of the art representation and just dynamically paste/reuse that in your own popup"
- "现在streaming效果很好 一固定就出bug" · "你直接继续mirror不就行了吗"
- "不行 popup坚决不存回答内容 想别的方法" (hard rule)
- "刷新之后不要删数据库 不刷新的时候怎么藏 刷新之后就怎么藏 然后继续镜像"
- "我不是让你直接用streaming的格式吗 为什么会需要手动修代码块和表格"
Status: partly — dev.17 hidden same-origin iframe renders answers via ChatGPT (T20 ok after reload); dev.18 no Popup post-processing of ChatGPT code blocks. Reopened by **R36b/f/g/h**.
Measured: CSS-only hiding costs 13 px per hidden Q&A and only 3 of 52 Q&A turns are mounted near their highlight (T17); the hidden turn is mounted while streaming but unmounted soon after, so Popup fell back to `JR.renderMarkdown` (T19).

## R35 — secondary popup needs 4–5 clicks (2026-11-16)
User: "popup里的secondarypopup现在点不开了 或者需要点四五次才能点开"
Status: fixed (dev.19, T22 3/3 first click). Root cause: a press on the trigger button's icon inside a popup answer (user-select: text) started a new selection; the old one collapsed and the button was removed before mouseup.

## R36 — after dev.19 (2026-11-17 ~03:45)
User, 8 items:
- **R36a** "现在发送消息的时候还是会闪一下 整个页面 仿佛reload了一下" — open.
- **R36b** "when the response has finished generating the fixated markdown will shift a bit in line distance and such and i know that you rewrote it in a popup way rather than doing chatgpt way" — open.
- **R36c** "when i edit a msg and send again i will lose my place" — open.
- **R36d** "only when i do a secondary popup inside a popup is it fully smooth with no reload flash and no displacement" — observation (use as a reference case).
- **R36e** "the placement of this popup is off. is it because im at the top of a response?" (screenshot: popup above a highlight on the first line of an answer, right under the user bubble; arrow at x≈520, highlight from x≈650) — open.
- **R36f** "i see two shifts after it's done streaming: first time it nudges the words and line distances and the second time the * markdown signs lose effect. im suspecting your mirroring is not taking place at all and that you havent eliminated the root reason" (screenshot: literal `**确认机制（ACK）…**`) — open.
- **R36g** "the placement of words in this codeblock is weird im suspecting you are not doing mirroring at all" (screenshot: ChatGPT code header, lines lost indentation, big line gaps) — open.
- **R36h** "the current streaming is spitting out half a line and a few phrases at a time and it's not smooth. i want sputting out in the exact same way as chatgpt which is even when you generating a phrase at a time you still do the gradual show up effect even within those phrases" — open.
Working rules from the user (same message): record everything; a fixed eval set with edge cases, re-run every iteration all week; never forget a bug or a criterion; fix root causes; and (later) "当你觉得万无一失的时候让ponytail来给你audit一下问题 然后继续改".
Leads (commander, 2026-11-17): R36f/h — the hidden Q&A turn is unmounted by ChatGPT's virtual list during/after streaming, so the popup shows `renderNetText`/`renderMarkdown` (chunks, no per-word fade, `**`); R36g — CodeMirror DOM copied from the render iframe loses its generated style classes; R36a — the remaining flash is ChatGPT's list re-estimating turns after a send (TODO R33 "known left"); R36c — edit path; R36e — `getAdjacentLineRect` / `placeAt` for a first-line highlight.

### R36 progress (worker report, 2026-11-17 morning; copied by commander)
- Mount data (R36-1/2/3): the hidden Q&A turn stays mounted the whole time it streams (newest turn, screens away from the reader) and is unmounted ≈1–1.5 s before the stream ends (12.1 / 11.9 / 14.0 s) → root of R36b/f (the end fell back to Popup's renderer).
- R36b / R36f: fixed in dev.20 — R36-2 and R36-3: 0 style switches at the end, bold renders, root styles identical (E-render-1/2 pass).
- R36c: fixed in dev.20 (`preventScroll` on the edit path) — not yet verified live (E-send-5 pending).
- R36e: fixed in dev.21 (offline test red → green) — not yet verified live (E-place-1/2 pending).
- R36g: same session OK (`white-space: pre`, indentation kept); after a reload still to test (E-render-3/4/6); plan: copy the frame's CodeMirror runtime rules scoped under a class on frame-sourced answers (class names can collide between documents).
- R36h: root cause under investigation — experiment R36-5: does ChatGPT animate per word only when it thinks the turn is visible (hidden turn shown fixed + transparent during streaming; drop the idea if it causes a gap, jump or reading-anchor lock).
- R36a: open — after a reload, the first send makes ChatGPT re-create the reader's turn as a placeholder.

### R36 progress — worker, 2026-11-17 04:30 (dev.22)
- **R36b / R36f — fixed dev.20 (root cause).** ChatGPT scopes all answer styling under the markdown root (`.MarkdownRoot-…` + `data-markdown-text-style`, `data-markdown-animated`, `.AdaptiveStreaming-…`: font size, line height, paragraph/list spacing, table cell widths, the fade rules). Popup mirrored only the root's *children*, so the popup never had ChatGPT's answer styles. And when ChatGPT's virtual list unmounted the hidden turn ~1 s before the end, Popup switched to `renderNetText`/`renderMarkdown` (shift 1) and later swapped in the render-frame copy (shift 2). Fix: mirror the root itself (`syncChildren(bodies, …)`, `assistantHTML` = outerHTML); once mirrored, never switch to Popup's Markdown — the mirror is the answer (`mirrorDiv`, also used by `captureResponse`). Evals: R36-2/R36-3 E-render-1/2 pass (0 style switches, root line-height/size equal before/after).
- **Literal `**` (part of R36f):** ChatGPT's own main-chat answer shows the same (R36-6: `**队头阻塞（Head-of-Line Blocking）**` unbolded — CommonMark: a closing `**` right after full-width punctuation and before a letter isn't right-flanking). With the mirror the popup shows exactly ChatGPT's result.
- **R36h — measured, needs the user's decision.** ChatGPT's visible main-chat stream (R36-6, ChatGPT's own composer, answer on screen): text arrives in batches of +7…+44 characters every ~0.3 s, 0 fade elements, 0 running animations (fade CSS exists but no element uses it). The popup mirror matches (R36-3: same batches, ~4 ms later). Experiment (R36-4): streaming turn shown off-flow + transparent → still batches, 0 fade; side effect: the list reserved +554 px → dropped. Conclusion: in this account's current ChatGPT, the main chat doesn't do a per-word fade either; the popup now streams exactly like it.
- **R36e — fixed dev.21 (root cause).** `getAdjacentLineRect` used each span's bounding rect; a span that wraps onto the next line has a box spanning both lines, so the arrow aimed at the paragraph's middle. Now per-line `getClientRects()`. Offline test red → green. Live E-place-1 (R36-7): popup below the wrapping highlight, arrow at x 550 inside the last line's highlight (542–558) → P-place pass. Open UX question: when the adjacent line holds only a sliver (one character), the popup sits far from the highlight's main part — centre on the longest line instead? (user's call)
- **R36c — fixed dev.20 (root cause candidate):** `enterEditMode` (and new-popup / Reply auto-focus) called `.focus()` without `preventScroll`; focusing the question row of a tall popup scrolled the chat. Live E-send-5 still pending.
- **R36g — after a reload, fixed dev.22 (root cause).** R36-7: frame-sourced code lines had `white-space: pre-line` (leading spaces collapsed) and line-height 26px — the editor's classes `ͼ1 ͼ2 ͼ13 ͼw` are CodeMirror rules generated at run time in the frame's document; the page had 0 such rules (and could have different ones with the same names). Fix: frame answers are wrapped in `.jr-frame-answer[data-jr-frame=N]` and the frame's generated rules are copied scoped under that (CSS nesting) — never apply to the chat or mirrored blocks. Offline test (in-scope pre; other load / page untouched) red → green. Same session needed nothing (R36-2: pre, 20px). Live E-render-4 re-run pending.
- **R36a — open.** R36-1: after a reload, the first send made ChatGPT re-create the reader's turn as a placeholder (txt82, 585–771 ms) while the list collapsed and clamped scrollTop; the lock's corrections couldn't apply for ~70 ms. R36-2/3 (dev.21): 0 ms, 0 scrollTop changes — varies by run.
- **Other:** ChatGPT's own composer send didn't follow to the bottom (R36-5/6) — ChatGPT's reading-anchor state (`data-thread-reading=anchored`), no Popup lock left (checked).

### R36 progress — worker, 2026-11-17 05:00 (dev.24, offline while Codex is lent out)
- **R36h — correction: ChatGPT DOES reveal per word.** The earlier "0 fade elements" was the wrong measurement. ChatGPT's CSS (dumped: collab/evidence/R36/css/) styles `:is([data-d-stream-run], …)::highlight(dil-word-0…13)` — transparent → 8 % ink → … → full ink. ChatGPT's JS puts the newest words' text ranges into CSS Custom Highlights named `dil-word-N` and moves them up a level each frame: a per-word fade with no extra elements and no animations (our counters saw nothing). The popup's copies of the text are not in those ranges, so its words appear at full ink at once — the "half a line at a time" the user saw. Fix (dev.23): `JR.mirrorHighlights` — every frame while streaming, each highlight's ranges inside the hidden answer get the same ranges (same node path) over the popup's copies, replacing last frame's (offline tests red → green). Not yet known: whether ChatGPT registers these ranges for a hidden (`display:none`) turn — to observe with tools/highlight-log.js when Codex is back.
- **Ponytail review (dev.20–23), findings:** (1) MUST — charts/maps froze blank and "couldn't load" answers stayed partial: once mirroring started, the network drawing could no longer take over and `captureResponse` saved the frozen copy → fixed dev.24 (those two cases drop the mirror). (2) MUST — every reload queued a render-frame redraw for every popup answer in the chat (52 in "Popup 格式测试": minutes of a second ChatGPT app working) → fixed dev.24: only answers Popup drew from Markdown, and only when opened (`drawnByPopup`; test red → green). (3) SHOULD — delete the DevTools-protocol tools (cdp.js, r33-live.sh, new-test-chat.sh, native-send-snap.sh, scroll-exp.sh, unhide-experiment.js; ~600 lines, banned route) → left for the user/commander to confirm. (4) NICE — one `<style>` per frame load stays for the session (a few KB each).
- **R36e options for the user:** A (current dev.21) arrow at the highlight's line next to the popup; B centre on the highlight's longest line — patch ready, not applied: collab/evidence/R36/R36e-options/option-B-longest-line.patch.

### R36 user follow-ups (2026-11-17 afternoon, dev.24 → dev.27)
- **R36i** "怎么感觉还是一抖一抖的不丝滑" — an "above" popup moved up a whole line (26 px) per new line (poslog: top 1166→1140→1114→1087). dev.25: its height eases to the content every frame, bottom pinned (`growGently`). User: "现在高度增长没问题了".
- **R36j** "你不应该 stream 到最后一个字就停，应该 stream 到整个 reply 都 show up … the only exception is when the user starts scrolling on their own" — dev.26: `JR.followAnswer` keeps the answer area scrolled to its end while streaming and once when done (Reply visible); stops for this answer after the user's wheel/touch/click/key in it.
- **R36h (decision)** "我不喜欢它现在一卡一卡一抖一抖出东西 … 你就别仿 ChatGPT 了 … 它代码块是一个字一个字的蹦的，我比较喜欢那个样子的" — dev.27: ChatGPT's dil-word fade mirroring removed; the popup types the mirrored answer out a few characters per frame (`JR.typeAnswer`, CSS highlight `jr-untyped` = transparent; speed = waiting/12 chars per frame). Live check pending.
- Note: the user's Chrome ran dev.21 until 14:08 (dev.23/24 never loaded) — reload the extension after every build.
- **R36a root cause (measured, R3–R6):** a native ChatGPT send keeps every mounted turn element (R4); a Popup send makes ChatGPT re-create turns above as placeholders and forget their measured heights (R3: list 4622→1477→1009→7053 px, scrollTop changed 6×; R5: −219 px). Lead: the new turn is `display:none` (0×0) and ChatGPT gives its slot `height:1px; contain:size`. Clean A/B (native send + display:none only) interrupted by a user send (R6) — to redo; candidate fix: hide with height 0 and width kept (as on claude.ai).
