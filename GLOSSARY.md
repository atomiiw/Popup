# Popup

A Chrome extension: highlight a sentence in an AI chat answer (ChatGPT, DeepSeek, claude.ai), ask a follow-up in a floating popup, and the answer shows inside it. The question and answer stay real messages in the chat, hidden from the main thread.

## Language

**Site answer**:
The answer as the site itself draws it, with its formats and its controls (code-block buttons, citations, …).
_Avoid_: rendered HTML, response HTML

**Original**:
The live site answer in a site page: a hidden turn on the page, the same turn in the hidden copy of the chat, or the item DeepSeek's list keeps drawn.
_Avoid_: source turn, hidden turn (when the place doesn't matter)

**Copy**:
What a popup shows of a site answer, kept in step with its original.
_Avoid_: mirror, clone, popup HTML

**Answer state**:
Where a popup question's answer stands, as stored: pending (sent, the site is still answering), failed (no answer; can be asked again) or done (the site has it).
_Avoid_: response HTML, placeholder

**Availability**:
Where a version's answer stands for the popup right now, finer than its answer state and never stored: sending, streaming, locating (its original is being looked for), shown, failed (no answer: Retry asks again) or unreachable (the site has the answer but it can't be shown here: Try again looks again, nothing is resent). Every availability but shown, failed and unreachable names what it waits for and until when; "Loading" is how sending, streaming and locating look, never a wait with nothing behind it.
_Avoid_: loading state, spinner

**Locator**:
What finds a version's original, in the places its site keeps one (the page; the hidden copy of the chat; the item DeepSeek keeps drawn), and says why when it can't.
_Avoid_: finder, resolver
