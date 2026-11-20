# Availability and the locator (redesign, 2026-11-20)

Why: "Loading…" kept coming back (ChatGPT's new front end: a stuck hidden copy, a thinking model's resumed stream,
image-only answers, ∧ ∨ that can't reach unloaded turns). No module owned "is this answer available, and where?":
popup.js, chat.js, site-answer.js and site-render.js each decided with their own rules and timers, and a done answer
whose original wasn't found had no name, no deadline and no reason — Loading for good. Architecture review:
candidates 1+2 (then 3, then 5), agreed with the user in three grilling rounds (all recommendations accepted).

## Decisions (user, 2026-11-20)

1. Not released before this is done and tested: the redesign goes into 1.2.15 (the store has 1.2.14).
2. Two endings: **failed** (no answer — Retry asks again) and **unreachable** (the site has the answer, it can't be
   shown here — Try again looks again, nothing resent). When looking again can't help (not on the branch shown, no
   Q&A linked in the chat): **Ask again**, which says it sends the question again.
3. Every wait has a deadline, all in one table: sending 10 s; streaming as today (100 s with nothing new, 600 s while the
   site says it is generating); locating 30 s, counted from when the popup asked (a queued search's wait counts).
4. (Withdrawn — user 11-20: "我不喜欢那个 loading 时候的两行文字": only "Loading…"; waitingFor stays in JR.diagnose.)
   Was: after 3 s of waiting a grey line under Loading says what it waits for: "Sending…", "<Site> is answering…",
   "Finding the answer in the chat…", "Loading earlier messages…", "Waiting for another answer…" (the page: none).
   Unreachable shows its reason ("This answer couldn't be loaded", "This question isn't in the current version of the
   chat", …).
5. Never drawn by Popup from the site's data: a site answer or unreachable (no renderer of our own).
6. All four sites at once, one locator adapter per site, no switch back to the old code: the old scattered decisions go.
7. Offline first: today's bugs as replayed event sequences (thinking model ending with a resume token, image-only
   answer, stuck hidden copy, queued send, old item with no keys, paged long chat). Then one live round on all sites
   with the drawn-frame recorder; a failure goes back to an offline case, no patching live.
8. Storage unchanged: pending / failed / done. The finer availability lives in memory; after a reload it starts again.
9. A version's availability doesn't depend on its popup: closed, it keeps going (deadlines run); reopened, it shows
   where it is.
10. The hidden copy looks for one answer at a time; the others queue ("Waiting for another answer…").
11. Try again on unreachable loads a fresh hidden copy first.
12. Send detection (chat.js waitForResponse) is only wired this time: it reports events (sent, turn key, stream ended,
    done, failed); its own popup / storage decisions move to the availability module. Rewriting it (candidate 4): later.
13. Order: 1+2 (availability + locator) → 3 (one "reach a turn" for the page and the hidden copy, ∧ ∨ on ChatGPT's paged
    list) → 5 (the popup placed from the highlight's turn: the jump after a send). Then release.
14. Places per site, in order: ChatGPT, claude.ai, Claude Code — the page, then the hidden copy; DeepSeek — the page,
    then the item it keeps drawn.
15. Small commits on main, each offline-tested; the user reloads Chrome Beta only when told. Display 2 back for the live
    round (else the user's screen, ~30 min).
16. Live round: each site + Claude Code: a send; asking while the main answer writes; close and reopen; old popups after
    a reload, also in turns not loaded; ∧ ∨ to the earliest highlight; a ChatGPT image; the jump (drawn frames).

## Shape (sketch — to refine while building)

- `src/availability.js`: per version id → { kind, waitingFor, since, deadline, reason, via }. `JR.availability.on(id,
  event)`, `.of(id)`, `.subscribe(id, fn)`; a tick moves anything past its deadline on. Pure step function
  `(state, event, now) → state` exported for tests (`tools/availability-test.js`).
- `src/locator.js`: `locate(keys) → { via, turn } | { missing, why }` over the site's places (adapters in the site
  layers); one `usable(turn)` rule; one search at a time in the hidden copy, the rest queued.
- popup.js draws a version's availability (and nothing else decides it); site-answer.js keeps copying and forwarding
  clicks; chat.js's watch reports events.
