# The send outcome (overnight plan A1, 2026-11-20 night)

## Why
The redesign's decision 12 left this for later: chat.js `waitForResponse` decided by itself whether a send went out,
whether it is done, whether it failed, and which turn is ours.
- **Five "done" rules** in one poll, and its own empty rule at capture.
- **At least four failure owners**: chat.js's timers, `immediateTimeout`, availability's tick, and popup.js's stale
  pending check.
- **Today's live failures were all on this path**:
  - "Couldn't get a response" everywhere;
  - a resumed stream that queued every later send for good;
  - image-only answers;
  - a queued send dropped on navigation.

A fresh architecture exploration (subagent, read-only) mapped the inputs, the timers and the side effects, and proposed
the seam below. The user was asleep, so the choices are mine, by recommendation. Any of them can be overruled in the
morning.

## Decisions
1. **One place decides**: `src/send-outcome.js`, pure.
   - `decide(facts) → wait | capture | resend | fail(stage) | stop-fail`, plus `readResume` and `report` flags.
   - `settle(facts) → done | empty` at capture.
   - chat.js gathers the facts each poll (page, stream, box, clock) and carries the decision out.
   - All of its time limits are in one table, `JR.sendOutcome.LIMITS`.
2. **Behaviour unchanged, except three bugs**:
   - **An answer that is only an image is done**: it was stored failed when neither the page nor the stream had text.
   - **A send the site refused twice says so**: it now reads "<Site> was still answering and didn't take the question —
     nothing was sent", instead of "Couldn't get a response".
   - **An edit's version has its availability events** (send, sent, progress, done, failed), keyed by the version id
     stored when sent (audit #4).
3. **Offline replay tests**: `tools/send-outcome-test.js` replays the live cases as lists of what was known at each poll:
   plain send, thinking model's resume token, image only, refused once and twice, refused with files, idle, the turn
   not found, a long answer, a stuck one, stale.
4. **Not moved yet (A1b, next)**:
   - the three record paths (`captureResponse`, `saveTimeoutVersion`, `immediateTimeout`) merged into one;
   - dead branches without a pre-registered item (~55 lines; every caller pre-registers);
   - `netActive` derived from the outcome;
   - queue policy;
   - one failure owner: availability's tick and popup.js's stale-pending check.

   Each changes stored data or the most delicate path (refusal / resend, freeze timing). They come one at a time, with an
   event recorder for live sequences first.

## Known, by reading (not verified live)
- **Navigation while a send is watched**: the watch is not cancelled. Returning to the chat before it ends can race
  popup.js's stale-pending check.
- **Queued sends dropped on navigation**: stored pending, failed only when their popup is next opened.
- **A net question mismatch with the turn virtualized away and the site idle at 3 s**: a quick-timeout failure. This
  is a candidate source of some live "Couldn't get a response" — check with the recorder.
