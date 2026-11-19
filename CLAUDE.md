# Popup — Chrome Extension

## Overview
A Chrome extension that lets users highlight any sentence in AI chat responses, ask follow-up questions in a floating popup, and chain deeper follow-ups — all while keeping the full conversation on the same thread so the AI retains context.

## How It Works
1. User highlights text in an AI response
2. A floating popup appears near the highlight with an input field
3. User types a follow-up question in the popup
4. Extension submits it through the site's actual chat input (uses the user's account, no API key needed)
5. Extension hides that Q&A pair from the main chat flow
6. Displays the AI response inside the popup instead
7. User can highlight text inside the popup → spawns a chained popup for deeper follow-ups

The AI platform's backend has the full conversation (all popup Q&As are real messages in the thread), so it keeps full context, memory, and continuity. The extension only rearranges the presentation layer.

Without the extension installed, the user still sees all Q&A in their normal chat history — just unordered/cluttered, but nothing is lost.

## Architecture
- **Manifest V3** Chrome extension
- `manifest.json` — Extension config, permissions, and content script registration
- `storage.js` — Persistence of highlight keys (one record per conversation, no content) using chrome.storage.local
- `src/site-adapter.js` — The only place with ChatGPT DOM selectors; `JR.diagnose()` self-check; on other sites it hands `JR.site` to `src/sites/deepseek.js` / `src/sites/claude.js` (same interface)
- `src/site-hosts.js` — per-site storage key, conversation id and hide CSS, needed before the site layers load (early-hide.js, storage.js)
- `src/site-render.js` — hidden same-origin frame where the site draws an answer that isn't on the page (ChatGPT, claude.ai; DeepSeek forbids framing)
- `src/site-answer.js` — a popup's answer is the site's own drawing: the active popup's copy follows its original node by node, and clicks on the site's controls go to the original (`GLOSSARY.md`: site answer, original, copy). Popup has no Markdown renderer of its own
- `src/qa-content.js` — Message format, hiding Q&A turns, reading answers back from ChatGPT
- `src/scroll-guard.js`, `src/net-tap.js`, `src/sites/deepseek-net.js` — MAIN-world helpers (block the site's auto-scroll during a send; read the answer stream on ChatGPT / DeepSeek)
- `src/attachments.js` — Files in popup questions (attachment layer, notes, read-back)
- `collab/` — Claude ↔ Codex collaboration: **`HANDOFF.md` = current status and how to continue on a new computer; `PROTOCOL.md` = how the user works and how to drive the Codex operator (read both first)**; `briefs/` = example task briefs; `BOARD.md`/`evidence/` are local-only
- `icons/` — Extension icon (128px)
- `tools/fixtures/` — Test files for attachment tests
- **Permissions:** `storage` (highlight keys); host access to chatgpt.com / chat.openai.com, chat.deepseek.com, claude.ai
- **Supported sites:** ChatGPT; DeepSeek and claude.ai wired in since 1.2.13-dev.32 (Step 4, designs in `docs/DEEPSEEK.md`, `docs/CLAUDEAI.md`), released together

## Docs
- [Features](docs/FEATURES.md)
- [Style Guide](docs/STYLE_GUIDE.md)
- [TODO 2026 H2](docs/TODO-2026H2.md) — current steps; **read this before every task**
- [TODO 2026 H1](docs/TODO.md) — development-phase steps (closed)
- [Regression suite](docs/REGRESSION.md) — monthly and before every release, all three sites (results: [REGRESSION-LOG.md](docs/REGRESSION-LOG.md))

## Dev Rules
- **Read `docs/TODO-2026H2.md`, `docs/FEATURES.md`, and `docs/STYLE_GUIDE.md` before every task.** No exceptions.
- **Follow the steps in `docs/TODO-2026H2.md` in order.** Only work on the current step. Do not add features, fix-forward, or jump to later steps — even if the user reports a trivial issue. If a bug report relates to a stub or placeholder from the current step, explain that it's expected behavior for this step.
- Always match the style guide for any UI changes (see docs/STYLE_GUIDE.md)
- Keep all styles in `styles.css` — no inline styles in JS
- Test on ChatGPT (light and dark, English and another UI language) before considering a feature done; `tools/regression-offline.sh` runs all offline checks at once: `tools/net-tap-test.js`, `tools/qa-content-test.js`, `tools/dom-test.html`, `tools/dom-test-deepseek.html`, `tools/dom-test-claude.html`, `tools/load-smoke.js` (once per host)
- Use `chrome.storage.local` for highlights, Q&A chains, and user preferences
