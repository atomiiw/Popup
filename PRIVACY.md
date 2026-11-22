# Privacy Policy — Popup

**Last updated:** November 21, 2026

## Data Collection

Popup does **not** collect, transmit, or share any personal data. All data stays on your device.

## What is stored

The extension uses `chrome.storage.local` to save, per conversation:

- Which text you highlighted (the selected words and the message they are in) and how your popups nest
- Which messages in the conversation belong to each popup, so they can be hidden from the main chat and shown in the popup again

Popup does not store questions or answers. A popup shows the answer as the site itself draws it, read from your own conversation on that site.

This data is stored entirely in your browser's local storage. It is never sent to any external server, analytics service, or third party.

## Permissions

- **storage** — Used to remember your highlights across page reloads.
- **host_permissions (chatgpt.com, chat.openai.com, claude.ai, chat.deepseek.com)** — Required to run content scripts that detect text selections, send your follow-up questions through the site's own chat box, and show the answers in popups on ChatGPT, Claude and DeepSeek.

## Third-party services

Popup does not use any third-party services, analytics, tracking, or external APIs. It works entirely through your existing session on ChatGPT, Claude or DeepSeek; your questions go only to the site you are using, as normal messages in your conversation.

## Contact

If you have questions about this privacy policy, open an issue at [github.com/atomiiw/Jump-Return](https://github.com/atomiiw/Jump-Return) or contact the developer.
