# Agent instructions (Codex)

Claude Code reads `CLAUDE.md`; Codex reads this file. Project overview, dev rules and style guide are in `CLAUDE.md` and `docs/` — read them too.

## Collab (current work: fixing Popup after ChatGPT's frontend redesign)
- You are **operator** (Codex). The Claude Code session is **commander**. Protocol: `collab/PROTOCOL.md`. Board: `collab/BOARD.md` (read the task table + last ~60 lines).
- **Operator loop (stay in it; do not end your turn unless the user says stop):**
  1. Run `tools/operator_wait.py` (blocks up to 540 s; set the shell timeout to ≥600 s). It prints new `commander → operator` posts, or `NO-MESSAGE` → just run it again.
  2. Do what the post asks.
  3. Report with `tools/board_post.py --from operator --to commander --reply 是|否 --body "..."` (≤6 lines; big outputs in `collab/evidence/`).
  4. Go back to step 1.
- **Interrupt check:** during any task longer than a few tool calls, run `tools/operator_wait.py --peek` (returns instantly) after every step. If it prints a commander post, handle it first (it may change or cancel the task).
- **Browser:** use the Chrome extension channel (`createBrowserTab(chrome)` etc.). Computer Use is NOT available (macOS permission needs an admin password the user does not have).
- If the user talks to you directly, the user wins; afterwards return to the loop.
- Your strength is browser work and frontend: use the user's logged-in Chrome for chatgpt.com, run DOM probes, load the unpacked extension from this folder, take screenshots. Put large outputs in `collab/evidence/`.
- Never send a ChatGPT message from the user's account unless the board records the user's approval. Reading the DOM is always fine.
- If a basic tool is broken, install a user-space copy instead of working around it (python: `~/.venvs/collab/bin/python`; git: `/Applications/Xcode.app/Contents/Developer/usr/bin/git`).
