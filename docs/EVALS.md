# Eval set — fixed, re-run after every change

> The monthly / release check for all three sites is [REGRESSION.md](REGRESSION.md); this file is the
> developer eval set (ChatGPT, with the measuring tools) used while fixing.

Every case is run after every change that can touch it (in practice: the whole set, every iteration).
A change is done only when every case passes; then a ponytail-review of the change, fixes, and the
whole set again. Cases are never deleted; a new bug report adds cases. Results go to the run log at
the bottom. Reports these check: [REPORTS.md](REPORTS.md).

## How a case is run (no DevTools protocol — see collab/PROTOCOL.md)
- **Hands:** the Codex `operator` (Computer Use) in the user's own Chrome, human pace, only in the
  test conversation 「介绍光合作用完整过程」 (`6afbb274`). Chrome in front (`osascript … activate`); if
  the user is using Chrome, wait.
- **Eyes:** the commander, read-only page JS by Apple Events: `tools/observe.sh 6afbb274 "<sentence>"`
  before the action (send recorder, frame snapshot, errors, fetch log), `tools/popup-final-snap.js`
  (last streaming vs final answer), `tools/click-log.js` (clicks, popups, rebuilds), then
  `python3 tools/send-report.py 6afbb274 <dir>`. Codex adds what it saw (screenshots, "blank/jump N
  times").
- Version check first: `#jr-diagnostics` version = the build under test. Fresh state per case:
  ⌘R before cases marked *first send after load*; otherwise Esc only.
- Sentences must be ones never asked before (an asked one opens the old popup).

## Pass criteria used below
- **P-still:** highlight on-screen y unchanged in every recorded frame (SMOOTHNESS 0 ms) and the
  popup's arrow stays on its highlight; Codex sees 0 blank / 0 jump.
- **P-noflash:** no frame where the turns on screen are placeholders or unmounted (snapshot: no turn
  on screen with text < 90 % of its pre-send length, no list height collapse above the viewport).
- **P-chatgpt:** the popup answer is ChatGPT's rendering: ChatGPT `data-*` marks present, formulas
  are `.katex`, no Popup-renderer marks (`.jr-table-wrap`, `.jr-code-block`), no literal `**`/`\(`/`{d.`.
- **P-same:** last streaming frame vs final (popup-final-snap.js): same block count, text and
  computed line-height / margins / font-size per block (±1 px), no second change later.
- **P-code:** code lines keep indentation and the line height of ChatGPT's own code block; header
  buttons copy.
- **P-fade (method, 2026-11-17):** sample `CSS.highlights` `dil-word-*` per frame (tools/highlight-log.js) — ranges must exist over the popup's copies while it streams, as over ChatGPT's visible answer.
- **P-noleak (R36g):** after a render-frame answer is shown, a ChatGPT code block in the main chat and a same-session mirrored one keep their computed white-space / line-height (before = after).
- **P-fade:** while streaming, newly arrived words appear with ChatGPT's per-word fade-in
  (`[data-streaming-word]`/reveal animations running in the popup), not as whole chunks.
- **P-place:** popup arrow x inside the highlight's x-range on its adjacent line; popup fully on the
  side chosen; not covering its highlight.

## Cases
| id | report | case | edge | pass |
|---|---|---|---|---|
| E-send-1 | R33, R36a | new popup, Return, mid-answer | first send after load | P-still, P-noflash |
| E-send-2 | R33, R36a | new popup, Return | second send on the same page | P-still, P-noflash |
| E-send-3 | R33, R36a | new popup, send arrow, at a boundary between two answers (end of previous answer visible above) | first send after load | P-still, P-noflash |
| E-send-4 | R33, R36a | Reply in a finished popup | first send after load | P-still, P-noflash, upper popup on the Reply button |
| E-send-5 | R33, R36c | edit a finished popup's question, Return | first send after load | P-still, P-noflash, place kept |
| E-send-6 | R33 | retry after a failed answer (only if a failure can be produced honestly; else skipped with reason) | — | P-still |
| E-send-7 | R36d | send inside a secondary (nested) popup | — | P-still, P-noflash (reference case) |
| E-send-8 | R33 | highlight near the bottom of the chat (last answer) | first send after load | P-still |
| E-place-1 | R36e | open a popup on a highlight on the FIRST line of an answer, right under the user bubble | above and below side | P-place |
| E-place-2 | R36e | highlight at the right end of a line / spanning two lines | — | P-place |
| E-render-1 | R34, R36b, R36f | ask for "一个小表格、一个公式和一小段代码" in a new popup; watch the end of streaming | same session | P-chatgpt, P-same |
| E-render-2 | R36f | answer with **bold**, lists, headings | same session | P-chatgpt (no literal `**`), P-same |
| E-render-3 | R36g | answer with a code block | same session and after reload | P-code, P-chatgpt |
| E-render-4 | R34 | reopen E-render-1's popup after ⌘R | after reload | P-chatgpt, P-code, no change visible after opening |
| E-render-5 | R34 | long answer that scrolls inside the popup | — | P-chatgpt, P-same, popup grows then scrolls |
| E-render-6 | R36g | after a reload, open a popup whose answer came from the render frame, then look at a ChatGPT code block in the main chat and a same-session mirrored one | frame styles copied into the page | the main-chat and same-session code blocks unchanged (computed white-space / line-height / colors before vs after) |
| E-render-7 | R34, R36b | after a reload, open a popup whose answer Popup drew from Markdown (dev.24 redraws it via the frame only when opened) | first open after reload | note what the user sees: Popup's drawing, then ChatGPT's after ~10–15 s = a visible change → must be judged against P-same; record the delay |
| E-stream-1 | R36h | watch a long answer stream in a popup | — | P-fade, no half-line chunks |
| E-nest-1 | R35 | select inside a popup answer, press the trigger icon | 3 different sentences | opens on the first press each time |
| E-regress-1 | all | offline: `tools/dom-test.html`, `tools/qa-content-test.js`, `tools/net-tap-test.js`, `tools/load-smoke.js` | — | all pass |

Light/dark and another UI language: run E-send-1, E-render-1, E-place-1 once more in dark mode
before a release.

## Run log
(append: date · version · per-case result · evidence dir)
- 2026-11-16 · dev.14/16 · E-send-1 (E5) pass 0 ms · E-send-3 (E6) pass 0 ms (≈80 ms placeholder strip above the anchor — fails P-noflash) · E-send-4 (E7) pass · E-send-5 (E8) pass · E-send-2 (E3) pass · collab/evidence/T18-E3…E9
- 2026-11-16 · dev.19 · E-nest-1 (T22) pass 3/3 · collab/evidence/T21, T22
- 2026-11-17 · dev.19 · user report R36: E-send-1/3 fail P-noflash; E-send-5 fail (place lost); E-place-1 fail; E-render-1/2/3 fail; E-stream-1 fail (user's own use)
- 2026-11-17 04:04 · dev.19 (baseline, R36-1) · E-send-1 P-still fail (282 ms; anchor turn re-created as a placeholder 585–771 ms, scrollTop clamped) · E-render-1 fail: mirror until the hidden turn unmounted at 12.1 s, then Popup's Markdown (shift 1), then render-frame upgrade at 15.3 s (shift 2) · collab/evidence/R36/1
- 2026-11-17 04:11 · dev.21 (R36-2, first send after load) · E-send-1 pass (0 ms, scrollTop 0 changes) · E-render-1/2 pass P-chatgpt + P-same (mirror kept after unmount at 11.9 s, root line-height 26px/16px before = after, 0 style switches seen) · E-render-3 same session pass P-code (white-space pre, lh 20px, indentation kept) · bold OK, the only `**` is Python `2**32` · collab/evidence/R36/2
- 2026-11-17 04:14 · dev.21 (R36-3, second send) · E-send-2 pass (0 ms) · E-stream-1: popup growth == hidden-turn growth (+24…+140 chars per 0.3–1.5 s, ~4 ms lag), 0 ChatGPT fade elements → P-fade not met, see R36h · collab/evidence/R36/3
- 2026-11-17 04:17 · dev.21 + experiment (R36-4) · streaming turn shown off-flow transparent: still batches, 0 fade elements; side effect list +554 px → experiment dropped · collab/evidence/R36/4
- 2026-11-17 04:20 · control R36-5/6 (ChatGPT's own composer, visible answer) · ChatGPT itself: +7…+44 chars per ~0.3 s, 0 fade elements, 0 running animations; its own answer also shows a literal `**…（…）**` (CJK punctuation before the closing `**`) → the popup mirror matches ChatGPT · collab/evidence/R36/5, R36/6
- 2026-11-17 04:23 · dev.21 (R36-7, after reload) · E-place-1 pass P-place (popup below, arrow x 550 in the adjacent line's highlight 542–558; UX question: adjacent line = 1 character) · E-render-4 fail P-code (frame answer: white-space pre-line, lh 26px, classes ͼ1/ͼ2/ͼ13/ͼw with 0 rules in the page) → fixed dev.22, live re-run pending · collab/evidence/R36/7-place.png, 7-code.png
- 2026-11-17 04:30 · dev.22 · E-regress-1 pass (dom-test incl. new R36e, R36g scope tests; qa-content; net-tap; load-smoke)
- 2026-11-17 05:00 · dev.24 · E-regress-1 pass (+ R36h highlight mirroring ×2, review #2 upgrade-only-Popup-drawn) · correction: P-fade must be measured with tools/highlight-log.js (ChatGPT's per-word reveal = CSS highlights dil-word-N, not elements) — E-stream-1 re-run pending
- 2026-11-17 14:08–14:20 · dev.24 (Chrome had run dev.21 until then) · R2 popup send: dil-word ranges copied (219) but the user saw chunks · R3 first send after reload: highlight away 575 ms, scrollTop changed 6×, turns re-created as placeholders 3× (E-send-1 FAIL P-still/P-noflash) · R4 control, native composer send: 0 turns re-created · R5: 0 ms, but a turn above re-created and −219 px list height · R6 A/B (native + display:none) interrupted by a user send — redo · collab/evidence/R36/R3–R6
- 2026-11-17 · dev.25–27 · E-regress-1 pass (+ R36 jitter ×3, follow ×2, type ×3; R36h dil-word tests removed with the feature) · user live: above popup growth OK (dev.25), typewriter OK ("可以了", dev.27)
- 2026-11-17 18:44–19:20 · dev.28–31 · E-send-1 (R7) pass 0 ms (one off-screen turn re-created 50 ms) · E-send-2 (R8) pass 3 ms · E-send-3 (R9, dev.29) FAIL 325 ms / 6 px (spacer gap) → dev.30 (R10) pass 0 ms, 0 scrollTop changes · E-send-4 (R11) pass 0 ms · E-send-5 (R12) pass 0 ms · E-render-5 R36j pass (gap to bottom ≤117 px while streaming, ends at bottom) · E-render-1 FAIL table squeezed → dev.31 pass after reload (formula, code OK) · E-nest-1 pass 1st click · E-send-7 (R13) pass 0 ms · E-render-7 visible switch 5–15 s (open, user decision) · E-regress-1 pass (+ R36a popupHost) · collab/evidence/R36/R7–R13
- 2026-11-17 19:29–20:40 · dev.32–37 (Step 4 wired in) · ChatGPT loads (site chatgpt) · DeepSeek: DS-E1 ok · DS-E2 FAIL (new question item visible ~1.3 s at the bottom; answer copied without its `.ds-markdown` root) → dev.33 pass (0 leak frames, highlight 0 px, scrollTop 0 changes, paragraph styles = DeepSeek's) · DS-E11 FAIL (popup didn't open after reload: DeepSeek stops click propagation) → dev.34 pass (opens 1st click, question + answer at once, no change) · DS-E7d pass (16px/28px = page) · DS-E8 pass (KaTeX ×6, code block with Copy/Download + Prism colors + indentation; table area cut off → dev.35/36 kept inside the popup, scrolls sideways — DeepSeek cells are 100–320 px wide by design; Computer Use can't scroll sideways (deltaX 0)) · DS-E9 DeepThink on: 0 reasoning frames, 0 leak · claude.ai: CL-send-1 (first send after load) no leak, Claude's own reply, no status line; page scrolled up 293 px some time after the end (cause unknown; not reproduced on CL-send-2 with a scroll-call log, 0 scrolls) · CL-render-2 reload reopen via frame: shown in ~1 s, no change; question area showed the whole wrapped message → dev.37 (paragraphs as blank lines) pass · E-regress-1 + dom-test-deepseek + dom-test-claude + load-smoke ×3 hosts pass
- 2026-11-17 23:30–23:48 · dev.39–41 · claude.ai: blank space under the last answer (user) → dev.39 (`chat-extra-space` min-height 0 while the newest Q&A is Popup's; ~118 px left = claude.ai's own footer + padding) · send menu 296 px off (user) → dev.40 pass (under the arrow) · CL-send-3 (first send after ⌘R): answer ~7 s, popup ok, page did not move in 79 s (the earlier 293 px scroll not reproduced) · CL-reply / CL-edit (‹ › versions) / CL-nest pass, no main-chat movement, no leak · CL-reload: all reopen; Reply versions lost → dev.41 pass
- 2026-11-17 23:55 – 11-18 00:32 · dev.42–44 · claude.ai Settings ×3 (back / sidebar / close): highlights stay (dev.42) · ChatGPT edit → reload → ‹ old version shows in ~1 s (dev.43; a 335 px move seen once was Computer Use scrolling an off-screen button into view before clicking) · DeepSeek DS-E4 Reply, DS-E5 edit (‹ ›), DS-E13 nested (first click): pass, no movement/leak · reload: versions + nested ok; a question bubble leaked → dev.44 pass
- 2026-11-18 00:33–00:51 · dev.44–46 · DeepSeek DS-E15 dark + English UI (then back to System): popups dark and readable, send ok, no movement/leak (DeepSeek answered an English question in Chinese — its own choice) · claude.ai UI is English (en-US): all claude.ai runs today were English · DeepSeek outline: Popup entries hidden, arrows under the open outline (dev.46) · ChatGPT dark (Appearance → Color mode, back to System): popup, table, math, menu readable; send ok, no movement/leak
