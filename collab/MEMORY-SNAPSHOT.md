# Claude's working memory for this project (snapshot 2026-11-19)

Copied from the commander's local memory so another computer starts with the same rules. Newer facts: collab/HANDOFF.md first.

---


When I believe a piece of work is complete ("万无一失"), run the ponytail audit (ponytail-review on the change, ponytail-audit for the repo) and continue fixing its findings; only then report it as done.

**Why:** user, 2026-11-17, before leaving for an unattended stretch: "当你觉得万无一失的时候让ponytail来给你audit一下问题 然后继续改".
**How to apply:** applies to R36 fixes, DeepSeek and claude.ai work ([[step4-decisions]]); include the audit findings and what was fixed in the report to the user.

---


On 2026-11-16 ChatGPT detected the automated testing (test Chrome on port 9222 driven by tools/cdp.js, r33-live.sh, new-test-chat.sh). Commander shut down the test Chrome and stopped all ChatGPT automation until the user says otherwise.

**Why:** the test account was being rate-limited (429, "Could not load") and then flagged for automation.

**How to apply:** do not start the test Chrome, run cdp.js or any test script against chatgpt.com, or touch the user's own Chrome unless the user (not another session) explicitly says automation may resume.

---


Never end with "please reload the extension and check X" for the user. Have the Codex operator reload Popup (chrome://extensions ↻), confirm the version, and do the live check, then report results.

**Why:** User, 2026-11-17: "你让我测干嘛？你用codex是干啥用的" — Codex is there so the user doesn't have to test.

**How to apply:** After every build, steer Codex to reload + verify before reporting. Only involve the user for decisions. Related: [[direct-reporting]].

---


Run browser tests by steering the Codex operator myself and waiting in the foreground (until-grep on collab/BOARD.md, ~10 min timeout), then tell the user each result as it comes.

**Why:** 2026-11-17 a background batch agent stalled for 8 h waiting on a notification while Codex sat idle; the user said "直接跟你汇报啊 别用后台".
**How to apply:** no background agents for Codex batches; check `#jr-diagnostics` version first, because the user's Chrome ran dev.21 for hours while later builds were "tested". See [[chatgpt-automation-halted]], [[audit-before-done]].

---


Never propose fixes that make the page visibly move, flash, reload or auto-refresh ("我不能接受任何一点的跳伞"). When a site's behaviour fights Popup (virtual lists, scroll anchoring), read the site's own code to find the input it uses (e.g. DeepSeek's list height read in its ResizeObserver callback, ChatGPT's viewport height from RO entries) and adjust that at the exact moment it is read.

**Why:** User, 2026-11-18, rejected an auto-refresh fallback for DeepSeek and asked "why can't you just make the 14th item show"; the measuring-moment trick solved it without any visible change.

**How to apply:** Measure first (recorders on the DOM), find the site's mechanism, prefer per-moment instance-level adjustments over global patches (DeepSeek's fp.min.js checks prototype getters). Related: [[step4-decisions]], [[codex-verifies-not-user]].

---


Keep ponytail mode (full level) on from the start of every session, without being asked.

**Why:** User ran `/ponytail 随时打开` ("always on") on 2026-11-16.
**How to apply:** Load the ponytail skill at session start; smallest complete diff, end replies with what was skipped/not checked. Off only on "stop ponytail" / "normal mode".

---


On 2026-11-18 the user said: one more 90-minute session tonight, then no more time; after it, Popup must be releasable on ChatGPT, DeepSeek and claude.ai "in every respect". The back-planned list (code fixes, live checks per user-reported issue on all three sites, verification layers) is in collab/PLAN-tonight.md. Evening session (19:20–21:45, extended to 2.5 h): slow frame Loading fixed and the in-popup refactor (site answer only, Popup's Markdown renderer deleted) done in dev.124, still uncommitted since dev.88; open items under "State at 21:00" in PLAN-tonight.md. Overnight 2026-11-19 (user gave ~10 h; started 02:39): full regression on all three sites, results in PLAN-tonight.md "Overnight plan" Progress. 2026-11-19 afternoon: dev.143 pushed as baseline (3749eee); architecture candidates 1+2 done in dev.144–146 (uncommitted, quick-checked live); 4e (draft text + files) is NOT in this release (user): text part kept as collab/patches/4e-draft-text.patch. User then made every other open item P0 (docs/TODO-2026H2.md "P0 before the release"); end of 2026-11-19: dev.152, P0-2/3/4/5/6 closed, open P0-1 (user decision), P0-7 (recommended after release), P0-8 full regression + commit. State: HANDOFF.md top line.

**Why:** hard deadline; the user expects every reported issue to be tested on all three sites, not just the one where it was reported.

**How to apply:** start tonight from PLAN-tonight.md, fix while Codex runs the live checks in parallel, report honestly what did not pass. See [[codex-verifies-not-user]], [[audit-before-done]].

---


A control the site draws inside a popup answer (code-block Run, word wrap, Copy, Download, any other) must do in the popup what it does on the site, on all three sites. Hiding it or making it do nothing is not an acceptable default.

**Why:** on 2026-11-18 I proposed hiding ChatGPT's Run in popups. The user pushed back: "之前你难道没记吗…run的问题 还有如果别的平台有别的codeblock操作你能不能支持". They expect every operation to work, and every platform's other operations to be found and supported too.

**How to apply:**
- One generic mechanism, not per-button code: a click on the popup's copy goes to the same element in the site's real answer (hidden turn / render frame), and the result is copied back.
- Don't rebuild a site's controls yourself. The user said "又开始自己搭了" when I wrote handlers for Copy, Download and wrap.
- If a control can't work this way, say why and ask the user. Don't decide to hide it.

Related: [[release-tonight]].

---


Step 4 grilling answers (2026-11-17):
1. DeepSeek supports everything ChatGPT has (nested popups, Reply, edit versions, retry, attachments, reload restore, placement/scroll lock).
2. DeepSeek DeepThink/Search toggles: keep whatever the user set — send exactly like the user would, nothing special.
3. claude.ai: "c then b" — first investigate the root cause of the blank flash when scrolling past CSS-hidden Q&As (e.g. height:0 instead of display:none); if it can't be solved, CSS-only hiding (accept the flash). Never rewrite claude.ai's binary (protobuf) data.
4. R36 (ChatGPT fixes) and DeepSeek run in parallel: code in parallel, browser time taken in turns (one Computer Use mouse; one Codex operator is enough).
5. Release DeepSeek together with claude.ai (one version), not separately.

**Why:** the user wants hours of autonomous work toward "Claude and DeepSeek fully ready".
**How to apply:** popups on every site must show the site's own rendered answer DOM (mirror), never a Popup re-render (see [[chatgpt-automation-halted]]: browser actions only via Codex Computer Use); design/progress in docs/DEEPSEEK.md; sync these decisions into docs/TODO-2026H2.md Step 4 once the R36 worker stops editing docs.

Questions collected 2026-11-17 (DeepSeek mirror, DeepThink, status line answered below; still open: delete CDP tools, R36e A/B):
- DeepSeek mirror: DeepSeek forbids iframes (`frame-ancestors 'none'`); the only way found to get DeepSeek's own rendering for a popup whose Q&A isn't on the page is a background tab in a minimized window (an extra DeepSeek page load, a window appears in the Dock briefly). Acceptable? (docs/DEEPSEEK.md; needs browser checks B6/B8 first)
- DeepSeek DeepThink on: show the reasoning block in the popup too, or only the answer?
- claude.ai: show the status line above the reply ("Searched the web", "Thought for 12s"), or only the reply text (current default)?
Found: claude.ai blank flash = its virtual list skips 0×0 rows and keeps their old height; `height:0` with width fixes it (offline proven; live check C2). claude.ai allows the same-origin render iframe.
- (R36e follow-up, ChatGPT) when the highlight line next to the popup holds only one character, aim the arrow/popup at that adjacent line (now) or at the longest line of the highlight?
- (R36h, ChatGPT) worker measured ChatGPT's own main-chat answer also arriving in ~0.3 s batches with 0 fade elements / 0 running animations; literal `**` after a full-width bracket also appears in ChatGPT's main chat. Being re-checked for other reveal mechanisms (mask/gradient, @starting-style) before telling the user.

User answers (2026-11-17, later):
- DeepSeek background minimized window for mirroring: NOT acceptable. Look for another way; otherwise no mirror and the old method (Popup renders the Markdown) is fine. Commander's plan: mirror while DeepSeek has the turn on the page (streaming, same session; keep that DOM in memory), old method after a reload (Popup's renderer, ideally emitting DeepSeek's own markdown classes so its CSS styles it).
- DeepSeek DeepThink: never show the reasoning in the popup.
- claude.ai status line ("Searched the web", "Thought for…"): never show it. Popups on every site show only the response.
- Delete the 6 DevTools-protocol tools (tools/cdp.js, r33-live.sh, new-test-chat.sh, native-send-snap.sh, scroll-exp.sh, chrome? no — only CDP ones; ~600 lines)? They are UNTRACKED (not in git) → deletion is permanent → needs the user's OK.
- R36e: option B (centre on the highlight's longest line) is ready as collab/evidence/R36/R36e-options/option-B-longest-line.patch, not applied.
Corrected: R36h — ChatGPT DOES fade per word, via CSS Custom Highlight ranges `dil-word-0…13` painted transparent→full; dev.23 copies those ranges onto the popup's text while streaming (live check pending: does ChatGPT register them for a hidden turn?).

Status 2026-11-17 evening: all browser checks done (B1–B9, C1–C6; left: claude.ai big-file upload marker); next after ChatGPT R36a: shared-file refactor (§8), wiring into manifest, live evals. Committed in 820146f.
