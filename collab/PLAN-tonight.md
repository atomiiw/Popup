# Overnight plan 2026-11-19 00:00 → 10:00 (10 h, user: "你有大概10小时")

Goal at 10:00: a release candidate with no known bug left that can be fixed, the whole regression suite run once on
that final build on all three sites, two independent reviews clean, docs current. Commit / version 1.2.13 only when
the user says.

Rules for the night: the commander never touches Chrome (Codex only, via its Computer Use); every fix = an offline test
that fails first, then the fix, then Codex live on all three sites; version read before each live check; stop Codex if
the user uses the computer.

| # | Time | Work | Done when |
|---|------|------|-----------|
| 1 | 00:00–01:00 | ChatGPT 9/80 takes ~40 s. Measure first (temporary frame trace, read-only probes): which key, in the turn order?, on another branch (edited version)?, which step waits. Fix the cause. | 9/80 opens in ≤ 2 s on a warm frame, or the reason it can't is proven and shown honestly (no endless Loading) |
| 2 | 01:00–01:30 | First click on a parent's site control right after closing its child does nothing (review #6). | offline test red → green; Codex: Copy works on the first click |
| 3 | 01:30–02:30 | DeepSeek ∨ once skipped ahead (B17). Codex repeats the run and names the items; nav order dumped to #jr-diagnostics; fix the ordering. | ∨ from 1 to the end visits every popup in page order on DeepSeek, ChatGPT, claude |
| 4 | 02:30–03:15 | claude table first shown with 2 columns. Codex reproduces; compare with the main chat; probe widths. Fix if it is Popup's. | the table looks as in the main chat, first time and after a reload |
| 5 | 03:15–03:45 | The two small review items: one `<style>` per frame load kept; child highlights read from storage on every patch. | offline tests; no behaviour change |
| 6 | 03:45–04:15 | Independent ponytail review of dev.88 → now (fresh agent). Fix every must/should. | nothing must-fix left |
| 7 | 04:15–08:15 | Full regression sitting on the frozen build, all three sites: B1–B18, C-dark, C-lang (中文), G1, DeepSeek D1–D4, claude C1–C3. Fixes found here: back to the rule above, and the affected cases re-run. | every case PASS, or a written reason (site / Chrome behaviour) |
| 8 | 08:15–09:00 | Final independent review of the last fixes; offline suite; REGRESSION-LOG, FEATURES, HANDOFF, TODO-2026H2 statuses. | docs match the build |
| 9 | 09:00–10:00 | Buffer (Codex is slow, ~25–45 min per site per sitting). Then a short report for the user: what passed, what changed, what is still open and why. | report ready |

Not tonight (needs the user): the architecture candidates (report: $TMPDIR/architecture-review-20261118-2350.html) —
structural, every regression case again; commit and version 1.2.13.

## Progress
- 02:39 started (late: the plan's 00:00 start slipped by 2.5 h; the table compresses).
- 02:58 #1 DONE (dev.131): cause = frame search kept a bisection bound from before the frame measured its heights (at 15453 it first saw turns 6–9, then 20–22: below = above, 160 steps in place). Fix: a window under a screen without the turn drops its bounds. dom-test simulated frame (fails before, passes after). Live: 9/80 ≤ 3 s; 1/80, 40/80, 80/80 ≤ 3 s.
- 02:53 #2 fixed offline (popup.js: a click on a site control while the copy's original is being found waits for it, ≤ 3 s); live check in dev.132.
- 03:10 #5 both small perf items: child highlights read from storage only until all are in memory; old frame style elements dropped when no copy uses them. Offline ALL PASS.
- 03:04 #3 DONE, no bug: DeepSeek ∨ 1/52 → 52/52 consecutive, nav order identical on every press (trace); Codex withdrew its earlier "skip" (the order matched the chat).
- 03:09 #4 DONE, not Popup: claude table showed 4 columns on the first open; its narrow first column is claude's own layout at that width (the frame original: 22 px too).
- 03:25 #2 DONE (dev.134): claude PASS (dev.132); ChatGPT failed twice — the site replaced the frame turn right after it was found again and the click went to the detached one. Fix: counterpart null for a disconnected original (the click waits for the re-find, ≤ 4 s), held re-find wait 3 s → 1 s. dom-test fails without / passes with. Live: Copy 0.3 s and 5 s after closing the child both copy the right code.
- 03:50 #6 review (independent agent) → 3 findings, all fixed with fail-first dom-tests: (1) find() gave up after 3 rounds → Loading for good: retries while live (1 s, then 3 s), tries reset on success, one search at a time (l.finding); (2) image buttons forwarded into the unseen frame → Popup's lightbox for images ≥ 48 px (favicons still forward); (3) re-find reordered l.keys → rebuilt popup searched again: local order. Re-review: no stuck flag; (4) DeepSeek keep on/off every 8 s with endless retries → the 5 s timeout no longer clears the keep (release does). dev.138, offline ALL PASS. Left (nice to have): reloadedFor per key (legacy ChatGPT DOM only), unloaded image width 0.
- DeepSeek regression (dev.135→139): B1–B8 PASS, B9 PASS except Download (Chrome's own block), B10 PASS (dev.138, scroll up 3 notches while streaming: same top line in 3 shots), B11, B13 a–c, B16 PASS.
- 06:20 ChatGPT full regression DONE on dev.139: all PASS except — B17 one nested jump out of view (4 later tries in view, open/watch); B9 a send-time blank seen once.
- 07:41 claude.ai full regression DONE on dev.139: all PASS (B9 sideways scroll: scrollable on the page, not verifiable by Computer Use; B17 downward popups under the input box = the user's call).
- 07:50 dev.140 (DeepSeek NaN guard from the re-review). ChatGPT send recording (4 mid-chat sends): ~80 ms placeholders of the top 3 mounted turns when the new Q&A turn is added, every send — R36a residual, open (not a regression of tonight). B10 per frame on ChatGPT: popup = site at every update.
- 08:05 dev.141: the render frame took the keyboard (ChatGPT focuses its composer on frame load) → typing/Esc into the unseen chat. Fixed (focus goes back; forwarded click 0.5 s). dom-test fails without / passes with. Live ChatGPT + claude: typing after frame load in the main composer, Esc closes, Copy copies. DeepSeek B14 re-run on dev.140 PASS.
- 08:24 dev.143 (review of the focus fix): a forwarded click focuses the control itself; a key in the frame during that moment goes to the page. dom-test (also fixed a test that left the lightbox's key listener behind). Live ChatGPT + claude: Copy then Esc at once closes the popup, Copy copies, typing in the main composer. Offline ALL PASS. End state: dev.143.
- 04:53 DeepSeek full regression DONE on dev.139 (B12/B14 retested after the fix): all PASS — B9 Download is Chrome's own block; B17 a long early popup opened downward reaches under the input box (the user keeps the click height, 2026-11-18); B18 trash corner = the button covers the corner by design, the top edge next to it changes the height only. Fast 3-page scroll-up blank: 0/3 with Popup, 0/3 without (not reproduced). ChatGPT full regression started.
- 04:20 DeepSeek B12/B14 FAIL → fixed (dev.139): blank chat + input box after scrolling to the bottom. Cause: deepseek-net.js inflates the list's offsetHeight during DeepSeek's ResizeObserver callback (hidden items' slots); DeepSeek's scroll area reads it in the same callback for --container-height → its scrollbar track ~12 000 px, sticky at the scroll position, kept extending the scroll height (blank below). Fix: after the callback, take the extra back off --container-height (list and gutters). dom-test-deepseek fails before / passes after. Live: B14 30 up / 30 down PASS, B12 bottom PASS, thumb at the bottom. Likely also the dev.88 "one-time blank".
- 03:30 dev.135 frozen (all TEMP traces removed, offline ALL PASS). #6 independent review started; Codex: DeepSeek full regression on dev.135.

(written as it happens)

# Plan for tonight's 90 minutes (2026-11-18): all three sites ready to release

Done means:
- every REGRESSION case (B1–B18, C, D, C-dark, C-lang) passes on the final build, on ChatGPT, DeepSeek and claude.ai;
- the offline suite passes;
- an independent ponytail review of dev.89 → final finds nothing that must be fixed;
- commit (the user says), manifest name/description/version for the store.

## State at 23:45 (dev.129, offline ALL PASS, uncommitted since dev.88)
- Regression dev.125–128 on all three sites (REGRESSION-LOG "late"): B2 B4 B5 B6 B7 B8 B9 B10 B18 C-dark PASS; two logic
  reviews' findings fixed (dev.126–129). Store name / description now name all three sites (user OK).
- User decisions: a long popup opened downward may reach under DeepSeek's / claude's input box (keep the click height).
- Open: DeepSeek B17 once skipped ahead; ChatGPT old item 9/80 takes ~30 s; claude table first shown with 2 columns;
  first click on a parent's control right after closing its child; architecture candidates (report in $TMPDIR,
  architecture-review-20261118-2350.html) — not before release.
- Release: version 1.2.13 without the dev suffix and commit, when the user says.

## State at 21:00 (dev.124, offline ALL PASS, uncommitted since dev.88)
- Slow "Loading…" fixed (frame stage trace, then removed):
  - frame queue: let-go requests dropped, a held turn re-found at once (jobs no longer pile up);
  - an answer newer than the frame: only the end is searched, then the frame reloads once;
  - the search jumps from the mounted turns, bisects, halves its step on a turn-around, and stops when let go;
  - the frame isn't dropped while a popup holds its turn.
  Live dev.123/124: every ask answered by the frame within ~1 s; far jumps 2/66 ↔ 60/66 all PASS.
  Left: right after a ChatGPT reload the frame needs ~14 s to load an 89-turn chat — a popup opened in that time waits for it.
- In-popup refactor done (design A + C): streaming follows the original too (chat.js `streamInto`); Popup's Markdown
  renderer, its code blocks, DeepSeek's re-dress and their CSS / tests are deleted; a turn without the site's drawing
  shows "Loading…" until the frame's. Live: streaming seen growing in the popup on ChatGPT, DeepSeek, claude.ai.
- Design B: ChatGPT's Copy needed the frame focused for the forwarded click (dev.120) → PASS; claude / DeepSeek Copy PASS.
- `_jrFollow` name clash (scroll-follow flag vs site follow) fixed: the site follow is `_jrSiteFollow`.
- Open: DeepSeek — a tall popup above a low highlight grows past the top of the chat area (seen at the end of streaming);
  Run / wrap / Download forwarding not re-checked live after B; B10 scroll take-over; the items under "Other code".

## State at the 18:05 pause (dev.113, offline ALL PASS, uncommitted since dev.88)
- Design A wired:
  - appendResponseWithReply follows the original;
  - removePopup stops the follow, and the parent follows its own again;
  - "Loading…" → `JR.qa.upgrade` follows a scratch copy until the first one arrives;
  - read-backs are text only;
  - the old snapshot `JR.siteRender` is deleted; chat.js's own sync is deleted (it uses site-answer's).
- Design B wired: site controls are clicked on the original (`JR.siteAnswer.counterpart`). The dev.105–109 per-button code and `codeBlocks` are deleted. Not live-tested yet (Run / Copy-from-frame clipboard).
- Fixed after the user's reports:
  - Reply was patched away → `data-jr-keep`;
  - a rebuilt popup searched again → the original is handed over;
  - two rebuilds → one;
  - a rebuilt copy lost the frame's code styles → it is scoped in every patch.
- **FIRST TONIGHT: Loading is 10+ s per popup on ChatGPT (user 18:03; claude.ai presumably too — both use the frame). DeepSeek is fast.**
  - Measure before guessing: sample the frame (mounted keys, scrollTop) and the popup state over time with chrome_js (read-only) while Codex opens one popup.
  - Suspects:
    - `findTurn` steps (250 ms each) from the estimated place;
    - `revealCode` (250 ms per `<pre>`, run on ChatGPT too);
    - a held original blocking the frame queue;
    - the frame being dropped and reloaded;
    - prewarm `loadAll` running first.
  - The old snapshot path took ~1 s on a warm frame (dev.105), so compare against that.
- Codex dev.111 (partial):
  - claude and DeepSeek answers in 0.6–1.7 s;
  - ChatGPT 8.7–18.9 s;
  - closing a nested popup moved the parent down by ~78 px — probably the Reply patch-away, re-check on dev.113.

## Design A first (agreed with the user 2026-11-18, Q1–Q10; terms in GLOSSARY.md)
Done in the 20 minutes before tonight (dev.110, offline ALL PASS; not wired, so no behaviour change yet): `src/site-answer.js` — `JR.siteAnswer.follow(copyEl, key, onChange)` / `stop()`; node-by-node sync moved there; tests at its interface (dom-test "site answer: …").
Tonight, in order:
1. DONE offline (dev.110, 17:41): `JR.siteOriginal(key)` / `JR.siteOriginalRelease(key)` / `JR.siteOriginalScope(copyEl)`
   - render frame (site-render.js): holds the frame turn until released; a turn found after its release isn't held;
   - DeepSeek (sites/deepseek.js): `keepMounted` while live;
   - site-answer.js: a page turn is used while it streams, afterwards only if `harvestable` (claude.ai's uncoloured code → the frame);
     patches in the MutationObserver callback (rAF never fired in headless / unpainted pages).
   - Not covered offline: the frame hold itself (needs a real frame) → live check.
   - Open question for the user (found while reading chat.js:971): ChatGPT charts/maps draw only on screen (canvas),
     so a copy of them is blank. Today the network text is drawn by Popup instead. Under A with no backup:
     use the frame's original (it is in the viewport, unseen — does it draw charts there?), else Loading.
2. Wire all five paths through `follow`: streaming (chat.js `syncStreamContent`), just done (`captureResponse`), after a reload (`readBackFromConversation` / `fillFromQA`), version switch, edit. Only the active popup is live (Q3). onChange = `restoreChainedHighlights` (+ typing effect).
3. Network read-backs keep text only (question + answer text for ordering): delete `held` / `drawnByPopup` / `upgrade` / `retries` / `fromFrameOnly`, `JR.siteRender`'s HTML copy (Q6).
4. B on top: every click / key in a copy goes to the same element in its original (`proxyClickToHiddenTurn` generalised; delete the dev.105–109 per-button code). Probe: Copy's clipboard from the frame.
5. Delete what A and B replace (tests too: replace, don't layer), then C (Popup's own Markdown drawing) if time allows.
6. Live on all three sites (Codex), then the other items below.

## Other code still to fix
1. Site controls in a popup (Run, wrap, Copy, Download, anything else, on every site): ONE mechanism, no per-button code
   (user, 2026-11-18: "直接沿用平台本身的格式…又开始自己搭了").
   - The popup shows a copy of the site's answer; a copy has no behaviour. So every click on the copy goes to the same
     element in the site's real answer (the hidden turn on the page, or the render frame / DeepSeek's kept item), and what
     the site changes there is copied back.
   - `proxyClickToHiddenTurn` already does this for some buttons: extend it to everything, including the frame.
   - Then delete Popup's own copy / download / wrap handlers and the ✓ CSS (dev.105–109).
   - Probe first, read-only: does the site's own Copy work when clicked this way (clipboard permission in the frame)? What
     do Run and wrap change in the real answer? If one can't work this way, say why and ask.
3. DeepSeek Download: Chrome showed "Unverified download blocked" → check the blob download from the content script.
4. DeepSeek resize: dragging the far (bottom) edge also changed the width (dev.105 report b) → find out why.
5. Failed live before, not fixed yet:
   - DeepSeek blank at the bottom (dev.88);
   - ChatGPT keeps scrolling to the newest text after the user scrolled up while it streams (B10, dev.74);
   - claude code turns black-and-white with the UI in Chinese (dev.83);
   - claude upward popup grows in big steps (dev.80).

## Live checks per user-reported issue × 3 sites (Codex, in parallel with fixes)
- Send keeps the place (B2–B5)
- Nested popup opens on the first click (B6)
- After a reload: Reply / ‹ › / nested, site drawing, no endless Loading (B7, B8)
- Rich answers (B9) + sideways scroll + code-block buttons
- Streaming (B10) + user scroll not taken over
- Flip: order, bottom fifth, nested upward, fast presses; with no popup open — at the top, and in the middle with none in view — ∨ / ∧ go to the next / previous one (dev.107/108) (B17)
- Resize: both edges + 3 corners (B18)
- Delete on an outer popup: nested ones close, the confirm is on it (dev.106)
- Dark + another UI language (C-dark, C-lang); DeepSeek D1–D4; claude C1–C3

## Verification layers
1. Each fix: an offline test that fails first and passes after.
2. Codex live on the build, version read by me.
3. I check Codex's numbers with read-only page probes.
4. Independent review at the end.
5. One final sitting on the final build.
