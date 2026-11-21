// escape-guard.js — Esc meant for Popup never reaches the site (live 2026-11-19: Claude Code takes Esc Esc as "Rewind",
// and the Esc that closed a popup counted as the first). Loaded at document_start (manifest.json), so it runs before the
// site's own listeners; Popup's handlers get it as "jr-escape" (content.js, popup.js). Only while something of Popup's
// is up (a popup, its lightbox, the ask button).
window.addEventListener("keydown", function (e) {
  if (e.key !== "Escape" || e.isComposing) return;
  if (!document.querySelector(".jr-popup, .jr-lightbox, .jr-highlight-trigger-btn, .jr-site-overlay")) return;
  // the user is in something the site opened (its dialog, menu, editor — one of its controls used in a popup, live G4:
  // Esc closed the popup and left ChatGPT's Share panel / image editor open): the site's Esc
  var a = document.activeElement;
  if (a && a.closest && !a.closest(".jr-popup, .jr-lightbox") &&
      a.closest("[role=dialog], [role=alertdialog], [role=menu], [role=listbox], [aria-modal=true], [data-jr-site-opened]")) return;
  e.stopImmediatePropagation();
  e.preventDefault();
  var t = e.target && e.target.dispatchEvent ? e.target : document;
  t.dispatchEvent(new CustomEvent("jr-escape", { bubbles: true, composed: true }));
}, true);
