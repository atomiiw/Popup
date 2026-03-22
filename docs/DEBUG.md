# DEBUG — Quality Assurance

1. **Brief mode contaminates normal responses.** When user sends a popup question in Brief mode, subsequent normal ChatGPT responses (outside Popup) also come back brief. The one-time brevity prompt isn't scoped tightly enough — need to prompt engineer it so ChatGPT treats it as truly single-use.

2. **Search bar should use a line, not a box.** Redesign the search bar to be a slim horizontal line showing the user query, not a padded floating box with transparent background.

3. **Search bar should be toggleable.** It should be dismissible rather than always visible.

4. **Search bar should be attached to the top.** It should look fixed to the top edge of the viewport like the black top edge of an iPhone — solid, structural, not floating or transparent.

5. **Search bar button colors are inconsistent.** The buttons don't match the color scheme used by other Popup buttons. Correct them to match the Style Guide icon color reference.

6. ~~**Highlight colors are ugly.** The current highlight color palette needs to be redesigned with more carefully chosen colors.~~ **FIXED**

7. ~~**Popup gets cut off at the bottom of the page.** When a highlight is near the bottom and the popup opens below it, a long popup gets submerged past the page bottom and cut off at the waist. Should auto-detect when the popup would overflow and flip it to open above the highlight instead.~~ **FIXED** — initial placement now checks scroll bounds exactly; during streaming, `checkStreamingOverflow` dynamically flips direction if the popup grows past the container edge.

8. ~~**Cmd+F search order doesn't interleave nested popups.** Search results cycle through DOM matches and L1 popup matches in correct page order, but nested popup matches are grouped after their parent rather than interleaved by position. If a keyword appears in a parent popup's response between two matches in a child popup, the child matches should be visited between the parent matches — not all lumped after.~~ **FIXED**

9. ~~**Popup windows blend into the background.** The popup needs more visual distinction from the page — stronger border, shadow, or contrast so it's clearly a separate floating element.~~ **FIXED**

10. ~~**Hover underline gap is different for popup highlights vs DOM highlights.** The gap between the text and the underline is larger for highlights inside popup responses than for highlights on the main page. They should look identical.~~ **FIXED** — `createUnderlines` used `getBoundingClientRect()` (border-box origin) but absolutely positioned children use the padding-box origin. Missing `borderTopWidth`/`borderLeftWidth` offset caused a 1.5px error when `posParent` was `.jr-popup-response` (which has `border-top: 1.5px`).

11. ~~**Nested popup doesn't follow highlight on reopen.** After generating a chained response, closing just the chained popup, then clicking its highlight to reopen — the popup was fixed on the screen instead of scrolling with the parent. Closing and reopening the parent fully worked fine.~~ **FIXED** — chained highlight spans aren't inside an AI turn article, so `closest(S.aiTurn)` returned null and `contentContainer` defaulted to `document.body`. Fixed in three places: `resolveContentContainer` now checks for parent `.jr-popup` first and rejects `document.body` as cached value; `sendContentContainer` walks up to parent popup's container for chained highlights; entry's `contentContainer` is refreshed after positioning.
