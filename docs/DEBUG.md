# DEBUG — Quality Assurance

1. ~~**Brief mode contaminates normal responses.** When user sends a popup question in Brief mode, subsequent normal ChatGPT responses (outside Popup) also come back brief. The one-time brevity prompt isn't scoped tightly enough — need to prompt engineer it so ChatGPT treats it as truly single-use.~~ **FIXED**

2. ~~**Search bar should use a line, not a box.** Redesign the search bar to be a slim horizontal line showing the user query, not a padded floating box with transparent background.~~ **FIXED**

3. ~~**Search bar should be toggleable.** It should be dismissible rather than always visible.~~ **FIXED**

4. ~~**Search bar should be attached to the top.** It should look fixed to the top edge of the viewport like the black top edge of an iPhone — solid, structural, not floating or transparent.~~ **FIXED**

5. ~~**Search bar button colors are inconsistent.** The buttons don't match the color scheme used by other Popup buttons. Correct them to match the Style Guide icon color reference.~~ **FIXED**

6. ~~**Highlight colors are ugly.** The current highlight color palette needs to be redesigned with more carefully chosen colors.~~ **FIXED**

7. ~~**Popup gets cut off at the bottom of the page.** When a highlight is near the bottom and the popup opens below it, a long popup gets submerged past the page bottom and cut off at the waist. Should auto-detect when the popup would overflow and flip it to open above the highlight instead.~~ **FIXED** — initial placement now checks scroll bounds exactly; during streaming, `checkStreamingOverflow` dynamically flips direction if the popup grows past the container edge.

8. ~~**Cmd+F search order doesn't interleave nested popups.** Search results cycle through DOM matches and L1 popup matches in correct page order, but nested popup matches are grouped after their parent rather than interleaved by position. If a keyword appears in a parent popup's response between two matches in a child popup, the child matches should be visited between the parent matches — not all lumped after.~~ **FIXED**

9. ~~**Popup windows blend into the background.** The popup needs more visual distinction from the page — stronger border, shadow, or contrast so it's clearly a separate floating element.~~ **FIXED**

10. ~~**Hover underline gap is different for popup highlights vs DOM highlights.** The gap between the text and the underline is larger for highlights inside popup responses than for highlights on the main page. They should look identical.~~ **FIXED** — `createUnderlines` used `getBoundingClientRect()` (border-box origin) but absolutely positioned children use the padding-box origin. Missing `borderTopWidth`/`borderLeftWidth` offset caused a 1.5px error when `posParent` was `.jr-popup-response` (which has `border-top: 1.5px`).

11. ~~**Nested popup doesn't follow highlight on reopen.** After generating a chained response, closing just the chained popup, then clicking its highlight to reopen — the popup was fixed on the screen instead of scrolling with the parent. Closing and reopening the parent fully worked fine.~~ **FIXED** — chained highlight spans aren't inside an AI turn article, so `closest(S.aiTurn)` returned null and `contentContainer` defaulted to `document.body`. Fixed in three places: `resolveContentContainer` now checks for parent `.jr-popup` first and rejects `document.body` as cached value; `sendContentContainer` walks up to parent popup's container for chained highlights; entry's `contentContainer` is refreshed after positioning.

12. ~~**Search bar overlaps chat text (floating island).** ChatGPT removed its upper bar, so the search bar now floats directly on top of chat words with no visual separation — just an icon, a line, and a few words. Give `.jr-search-bar` a proper floating island appearance with a solid background, border, border-radius, box-shadow, and padding so it looks like a self-contained pill/card.~~ **FIXED**

13. ~~**Popup should appear on button click, not immediately on highlight.** Change to a two-step flow: highlight text → a small floating trigger button appears near the selection → click button to open popup.~~ **FIXED**

14. ~~**Default to medium response length.** Change default from "regular" to "medium" with a moderate-length prompt instruction. Both medium and concise modes append a "return to normal length" reset at the end. Rename "brief" → "concise" and "regular" → "medium" throughout.~~ **FIXED**

15. ~~**Send button hover should show both Medium and Concise.** Replace the single switch button with a two-item dropdown showing both options, with the current mode highlighted.~~ **FIXED**

16. ~~**Reduce highlight colors from 5 to 3.** Change from 5 colors to 3 (blue, yellow, pink). Remove green and purple.~~ **FIXED**

17. ~~**"Reply to whole response" feature.** Add a "Reply" button at the bottom of completed popup responses for responding without highlighting.~~ **FIXED**

18. ~~**Remove auto-scroll during streaming.** Remove auto-scroll so the user can scroll freely during generation.~~ **FIXED**

19. ~~**Allow resizing popup while response is generating.** Resize drag handles should work during streaming too.~~ **FIXED**

20. ~~**Reply button stops working after closing the reply popup.**~~ **FIXED**

21. ~~**Edited question should update immediately, not wait for the response.**~~ **FIXED**

22. ~~**Reply button should be per-version, not shared across all versions.**~~ **FIXED**

23. ~~**Trash icon disappears after editing a question.**~~ **FIXED**

24. ~~**Blank space appears at the bottom of popup when hovering a nested highlight.**~~ **FIXED**

25. ~~**Chat bubble trigger button should be inside the popup edge, not outside.**~~ **FIXED**

26. ~~**Long quote blocks should be capped at 6 lines with a scroller.**~~ **FIXED**

27. ~~**Nav arrows should be behind popups, not above them.**~~ **FIXED**

28. ~~**Auto-focus the typing bar when Reply is clicked.**~~ **FIXED**

29. ~~**Reopening a reply popup mid-generation shows stale state.**~~ **FIXED**

30. ~~**Popup clamping and height caps.**~~ **FIXED**

31. ~~**"Waiting for response" leaks across versions and blocks the queue.**~~ **FIXED**

33. ~~**Links in popup responses don't open.**~~ **FIXED** — ChatGPT renders links as `<span class="...entity-underline...cursor-pointer...">` with React onClick handlers (not `<a>` tags). Cloning kills the handlers. Fix: `wireResponseClicks` detects entity spans and buttons, `proxyClickToHiddenTurn` finds the matching element in the original hidden response turn (which still has live React handlers) and clicks it — triggering ChatGPT's sidebar panel. Also handles real `<a>` tags via `window.open()` and `processResponseLinks` fixes up hrefs. `mouseup` handler skips entity/button clicks to avoid interference.

34. ~~**Image carousel missing for multi-image responses.**~~ **FIXED — LOCKED, DO NOT MODIFY** — Collapsed 3-thumb gallery with lightbox carousel. Multiple independent image groups per response are detected and each gets its own gallery. Clicking any thumb opens a full-screen lightbox with left/right navigation (fixed to viewport), keyboard support (←/→/Escape), counter, and close button. Closing the lightbox returns to the popup without dismissing it. Components (all marked `[CAROUSEL-LOCKED]` in source):
    - `src/popup.js`: `isContentImage()`, `processResponseImages()`, `findLCA()`, `buildGallery()`, `openLightbox()`, `GALLERY_VISIBLE` constant, `JR.processResponseImages` export
    - `src/chat.js`: `JR.processResponseImages` calls in `showResponseInPopup()`
    - `styles.css`: `.jr-gallery`, `.jr-gallery-thumb`, `.jr-gallery-badge`, `.jr-lightbox`, `.jr-lightbox-img`, `.jr-lightbox-close`, `.jr-lightbox-prev`, `.jr-lightbox-next`, `.jr-lightbox-counter`

35. ~~**"Ask ChatGPT" dismiss × causes layout flash.**~~ **FIXED** — The old approach injected the × inside ChatGPT's native button and modified its `position` and `paddingRight`, which required `getComputedStyle` reads and caused a visible reflow (the button visibly jumped wider). The MutationObserver fires after the browser has already painted, so `visibility: hidden` tricks were unreliable. Fix: the × is now a separate `fixed`-position element on `document.body`, positioned relative to the Ask ChatGPT button's bounding rect. No modifications to the native button at all — zero reflow. Lifecycle: MutationObserver shows × when Ask ChatGPT appears and removes it when Ask ChatGPT disappears; `removeTriggerBtn` also removes ×; × click only removes × (trigger and selection persist via `preventDefault` on mousedown).

36. ~~**Popup slow to appear after clicking trigger button (~500ms).**~~ **FIXED** — Layout thrashing: `highlightRange` mutated DOM, then `createPopup` called `getComputedStyle` (forced layout #1), then `positionPopup` read `offsetWidth/Height` (forced layout #2), then `syncHighlightActive` → `createUnderlines` called more `getComputedStyle`/`getClientRects` (forced layout #3). Each pass ~100-150ms on ChatGPT's complex DOM. Fix: moved the `getComputedStyle` position check into `positionPopup` to batch with existing `getBoundingClientRect`; deferred `syncHighlightActive` + `updateNavWidget` to `requestAnimationFrame`; cached `getComputedStyle` results in `highlightRange`'s TreeWalker loop.

37. ~~**Popup/arrow don't follow highlight on layout change.**~~ **FIXED — LOCKED, DO NOT MODIFY** — When ChatGPT's left sidebar closes, right research sidebar opens, or window is resized, the popup, anchor arrow, and underlines now track the reflowed highlight. Components (all marked `[LAYOUT-LOCKED]` in source):
    - `src/popup.js`: `attachResizeListener()` — updates left, top, and arrow on resize
    - `src/popup-helpers.js`: `getPopupMaxRight()` — accounts for right sidebar via chat column right edge; `JR.isRightSidebarOpen()` — detects right sidebar; `JR.updateNavWidget()` — hides nav widget when right sidebar is open
    - `content.js`: `ResizeObserver` on chat column — fires resize handler + nav widget toggle on sidebar open/close

32. **Stopped questions showing up in the chat.** If I send a question through the popup and then stop ChatGPT's generation immediately, the question (and sometimes the empty response) would show up in the regular chat as if I typed it myself. Never fully solved — avoided by disabling the stop button while a Popup response is generating. Users can still stop their own (non-Popup) questions normally.

33. **Composer flash — injected question visible in input box for ~0.5s.** When sending a popup question, the extension pastes text into `#prompt-textarea` via a synthetic `ClipboardEvent` then clicks Send. Two things made the pasted text briefly visible: (1) the paste itself — React renders the text in the composer immediately, and nothing was hiding it; (2) React clears the input asynchronously after Send is clicked, so removing the hiding CSS right after `sendBtn.click()` left a window where the text was still in the DOM and visible. Fixed by injecting a `<style>` before the paste that sets `color: transparent` and `caret-color: transparent` on the textarea and locks the composer parent to its current `max-height` with `overflow: hidden` (prevents the composer from growing). After clicking Send, the style is not removed immediately — instead it polls with `requestAnimationFrame` until `chatInput.textContent` is empty (or bails after 20 frames), ensuring React has actually cleared the field before the text becomes visible again. **FIXED**
    - `src/chat.js`: `sendMessage()` — hideStyle injection before paste, `removeHideWhenEmpty()` rAF loop after send

38. ~~**Enter sends question while typing in Chinese IME.** While composing Chinese (or any IME-based language) in the popup's question input, pressing Enter to confirm a candidate from the IME selection box also fires the popup's send handler — submitting half-typed gibberish. Should ignore Enter while an IME composition is active and only send once the user has committed the text and pressed Enter again.~~ **FIXED** — both keydown handlers in `src/popup.js` (initial question input at the `questionText` listener, and the edit-question input) now bail out early when `e.isComposing || e.keyCode === 229`. While the IME's candidate window is open the browser sets these flags on the keydown event, so Enter passes through to the IME for composition confirmation; a subsequent post-commit Enter has both flags false and sends as before.
    - `src/popup.js`: initial-question keydown listener and edit-question keydown listener

39. ~~**Popup near bottom edge pushes DOM up during streaming instead of flipping above.** When a highlight near the bottom of the page opens its popup and the popup is initially placed below the highlight (because at open-time there was enough room), as the AI response streams and the popup grows taller it eventually exceeds the page's lower edge. Instead of flipping the popup to open above the highlight, the page DOM gets pushed upward — leaving a large empty gap below the last AI response. The correct flip-above only happens once generation finishes. The upper-edge case already behaves correctly: when a popup placed above is about to grow past the top of the viewport, it bounces and re-anchors below the highlight on the fly. Want the same "hit the edge → flip to the other side" behavior at the lower edge during streaming, not just after generation completes.~~ **FIXED** — Studying *why the upper edge works* was the key. In "above" mode, `attachAboveAnchorObserver` actively drives `popup.style.top` downward as height grows (anchored at the highlight's bottom), so it crosses the stable threshold `0` deterministically — `popupTop < 0` is a position-vs-fixed-reference test that fires the moment the popup overflows the container's top edge. The "below" mode has no analogous moving anchor: popup top is fixed and `scrollHeight` grows in lockstep with the popup, so the original `popupBottom > scrollHeight` could never fire, and viewport-position checks were defeated by ChatGPT's auto-scroll racing the detection. Fix: capture a **height threshold at popup placement time** for "below" mode, frozen before any auto-scroll can move things. During streaming we just compare `popup.offsetHeight > popup._jrMaxHBelow`. `offsetHeight` is what's actually grows, the threshold is stable, no viewport-position math involved — symmetric in spirit to the upper-edge mechanism (a growing value crossing a fixed reference). The upper-edge check is restored to the original `popup.style.top < 0`. A one-shot `popup._jrFlippedDuringStream` flag prevents oscillation. After the flip to "above", `_jrBottomAnchor` + `attachAboveAnchorObserver` keep the bottom pinned to the highlight as the response continues streaming. **Trailing fix:** the threshold is the **smaller** of (a) viewport room `window.innerHeight - rect.bottom - gap` and (b) container room `naturalScrollH - top`, where `naturalScrollH` is captured before the popup is appended. The container-room half flips the popup *before* its growth ever expands `contentContainer.scrollHeight` — that container-expansion was leaving a residual blank space below the last AI response after the flip, until generation finished.
    - `src/popup-helpers.js`: `positionPopup` captures `naturalScrollH` pre-append + `_jrMaxHBelow = min(viewport-room, container-room)`; `checkStreamingOverflow` uses `popup.style.top < 0` (above) and `popup.offsetHeight > _jrMaxHBelow` (below), with a one-shot `_jrFlippedDuringStream` guard
