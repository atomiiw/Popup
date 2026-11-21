# Popup regression suite (ChatGPT · DeepSeek · claude.ai)

Run it **once a month and before every release**. It checks everything that has broken before, on all
three sites. Anyone can run it: you need this repo, Google Chrome, and an account on each site. Write the
result in [REGRESSION-LOG.md](REGRESSION-LOG.md).

- **Part A — offline (5 minutes, one command).** Code-level checks, no browser login.
- **Part B — live, every site.** The core flow on ChatGPT, DeepSeek and claude.ai.
- **Part C — live, per site.** Behaviour only one site has.

Every case names the bug reports it guards (`R…`, `dev.…`, `DS-…`, `CL-…`). Details of each report:
[REPORTS.md](REPORTS.md), [DEEPSEEK.md](DEEPSEEK.md), [CLAUDEAI.md](CLAUDEAI.md), [EVALS.md](EVALS.md).
A failed case means a feature broke: write it in the log, then fix it before a release.

---

## Part A — offline checks

```
tools/regression-offline.sh
```

Needs macOS (two checks run with `osascript`), Node ≥ 18 (`node` on PATH, or `NODE=/path/to/node`) and Google
Chrome (`CHROME=/path/to/chrome` if it is not in /Applications). It prints one line per check and ends with
`ALL PASS (version …)`; anything else is a failure (the line says which test inside failed).

| id | what it checks |
|---|---|
| A1 | every script parses |
| A2 | the message format Popup sends and reads back (`tools/qa-content-test.js`) |
| A3 | ChatGPT: Popup Q&As filtered out of the conversation data, next message's parent fixed (`tools/net-tap-test.js`) |
| A4 | every content script loads in manifest order on each site (`tools/load-smoke.js`) |
| A5 | DOM logic per site: text matching, hiding selectors, attachments, popup height/side, versions after a reload, DeepSeek stream/search/outline/list window, claude.ai question text and file tiles (`tools/dom-test*.html`) |

---

## Before the live parts: setup (once per computer)

1. **Load Popup.** `chrome://extensions` → Developer mode on → *Load unpacked* → this folder. After every
   update of the folder click ↻ on the Popup card, then reload (⌘R) every test tab. The card shows the version
   (`1.2.x-dev.N`): write it in the log.
2. **Test conversations — never your real chats.** Create one conversation per site with these messages (the
   cases need a long text answer, a rich answer and room to scroll):
   - ChatGPT and claude.ai: `用五段话详细介绍光合作用的完整过程`, then `用一个小表格、一个公式和一小段 Python 代码解释光合作用`,
     then (claude.ai) `搜索一下今天的天气新闻，然后用一个小表格总结`.
   - DeepSeek (DeepThink and Search off): the same two, then `用五段话介绍火山的形成`.
   Write the three URLs in the log; use the same ones every month (popup questions pile up there, which is
   part of the test).
3. **Site settings for the base run:** light theme, English interface, DeepSeek DeepThink and Search off.
   Cases C-dark / C-lang / D2 / D3 change a setting: put it back afterwards.
4. **Window:** Chrome at least 1280 × 800, in front, nothing else using the mouse or keyboard during a case.
5. **Files for attachment cases:** `tools/fixtures/test-orange.png`, `tools/fixtures/test-blue.png`.

**Words used below**
- *Highlight* = select a few words in an answer, click the small Popup icon. *Ask* = type in the popup, press
  Return. Always pick words never highlighted before (an old highlight opens its old popup).
- *Fresh page* = ⌘R, then wait 10 seconds without touching anything.
- *Take screenshots* before you press Return, while the answer streams, at the end, and 10 s later.

**Pass words** (every live case uses some of them)
- **STILL** — the text you were reading does not move: no jump, no scroll, not even for a moment (compare the
  screenshots: the highlight is at the same height in all of them).
- **HIDDEN** — the popup's question and answer never appear in the main chat, not even briefly (on DeepSeek's
  question outline they appear only as a clean "· question" entry, see D3).
- **NATIVE** — the popup answer looks like the site's own answer: same font and spacing, real tables, math in
  math font, code blocks with indentation and a copy button; no raw `**`, `$…$`, `[citation:…]`, no
  "Thinking"/"Searched the web" lines.
- **SETTLED** — once the answer is complete nothing in the popup changes any more (wait 10 s).
- **NO-BLANK** — no empty area where content should be (in the chat, at its bottom, in the outline).

---

## Part B — live, run every case on ChatGPT, DeepSeek and claude.ai

| id | steps | pass | guards |
|---|---|---|---|
| B1 side & arrow | Scroll so an unused sentence sits in the upper quarter of the screen; highlight it. Close (Esc). Scroll so another sits in the lower quarter; highlight it. Then highlight words that wrap over two lines with most of them on the second line. | By the room to the conversation's start and end, not the screen (user 11-21): its full length (70 % of the window, or the dragged height) doesn't fit before the end → above; not after the start → below; fits both ways → the side with more room on screen now; fits neither (a short chat) → the roomier side, no taller than the room to the chat's start / end. On ChatGPT a popup covers the "can make mistakes" line, under the send box. The arrow sits on the highlight's line next to the popup; sideways it is centred on the line holding most of the highlight (user's choice R36e "最长" — so with the popup above and most of the highlight on the second line, the arrow tip can be over a gap in the first line). The popup never covers its highlight. | R18 (dev.48), R36e, ChatGPT trigger icon after its DOM change |
| B2 first send | Fresh page. Highlight in the middle of the long answer, ask `一句话解释`. | STILL, HIDDEN, NO-BLANK (also at the bottom of the chat), SETTLED. (Word-by-word streaming is checked in B10, with a long answer.) | R33, R36a, CL-send-1/3, DS-E2, dev.39 |
| B3 send arrow | Highlight elsewhere, type `再一句话`, click the popup's send arrow (not Return). | as B2 | E-send-2/3, DS-E3 |
| B4 Reply | In B3's popup click *Reply*, ask `更短`. | as B2; the first popup stays on its Reply button | E-send-4, DS-E4, CL-reply |
| B5 edit | Click B4's question, change it to `更短，五个字`, Return. Then click ‹ and › . | as B2; ‹ › appear; ‹ shows the old question and answer, › the new | E-send-5, DS-E5, CL-edit |
| B6 nested | Select words inside a popup's answer, click the icon, ask `一句话`. Repeat in 3 popups. | The nested popup opens on the **first** click every time; as B2 | R35, DS-E13, CL-nest |
| B7 after a reload | Fresh page. Click B3's highlight, then its Reply, click ‹ then ›; click B6's nested highlight. | Highlights are back; popups show their Q&A; ‹ › still there and ‹ shows the old answer **within 5 s** (a short "Loading…" first is fine, endless is a fail); while switching, the popup's height changes at most once (to the other version's answer), never shrinks first; nested highlight opens; HIDDEN | dev.41, dev.43, dev.50, DS-E11, CL-reload |
| B8 site drawing after a reload | Fresh page. Open a popup whose answer has a table or formula — once on a recent answer, once on the oldest answer of a long chat. | It shows only the site's own drawing ("Loading…" before is fine, a few seconds — longer the first time after a reload; never Popup's own drawing, never endless) and NATIVE (math in math font, no raw LaTeX, the site's own table style); it never changes after that (watch 15 s) | E-render-7, R34, CL-render-2, DS-E7d, dev.73 (long chat: earlier turns load only at the top) |
| B9 rich answer | Highlight, ask `用一个小表格、一个公式和一小段 Python 代码解释这句话`. Then fresh page and reopen it. | NATIVE during and after streaming and after the reload; the table uses the popup's width (not squeezed into a narrow column); wide tables/code scroll sideways inside the popup; code keeps indentation; the code block's Copy copies the code and Download (DeepSeek) saves it as a file, a ✓ shows for a moment | R34, R36b/f/g, E-render-1…4, CL-render-1, DS-E8, popup tables (container-type) |
| B10 streaming | Ask for a long answer (`用三段话详细解释`). Do nothing while it streams; then ask again and scroll inside the popup while it streams. | Words appear at the site's own pace: Popup adds no batching. Screenshots a second apart can't show this; measure it (macOS: `tools/stream-log.js`, see "Measuring precisely") — every logged pair "popup/site" must be equal while it streams (2026-11-18: DeepSeek every ~60 ms, claude.ai ~150 ms, ChatGPT ~240 ms with its own word fade). By eye: no half-screen jumps; the popup keeps the newest words in view until you scroll inside it, then stays where you put it; a popup opened above grows smoothly upward; SETTLED | R36h, R36i, R36j |
| B11 context | In the main chat (not a popup) ask `我刚才在弹窗里问的最后一个问题是什么？一句话`. | The site names your last popup question (popup Q&As are part of the conversation). This main-chat message is visible normally. | CL-context-1, DS-E12 |
| B12 many popups, then the main chat | On the long answer ask 8 popup questions in a row (short ones), then send one message in the main chat. Fresh page, scroll to the bottom, then 20 wheel steps up and back. | Your main-chat message and its answer are visible; NO-BLANK; HIDDEN | DeepSeek list window (dev.62/63) |
| B13 attachments | (a) Paste `test-orange.png` into the site's own input box, then try to send a popup question. (b) Remove that file. Highlight, paste `test-orange.png` into the popup question, ask `图里是什么颜色？一句话`. (c) Fresh page, reopen it. | (a) sent; the user's own files and draft are set aside for the send and put back in the site's box after it (4e, 11-20 — was: not sent). (b) a tile above the question; the answer says orange; the site's input box is never seen with the file (it hides during the hand-over) and is empty afterwards; STILL; HIDDEN. (c) the tile is back and shows the image | Step 2, dev.51–56 (claude.ai image questions failed and leaked) |
| B14 scrolling | From the bottom of the chat scroll up 30 wheel steps slowly, then back down. | NO-BLANK, no flicker, HIDDEN | CL-hide-1, DS-B7 |
| B15 navigation | With a highlight on screen: open the site's Settings and come back by the browser's Back button; again by clicking the conversation in the sidebar; again by closing Settings. Then open another conversation and come back. | Every time the highlights are there and open their popups | dev.42 (claude.ai lost highlights after a few Settings trips), dev.47 |
| B17 flip through popups | Fresh page, scroll to the top. Press the ∨ of Popup's arrows (right edge, "n / m") about 12 times, then ∧ 3 times. | Popups come in their place on the page, top to bottom; a popup's own popups (nested, then its Reply) come right after it, opened at their level; ∧ goes back the same way. Each jump — to a popup at any level, nested ones too — brings the highlight to the bottom fifth of the visible chat, the popup opens above it (at the very start of the chat, where it can't get that low: the top fifth, popup below, never behind the composer), and from then on the highlight doesn't move — while it loads the popup only grows upward, no taller than the room under the header. Also from the very end of the chat: each ∧ opens its popup (live NT17–NT21). Every popup shows its question and answer, also after fast presses (never "Loading…" for good) | user 2026-11-18 (order, placement, no push; claude.ai loading forever) |
| B18 resize | Open a popup with a long answer (it scrolls inside). Drag its edge next to the highlight out, then in; the far edge; then each corner. | Both edges change the height — outward taller, inward shorter, within 40–70 % of the window — and the highlight and arrow never move (the popup grows on its far side); every corner but the trash button's changes width and height, the trash corner only the height | user 2026-11-18 |
| B16 send menu | Type in a popup question and hold the mouse over its send arrow. | The Detailed / Concise menu appears right under the arrow | dev.40 (claude.ai: 296 px off) |

## Part C — live, one site or one setting

| id | site | steps | pass | guards |
|---|---|---|---|---|
| C-dark | all | Switch the site to dark theme. Open popups (with a table), a nested one, the send menu, a version switch. Put the theme back. | Popup, quote, highlights, arrows, inputs and menu are dark and readable; no white blocks | C3, B3, R36 dark run |
| C-lang | all | Switch the site's interface to another language (e.g. 中文); run B2 and B9 once. Put it back. | as B2 / B9 | language independence |
| G1 | ChatGPT | Open ChatGPT's Settings page with a popup open, go back. | Popups close (another page), highlights restored | ChatGPT Settings is a page |
| D1 | DeepSeek | Turn DeepThink on, ask a popup question, fresh page and reopen it. Turn it off. | The popup shows only the answer: never the "Thought for…" reasoning | DS-E9 |
| D2 | DeepSeek | Turn Search on, ask `今天有关火山的新闻？一句话`, click a source number; fresh page and reopen. Turn Search off. | No "Found N web pages" line; sources are small round numbers that open the source page; same after the reload | dev.61 |
| D3 | DeepSeek | Hover the dashes at the right edge (the question outline), scroll it from top to bottom, click one of your own questions, then click a "·" entry. | No "Regarding…" text; each popup question shows as "· question" in its place; no empty stretch anywhere (also when it opens); your own question → DeepSeek jumps to it; a "·" entry → the chat scrolls to that popup's highlight and its popup opens | dev.45, dev.64 (user, 2026-11-18: option A) |
| D4 | DeepSeek | Fresh page, scroll to the bottom. | No popup question bubble anywhere in the chat | dev.44 |
| C1 | claude.ai | Ask a popup question that makes Claude search the web (`今天的新闻？一句话`). | The popup has no "Searched the web" status line, only the reply | C5 |
| C2 | claude.ai | Fresh page, open a popup asked with a multi-line question. | The question area shows the question, not the whole message Popup sent | dev.37 |
| C3 | claude.ai | After a popup send that is the newest message, look under the last visible answer. | No large empty area (claude.ai's own small footer space is fine) | dev.39 |

## Known limits (not failures)
- A popup is up to 70 % of the window tall (or the height the user dragged). Its side has room for that in the
  conversation, but maybe not on screen: part of it can be off screen until you scroll (user 11-21: the room counts to
  the conversation's start / end). Only in a chat too short for it either way is it cut to the room there.
- ChatGPT, a chat with very long answers (20 000 px): sending while reading far up, ChatGPT itself lays its list out
  anew and the reader's place is lost (also for a plain main-box send) — accepted by the user 11-21 (G2).
- Wide tables, formulas and code scroll sideways inside a popup (as on the sites themselves); drag the
  popup's edge to make it wider.
- DeepSeek may answer an English popup question in Chinese when the conversation is Chinese (its choice).

## Measuring precisely (optional, macOS, maintainers)
For a jump that is too short to see, the recorders in `tools/` log every frame: run them in the page with
`python3 tools/chrome_js.py --url <part of the URL> @tools/<recorder>.js` (Chrome → View → Developer → Allow
JavaScript from Apple Events). `stream-log.js` (popup vs site text per frame while streaming, B10), `scroll-call-log.js` (scroll position per frame),
`highlight-log.js`, `popup-final-snap.js` (last streamed vs final answer), `send-snapshot.js`. They run in
an isolated world: they see the page's DOM, not the page's own JavaScript variables (Popup's page-side
debug data is on the DOM: `#jr-diagnostics`, `#jr-netlog`, `#jr-scrolllog` = the site's scroll calls Popup blocked during a send).
