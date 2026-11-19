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
