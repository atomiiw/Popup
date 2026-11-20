// popup.js — Unified popup creation (any depth, any mode)
(function () {
  "use strict";

  var st = JR.state;

  var CHEVRON_RIGHT_SVG = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M181.66,133.66l-80,80A8,8,0,0,1,88,208V48a8,8,0,0,1,13.66-5.66l80,80A8,8,0,0,1,181.66,133.66Z"/></svg>';

  var SWITCH_SVG = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M228,48V96a12,12,0,0,1-12,12H168a12,12,0,0,1,0-24h19l-7.8-7.8a75.55,75.55,0,0,0-53.32-22.26h-.43A75.49,75.49,0,0,0,72.39,75.57,12,12,0,1,1,55.61,58.41a99.38,99.38,0,0,1,69.87-28.47H126A99.42,99.42,0,0,1,196.2,59.23L204,67V48a12,12,0,0,1,24,0ZM183.61,180.43a75.49,75.49,0,0,1-53.09,21.63h-.43A75.55,75.55,0,0,1,76.77,179.8L69,172H88a12,12,0,0,0,0-24H40a12,12,0,0,0-12,12v48a12,12,0,0,0,24,0V189l7.8,7.8A99.42,99.42,0,0,0,130,226.06h.56a99.38,99.38,0,0,0,69.87-28.47,12,12,0,0,0-16.78-17.16Z"/></svg>';

  // --- Private helpers (not on JR.*) ---

  /**
   * Delegated click handler for links and images inside a response div.
   * Handles <a> tags (including those with dead React handlers), <button>
   * wrappers around images, and standalone <img> elements.
   */
  // ChatGPT entity links (spans with React handlers, e.g. open a side panel)
  var ENTITY_SELECTOR = JR.site.entitySelector;

  JR.wireResponseClicks = wireResponseClicks; // (tests)
  function wireResponseClicks(responseDiv) {
    if (responseDiv._jrClickWired) return;
    responseDiv._jrClickWired = true;
    responseDiv.addEventListener("click", function (e) {
      // --- Whatever the site handles — a control it drew (a code block's Run / Copy / wrap / Download, whatever it adds),
      // a button, ChatGPT's entity links: one rule (P0-7 #4), the site's own, clicked at the same place in the original
      // (design B); its result comes back through the copy. Not an image's button: Popup's lightbox (the site's viewer
      // would open in the unseen frame, review; a citation's favicon is no image of the answer; one not loaded yet: its
      // declared width, else an image — review) ---
      // (e.target is a shadow root's host for a control the site drew inside one — Claude Code's code blocks: the
      // control itself, from the event's path)
      var inner = e.composedPath()[0], from = inner && inner.nodeType === 1 && inner.closest ? inner : e.target;
      var siteEl = from.closest("button, [role=button]" + (ENTITY_SELECTOR ? ", " + ENTITY_SELECTOR : ""));
      if (!siteEl && from !== e.target) siteEl = e.target.closest("button, [role=button]" + (ENTITY_SELECTOR ? ", " + ENTITY_SELECTOR : ""));
      var inside = siteEl && (responseDiv.contains(siteEl) || (siteEl.getRootNode() !== document && responseDiv.contains(siteEl.getRootNode().host)));
      if (siteEl && (!inside || siteEl._jrReplyAnchor || siteEl.classList.contains("jr-reply-whole-btn"))) siteEl = null;
      var pic = siteEl && siteEl.querySelector("img");
      if (pic && pic.src && (pic.getBoundingClientRect().width || pic.width || 48) >= 48) {
        e.stopPropagation();
        openLightbox(responseDiv, [pic.src], 0);
        return;
      }
      if (siteEl) {
        e.preventDefault();
        e.stopPropagation();
        forwardToOriginal(siteEl, responseDiv);
        return;
      }

      // --- Regular <a> links ---
      var a = e.target.closest("a");
      if (a && responseDiv.contains(a)) {
        var href = a.getAttribute("href") || a.dataset.href || a.href || "";
        if (href === window.location.href || href === window.location.href + "#") href = "";
        if (href && href !== "#" && href.indexOf("javascript:") !== 0) {
          e.preventDefault();
          e.stopPropagation();
          window.open(href, "_blank", "noopener,noreferrer");
          return;
        }
      }

      // --- Lightbox images ---
      var img = e.target.closest("img");
      if (img && img.src) {
        if (img.closest(".jr-gallery")) return;
        e.stopPropagation();
        openLightbox(responseDiv, [img.src], 0);
        return;
      }
    });
  }

  /**
   * A click on something of the site's in a copy, on the same element of the original. Its original still being found
   * (a parent active again after its child closed — live B6: the click went nowhere): there once it is, for up to 4 s
   * (the site's Copy needs the click's activation: 5 s). An original in the render frame: the site's Copy writes the
   * clipboard only from a focused document (live 2026-11-18: ChatGPT's Copy in a popup copied nothing) — the frame has
   * it for the click, then the page again.
   */
  function forwardToOriginal(el, responseDiv) {
    (function forward(tries) {
      var o = JR.siteAnswer && JR.siteAnswer.current() === responseDiv && JR.siteAnswer.counterpart(el);
      if (!o) {
        if (tries > 0 && JR.siteAnswer && JR.siteAnswer.current() === responseDiv) setTimeout(function () { forward(tries - 1); }, 100);
        return;
      }
      var w = o.ownerDocument.defaultView;
      if (w && w !== window) {
        if (JR.siteOriginalFocus) JR.siteOriginalFocus(500);
        // the control itself, not the frame's own focused composer: a key meanwhile goes nowhere (review)
        try { o.focus({ preventScroll: true }); } catch (er) {}
        var fd = o.ownerDocument;
        if (fd.activeElement !== o) { try { w.focus(); if (fd.activeElement && fd.activeElement !== fd.body) fd.activeElement.blur(); } catch (er) {} }
      }
      o.click();
    })(40);
  }


  /**
   * Post-process cloned links: ensure all <a> tags have target, rel,
   * cursor, and proper href. Remove dead ChatGPT buttons that lost handlers.
   */
  function processResponseLinks(responseDiv) {
    var links = responseDiv.querySelectorAll("a");
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var href = a.getAttribute("href") || "";
      // If no href, check if the link text itself is a URL
      if (!href || href === "#") {
        var text = (a.textContent || "").trim();
        if (/^https?:\/\//i.test(text)) {
          a.setAttribute("href", text);
          href = text;
        }
      }
      // Ensure links open in new tab
      if (href && href !== "#") {
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
      }
    }
  }

  /**
   * Detect image containers in cloned response HTML, make all images
   * visible (overriding ChatGPT's overflow/carousel CSS), and build
   * a clickable gallery with lightbox navigation.
   *
   * [CAROUSEL-LOCKED] — All carousel/gallery/lightbox code below through
   * openLightbox() is finalized. Do not modify without explicit permission.
   */
  function isContentImage(img) { // [CAROUSEL-LOCKED]
    // Skip images inside anchor tags that also contain text (favicons/icons)
    var parentA = img.closest("a");
    if (parentA && (parentA.textContent || "").trim().length > 0) return false;
    // Skip explicitly tiny images
    var w = img.naturalWidth || img.width || parseInt(img.getAttribute("width")) || 0;
    var h = img.naturalHeight || img.height || parseInt(img.getAttribute("height")) || 0;
    if ((w > 0 && w < 48) || (h > 0 && h < 48)) return false;
    // Skip SVG data URIs (usually icons)
    var src = img.src || "";
    if (src.indexOf("data:image/svg") === 0) return false;
    return true;
  }

  var GALLERY_VISIBLE = 3; // [CAROUSEL-LOCKED] show 3 thumbnails, like ChatGPT

  function processResponseImages(responseDiv) { // [CAROUSEL-LOCKED]
    var allImgs = responseDiv.querySelectorAll("img");
    if (!allImgs.length) return;

    // Filter to content images only
    var contentImgs = [];
    var seenSrc = {};
    for (var i = 0; i < allImgs.length; i++) {
      var src = allImgs[i].src || allImgs[i].dataset.src || "";
      if (!src || !isContentImage(allImgs[i])) continue;
      if (!seenSrc[src]) {
        seenSrc[src] = true;
        contentImgs.push(allImgs[i]);
      }
    }

    if (contentImgs.length < 2) return;

    // Group images by their nearest shared container.
    // Two images belong to the same group if their LCA is NOT responseDiv.
    var groups = []; // each: { container: Element, imgs: [img], srcs: [string] }

    for (var ci = 0; ci < contentImgs.length; ci++) {
      var img = contentImgs[ci];
      var src = img.src || img.dataset.src;
      var placed = false;
      for (var g = 0; g < groups.length; g++) {
        var lca = findLCA(groups[g].imgs[0], img, responseDiv);
        if (lca && lca !== responseDiv) {
          groups[g].container = lca;
          groups[g].imgs.push(img);
          groups[g].srcs.push(src);
          placed = true;
          break;
        }
      }
      if (!placed) {
        groups.push({ container: null, imgs: [img], srcs: [src] });
      }
    }

    // Process each group with 2+ images
    for (var gi = 0; gi < groups.length; gi++) {
      var group = groups[gi];
      if (group.imgs.length < 2) continue;

      // Re-derive the container as the LCA of first two images in the group
      var galleryParent = findLCA(group.imgs[0], group.imgs[1], responseDiv);
      if (!galleryParent || galleryParent === responseDiv) continue;

      // Only replace if the container looks like a pure image grid (minimal text)
      var containerText = (galleryParent.textContent || "").replace(/\s+/g, "").trim();
      if (containerText.length > 50) continue;

      buildGallery(responseDiv, galleryParent, group.srcs);
    }
  }

  /**
   * Find lowest common ancestor of two nodes, stopping at stopAt.  [CAROUSEL-LOCKED]
   */
  function findLCA(a, b, stopAt) { // [CAROUSEL-LOCKED]
    var ancestors = new Set();
    var node = a;
    while (node && node !== stopAt) { ancestors.add(node); node = node.parentElement; }
    node = b;
    while (node && node !== stopAt) {
      if (ancestors.has(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  /**
   * Replace a gallery container with a collapsed 3-thumb gallery + lightbox.  [CAROUSEL-LOCKED]
   */
  function buildGallery(responseDiv, galleryParent, allSrcs) {
    var gallery = document.createElement("div");
    gallery.className = "jr-gallery";

    var showCount = Math.min(allSrcs.length, GALLERY_VISIBLE);
    var extra = allSrcs.length - showCount;

    for (var gi = 0; gi < showCount; gi++) {
      var thumb = document.createElement("div");
      thumb.className = "jr-gallery-thumb";
      thumb.dataset.index = gi;
      var imgEl = document.createElement("img");
      imgEl.src = allSrcs[gi];
      imgEl.loading = "lazy";
      thumb.appendChild(imgEl);
      if (gi === showCount - 1 && extra > 0) {
        var badge = document.createElement("div");
        badge.className = "jr-gallery-badge";
        badge.textContent = "+" + extra;
        thumb.appendChild(badge);
      }
      gallery.appendChild(thumb);
    }

    gallery.addEventListener("click", function (e) {
      e.stopPropagation();
      var thumbEl = e.target.closest(".jr-gallery-thumb");
      var startIdx = thumbEl ? (parseInt(thumbEl.dataset.index) || 0) : 0;
      openLightbox(responseDiv, allSrcs, startIdx);
    });

    galleryParent.parentElement.insertBefore(gallery, galleryParent);
    galleryParent.remove();
  }

  /**
   * Open a lightbox overlay showing an image with left/right navigation.  [CAROUSEL-LOCKED]
   */
  function openLightbox(responseDiv, srcs, startIndex) { // [CAROUSEL-LOCKED]
    // Remove existing lightbox if any
    var existing = document.querySelector(".jr-lightbox");
    if (existing) existing.remove();

    var currentIdx = startIndex;

    var overlay = document.createElement("div");
    overlay.className = "jr-lightbox";

    var img = document.createElement("img");
    img.className = "jr-lightbox-img";
    img.src = srcs[currentIdx];
    overlay.appendChild(img);

    // Navigation arrows (only if multiple images)
    var prevBtn, nextBtn, counter;
    if (srcs.length > 1) {
      prevBtn = document.createElement("button");
      prevBtn.className = "jr-lightbox-prev";
      prevBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
      overlay.appendChild(prevBtn);

      nextBtn = document.createElement("button");
      nextBtn.className = "jr-lightbox-next";
      nextBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg>';
      overlay.appendChild(nextBtn);

      counter = document.createElement("div");
      counter.className = "jr-lightbox-counter";
      overlay.appendChild(counter);
    }

    // Close button
    var closeBtn = document.createElement("button");
    closeBtn.className = "jr-lightbox-close";
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    overlay.appendChild(closeBtn);

    document.body.appendChild(overlay);

    function update() {
      img.src = srcs[currentIdx];
      if (counter) counter.textContent = (currentIdx + 1) + " / " + srcs.length;
      if (prevBtn) prevBtn.style.visibility = currentIdx === 0 ? "hidden" : "visible";
      if (nextBtn) nextBtn.style.visibility = currentIdx === srcs.length - 1 ? "hidden" : "visible";
    }
    update();

    function close() {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("jr-escape", onKey, true);
      document.removeEventListener("mousedown", onBlock, true);
    }

    function onKey(e) {
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (e.type === "jr-escape") { close(); return; } // (Esc, kept from the site: early-hide.js)
      if (e.key === "ArrowLeft" && currentIdx > 0) { currentIdx--; update(); }
      if (e.key === "ArrowRight" && currentIdx < srcs.length - 1) { currentIdx++; update(); }
    }

    // Block mousedown from reaching the popup's outside-click handler
    function onBlock(e) {
      if (overlay.isConnected) { e.stopPropagation(); e.stopImmediatePropagation(); }
    }

    document.addEventListener("keydown", onKey, true);
    document.addEventListener("jr-escape", onKey, true);
    document.addEventListener("mousedown", onBlock, true);
    overlay.addEventListener("click", function (e) {
      e.stopPropagation();
      if (e.target === overlay) close();
    });
    closeBtn.addEventListener("click", function (e) { e.stopPropagation(); close(); });
    if (prevBtn) prevBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (currentIdx > 0) { currentIdx--; update(); }
    });
    if (nextBtn) nextBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (currentIdx < srcs.length - 1) { currentIdx++; update(); }
    });
  }

  function resolveContentContainer(wrappers, isChained, entry) {
    if (entry) {
      // For chained highlights, spans live inside a parent popup's response div,
      // not an AI turn article. Derive container from the parent popup.
      if (entry.spans && entry.spans[0]) {
        var parentPopup = entry.spans[0].closest(".jr-popup");
        if (parentPopup && parentPopup.parentElement && parentPopup.parentElement.isConnected) {
          entry.contentContainer = parentPopup.parentElement;
          return parentPopup.parentElement;
        }
      }
      var cc = entry.contentContainer;
      if (cc && cc !== document.body && cc.isConnected) return cc;
      var span0 = entry.spans[0] && entry.spans[0].isConnected ? entry.spans[0] : null;
      return JR.site.popupHost(span0 ? JR.site.turnOf(span0) : null);
    }
    if (isChained) {
      var parentPopupEl = st.popupStack.length > 0 ? st.popupStack[st.popupStack.length - 1].popup : null;
      return parentPopupEl ? parentPopupEl.parentElement : document.body;
    }
    // Level-1 popups live in a host above ChatGPT's virtualized turn slots, so
    // they survive the turn being scrolled out and rebuilt.
    return JR.site.popupHost(wrappers.length > 0 ? JR.site.turnOf(wrappers[0]) : null);
  }

  function attachScrollTracking(popup, spans, contentContainer) {
    if (spans.length === 0) return;
    var parentRespDiv = spans[0].closest(".jr-popup-response");
    if (!parentRespDiv) return;
    // Lock parent popup's scroll while chained popup is open
    var savedOverflow = parentRespDiv.style.overflow;
    parentRespDiv.style.overflow = "hidden";
    popup._jrScrollCleanup = function () {
      parentRespDiv.style.overflow = savedOverflow;
    };
  }

  /** Populate a mode dropdown with Medium/Concise items. */
  function populateModeDropdown(dropdown, onSelect) {
    dropdown.innerHTML = "";
    var modes = [
      { key: "medium", label: "Detailed" },
      { key: "concise", label: "Concise" }
    ];
    for (var mi = 0; mi < modes.length; mi++) {
      (function (m) {
        var item = document.createElement("div");
        item.className = "jr-send-mode-item";
        if (m.key === st.responseMode) item.classList.add("jr-send-mode-item--active");
        item.textContent = m.label;
        item.addEventListener("click", function (e) {
          e.stopPropagation();
          onSelect(m.key);
        });
        dropdown.appendChild(item);
      })(modes[mi]);
    }
  }

  function buildInputRow(container, text, sentence, blockTypes, wrappers, parentId, wholeResponse, wholeResponseFull) {
    var popup = container.closest(".jr-popup");
    var questionDiv = document.createElement("div");
    questionDiv.className = "jr-popup-question";

    var inputInner = document.createElement("div");
    inputInner.className = "jr-popup-question-inner";

    var inputChevron = document.createElement("span");
    inputChevron.className = "jr-popup-question-chevron";
    inputChevron.innerHTML = CHEVRON_RIGHT_SVG;
    inputInner.appendChild(inputChevron);

    var questionText = document.createElement("span");
    questionText.className = "jr-popup-question-text";
    questionText.contentEditable = "true";
    questionText.setAttribute("data-placeholder", "Follow up\u2026");
    questionText.addEventListener("paste", function (e) {
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, text);
    });
    inputInner.appendChild(questionText);
    questionDiv.appendChild(inputInner);
    var attach = JR.acceptAttachments(questionDiv, questionText, null); // Step 2: files above the text

    // Send wrapper with click-to-send + switch mode button
    var sendWrapper = document.createElement("div");
    sendWrapper.className = "jr-edit-send-wrapper";

    var sendBtn = document.createElement("button");
    sendBtn.type = "button";
    sendBtn.className = "jr-popup-edit-send";
    sendBtn.setAttribute("aria-label", "Send question");
    sendBtn.innerHTML = SEND_SVG;
    sendBtn.disabled = true;
    sendWrapper.appendChild(sendBtn);

    var dropdown = document.createElement("div");
    dropdown.className = "jr-send-mode-dropdown jr-disabled";
    function rebuildDropdown() {
      populateModeDropdown(dropdown, function (key) {
        var current = readQuestion(questionText);
        if (!current) return;
        doSend(key);
      });
    }
    rebuildDropdown();
    sendWrapper.appendChild(dropdown);
    questionDiv.appendChild(sendWrapper);
    JR.askArea(container).appendChild(questionDiv);

    function doSend(mode) {
      var question = readQuestion(questionText);
      if (!question) return;
      if (extensionWasUpdated(popup)) return;
      if (JR.blockedByComposerAttachments(questionDiv)) return; // text and attachments stay

      st.responseMode = mode;

      var message = JR.buildMessage({
        question: question, text: text, sentence: sentence,
        wholeResponse: !!wholeResponse, wholeResponseFull: wholeResponseFull, mode: mode,
      });

      questionDiv.remove();
      // Re-add as non-editable question display
      var displayDiv = document.createElement("div");
      displayDiv.className = "jr-popup-question";
      var displayInner = document.createElement("div");
      displayInner.className = "jr-popup-question-inner";
      var displayChevron = document.createElement("span");
      displayChevron.className = "jr-popup-question-chevron";
      displayChevron.innerHTML = CHEVRON_RIGHT_SVG;
      displayInner.appendChild(displayChevron);
      var displayText = document.createElement("span");
      displayText.className = "jr-popup-question-text";
      displayText.textContent = question;
      displayInner.appendChild(displayText);
      var files = attach.files();
      attach.remove(); // frees the input strip's previews (the input row goes away)
      var sentStrip = files.length ? JR.attachmentStrip(files) : null;
      displayDiv.appendChild(displayInner);
      var loadingDiv = JR.createLoadingDiv();
      JR.askArea(container).appendChild(displayDiv);
      if (sentStrip) JR.placeStripAbove(sentStrip, displayDiv);
      popup.appendChild(loadingDiv);

      // Register highlight immediately so it persists even if popup is dismissed
      var sendHlId = crypto.randomUUID();
      var sendItemId = crypto.randomUUID();
      var sourceTurn = wrappers.length > 0 ? JR.site.turnOf(wrappers[0]) : null;
      var sourceTurnKey = sourceTurn ? JR.site.turnKey(sourceTurn) : null;
      var sendContentContainer;
      if (sourceTurn) {
        sendContentContainer = JR.site.popupHost(sourceTurn);
      } else if (parentId && wrappers.length > 0) {
        // Chained highlight: spans are inside a parent popup, not an AI turn
        var parentPopupEl = wrappers[0].closest(".jr-popup");
        sendContentContainer = (parentPopupEl && parentPopupEl.parentElement) || popup.parentElement || document.body;
      } else {
        sendContentContainer = popup.parentElement || document.body;
      }

      // Resolve parent's active item id so children are version-specific
      var sendParentItemId = null;
      if (parentId) {
        var pEntry = st.completedHighlights.get(parentId);
        if (pEntry && pEntry.items && pEntry.items.length > 0) {
          var pIdx = pEntry.activeItemIndex != null ? pEntry.activeItemIndex : 0;
          sendParentItemId = pEntry.items[pIdx] ? pEntry.items[pIdx].id : null;
        }
      }

      for (var si = 0; si < wrappers.length; si++) {
        wrappers[si].setAttribute("data-jr-highlight-id", sendHlId);
        wrappers[si].classList.add("jr-source-highlight-done");
      }

      // Which occurrence of the text this is, inside the answer it was selected in.
      var nth = 0;
      if (wrappers.length && JR.spanTextNode(wrappers[0])) {
        var nthRoot = wrappers[0].closest(".jr-popup-response")
          || (sourceTurn && JR.site.assistantBodies(sourceTurn).filter(function (b) { return b.contains(wrappers[0]); })[0]);
        nth = JR.occurrenceIndex(nthRoot, JR.spanTextNode(wrappers[0]), text);
      }

      var pendingEntry = {
        quoteId: sendHlId,
        spans: wrappers.slice(),
        text: text,
        nth: nth,
        sentence: sentence,
        blockTypes: blockTypes,
        question: question,
        contentContainer: sendContentContainer,
        parentId: parentId || null,
        parentItemId: sendParentItemId,
        sourceTurnKey: sourceTurnKey,
        items: [{ id: sendItemId, question: question, status: "pending", turnKeys: [] }],
        activeItemIndex: 0,
        wholeResponse: !!wholeResponse,
      };
      // The unsent placeholder entry (temp-…) is replaced by this one.
      var tempEntry = st.completedHighlights.get(st.activeHighlightId);
      if (tempEntry && tempEntry._jrTemp) st.completedHighlights.delete(st.activeHighlightId);
      st.completedHighlights.set(sendHlId, pendingEntry);
      st.activeHighlightId = sendHlId;

      saveHighlight({
        id: sendItemId,
        quoteId: sendHlId,
        text: text,
        nth: nth,
        sentence: sentence,
        blockTypes: blockTypes,
        status: "pending",
        question: question,
        url: location.href,
        parentId: parentId || null,
        parentItemId: sendParentItemId,
        sourceTurnKey: sourceTurnKey,
        turnKeys: [],
        wholeResponse: !!wholeResponse,
        attachments: attach.files().length,
      });

      JR.updateNavWidget();

      var waitOpts = {
        popup: popup, text: text, sentence: sentence,
        blockTypes: blockTypes, parentId: parentId, question: question,
        wholeResponse: !!wholeResponse, wholeResponseFull: wholeResponseFull,
        preRegisteredHlId: sendHlId, preRegisteredItemId: sendItemId
      };

      if (files.length) pendingEntry.items[0]._files = files; // memory only: a retry can resend them
      JR.enqueueMessage({
        message: message,
        waitOpts: waitOpts,
        files: files,
        onAttached: function (res) { // the strip shows what really went out
          if (sentStrip) { JR.releaseStrip(sentStrip); sentStrip.replaceWith(res.sent.length ? (sentStrip = JR.attachmentStrip(res.sent)) : document.createComment("")); }
          JR.showAttachmentNote(displayDiv, res.failed);
          pendingEntry.items[0]._files = res.sent;
          pendingEntry.items[0]._failedFiles = res.failed;
          pendingEntry.items[0].attachments = res.sent.length;
          updateHighlightFields(sendItemId, { attachments: res.sent.length }, location.href);
        },
      });
    }

    // Click send arrow → send with current default mode
    sendBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var current = readQuestion(questionText);
      if (!current) return;
      doSend(st.responseMode);
    });

    // Track input to enable/disable send + dropdown
    questionText.addEventListener("input", function () {
      var current = readQuestion(questionText);
      if (!current && questionText.innerHTML !== "") {
        questionText.innerHTML = "";
      }
      var empty = !current;
      sendBtn.disabled = empty;
      if (empty) {
        dropdown.classList.add("jr-disabled");
      } else {
        dropdown.classList.remove("jr-disabled");
      }
    });

    // Enter sends, Cmd/Ctrl+Enter inserts newline
    questionText.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        // Ignore Enter while an IME composition is active (e.g. Chinese/Japanese/Korean input)
        if (e.isComposing || e.keyCode === 229) return;
        if (e.metaKey || e.ctrlKey) {
          document.execCommand("insertLineBreak");
          e.preventDefault();
        } else {
          e.preventDefault();
          var current = readQuestion(questionText);
          if (current) doSend(st.responseMode);
        }
      }
    });

    // Do NOT auto-focus — let the user Cmd+C the native selection first.
    // Clicking the input clears the native selection and focuses for typing.
    questionText.addEventListener("mousedown", function () {
      var sel = window.getSelection();
      if (sel && !sel.isCollapsed) sel.removeAllRanges();
    });
  }

  var PENCIL_SVG = '<svg class="jr-icon-reg" viewBox="0 0 256 256" fill="currentColor"><path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z"/></svg><svg class="jr-icon-bold" viewBox="0 0 256 256" fill="currentColor"><path d="M230.14,70.54,185.46,25.85a20,20,0,0,0-28.29,0L33.86,149.17A19.85,19.85,0,0,0,28,163.31V208a20,20,0,0,0,20,20H92.69a19.86,19.86,0,0,0,14.14-5.86L230.14,98.82a20,20,0,0,0,0-28.28ZM91,204H52V165l84-84,39,39ZM192,103,153,64l18.34-18.34,39,39Z"/></svg>';

  var TRASH_SVG = '<svg class="jr-icon-reg" viewBox="0 0 256 256" fill="currentColor"><path d="M216,48H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM192,208H64V64H192ZM80,24a8,8,0,0,1,8-8h80a8,8,0,0,1,0,16H88A8,8,0,0,1,80,24Z"/></svg><svg class="jr-icon-bold" viewBox="0 0 256 256" fill="currentColor"><path d="M216,48H40a12,12,0,0,0,0,24h4V208a20,20,0,0,0,20,20H192a20,20,0,0,0,20-20V72h4a12,12,0,0,0,0-24ZM188,204H68V72H188ZM76,20A12,12,0,0,1,88,8h80a12,12,0,0,1,0,24H88A12,12,0,0,1,76,20Z"/></svg>';


  function showDeleteConfirmation(hlId, entry, own) {
    // The trash of a popup with popups open inside it: those close, and it asks on its own popup (user, 2026-11-18:
    // it asked on the newest one). (The trash stops its mousedown, so the popup's own close-to-this-level doesn't run.)
    while (own && st.activePopup && st.activePopup !== own && st.popupStack.length > 0) JR.removePopup();
    if (!st.activePopup) return;
    var popup = st.activePopup;

    st.confirmingDelete = true;
    JR.updateNavDisabled();
    if (JR.removeTriggerBtn) JR.removeTriggerBtn();

    // Build confirm card inside the popup (after counting descendants)
    countDescendants(hlId).then(function (count) {
      // Save popup children so we can restore on cancel
      var arrowEl = popup.querySelector(".jr-popup-arrow");
      var arrowClone = arrowEl ? arrowEl.cloneNode(true) : null;
      var savedChildren = [];
      while (popup.firstChild) {
        savedChildren.push(popup.removeChild(popup.firstChild));
      }
      if (arrowClone) popup.appendChild(arrowClone);
      var confirmCard = document.createElement("div");
      confirmCard.className = "jr-popup-delete-confirm";

      var text = document.createElement("div");
      text.className = "jr-popup-confirm-text";
      if (count === 0) {
        text.textContent = "Delete this highlight?";
      } else {
        text.textContent = "Delete this and " + count + " nested follow-up" + (count === 1 ? "" : "s") + "?";
      }

      var cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "jr-popup-confirm-icon-btn";
      cancelBtn.setAttribute("aria-label", "Cancel delete");
      cancelBtn.innerHTML = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z"/></svg>';
      cancelBtn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        st.confirmingDelete = false;
        JR.updateNavDisabled();
        // Restore popup content — keep current left, only adjust top for "above" popups
        var savedLeft = popup.style.left;
        while (popup.firstChild) popup.removeChild(popup.firstChild);
        for (var ri = 0; ri < savedChildren.length; ri++) {
          popup.appendChild(savedChildren[ri]);
        }
        popup.style.left = savedLeft;
        var dir = popup._jrLockedDirection;
        if (dir === "above" && st.activeSourceHighlights.length > 0 && popup.parentElement) {
          var hRect = JR.getHighlightRect(st.activeSourceHighlights);
          var cRect = popup.parentElement.getBoundingClientRect();
          popup.style.top = (hRect.top - cRect.top - popup.offsetHeight - 8) + "px";
        }
      });

      var deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "jr-popup-confirm-icon-btn jr-popup-confirm-icon-btn--danger";
      deleteBtn.setAttribute("aria-label", "Confirm delete");
      deleteBtn.innerHTML = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M232.49,80.49l-128,128a12,12,0,0,1-17,0l-56-56a12,12,0,1,1,17-17L96,183,215.51,63.51a12,12,0,0,1,17,17Z"/></svg>';
      deleteBtn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        st.confirmingDelete = false;
        executeDelete(hlId);
      });

      confirmCard.appendChild(text);
      confirmCard.appendChild(cancelBtn);
      confirmCard.appendChild(deleteBtn);

      popup.appendChild(confirmCard);
      // Keep horizontal position — only adjust top for "above" popups
      var dir = popup._jrLockedDirection;
      if (dir === "above" && st.activeSourceHighlights.length > 0 && popup.parentElement) {
        var hRect = JR.getHighlightRect(st.activeSourceHighlights);
        var cRect = popup.parentElement.getBoundingClientRect();
        var gap = 8;
        popup.style.top = (hRect.top - cRect.top - popup.offsetHeight - gap) + "px";
      }
    });
  }

  function executeDelete(hlId) {
    st.confirmingDelete = false;
    var quoteIdsToDelete = [];
    function walkDescendants(parentQuoteId) {
      quoteIdsToDelete.push(parentQuoteId);
      st.completedHighlights.forEach(function (entry, qid) {
        if (entry.parentId === parentQuoteId) {
          walkDescendants(qid);
        }
      });
    }
    walkDescendants(hlId);

    // Unwrap spans and drop the entries. deleteHighlight() keeps their Q&A
    // turn keys in the conversation's hidden list so those turns stay hidden.
    for (var i = 0; i < quoteIdsToDelete.length; i++) {
      var qid = quoteIdsToDelete[i];
      var entry = st.completedHighlights.get(qid);
      if (!entry) continue;

      // Unwrap highlight spans
      if (entry.spans) {
        for (var s = 0; s < entry.spans.length; s++) {
          JR.unwrapHighlight(entry.spans[s]);
        }
      }

      st.completedHighlights.delete(qid);
    }

    deleteHighlight(hlId);

    // If there's a parent popup on the stack, just peel back to it;
    // otherwise close everything
    if (st.popupStack.length > 0) {
      JR.removePopup();
    } else {
      JR.removeAllPopups();
    }
    JR.updateNavWidget();
  }

  function buildVersionNavInline(container, hlId) {
    var popup = container.closest(".jr-popup");
    var entry = st.completedHighlights.get(hlId);
    if (!entry || !entry.items || entry.items.length <= 1) return null;

    var nav = document.createElement("div");
    nav.className = "jr-popup-version-nav";

    var prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "jr-popup-version-prev";
    prevBtn.setAttribute("aria-label", "Previous version");
    prevBtn.innerHTML = '<svg class="jr-icon-reg" viewBox="0 0 256 256" fill="currentColor"><path d="M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z"/></svg><svg class="jr-icon-bold" viewBox="0 0 256 256" fill="currentColor"><path d="M168.49,199.51a12,12,0,0,1-17,17l-80-80a12,12,0,0,1,0-17l80-80a12,12,0,0,1,17,17L97,128Z"/></svg>';

    var nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "jr-popup-version-next";
    nextBtn.setAttribute("aria-label", "Next version");
    nextBtn.innerHTML = '<svg class="jr-icon-reg" viewBox="0 0 256 256" fill="currentColor"><path d="M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z"/></svg><svg class="jr-icon-bold" viewBox="0 0 256 256" fill="currentColor"><path d="M184.49,136.49l-80,80a12,12,0,0,1-17-17L159,128,87.51,56.49a12,12,0,1,1,17-17l80,80A12,12,0,0,1,184.49,136.49Z"/></svg>';

    nav.appendChild(prevBtn);
    nav.appendChild(nextBtn);

    function updateNav() {
      var idx = entry.activeItemIndex != null ? entry.activeItemIndex : entry.items.length - 1;
      prevBtn.disabled = (idx === 0);
      nextBtn.disabled = (idx === entry.items.length - 1);
    }

    function switchVersion(newIdx) {
      if (JR.removeTriggerBtn) JR.removeTriggerBtn();
      entry.activeItemIndex = newIdx;
      var v = entry.items[newIdx];
      entry.question = v.question;
      setActiveItem(hlId, v.id);

      // Update question text and its attachments
      var qText = container.querySelector(".jr-popup-question-text");
      if (qText) qText.textContent = v.question || "";
      var qRow = container.querySelector(".jr-popup-question");
      if (qRow) JR.showSentAttachments(qRow, v);

      showAnswer(popup, hlId, entry, v, entry.contentContainer); // each version has its own state

      updateNav();

      // Only update arrow — don't recalculate left/top which would
      // reset any user resize/position adjustments.
      if (st.activeSourceHighlights.length > 0 && popup.parentElement) {
        var rect = JR.getHighlightRect(st.activeSourceHighlights);
        var cRect = popup.parentElement.getBoundingClientRect();
        var left = parseFloat(popup.style.left) || 0;
        JR.updateArrow(popup, rect, cRect, left);
      }
    }

    prevBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var idx = entry.activeItemIndex != null ? entry.activeItemIndex : entry.items.length - 1;
      if (idx > 0) switchVersion(idx - 1);
    });

    nextBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var idx = entry.activeItemIndex != null ? entry.activeItemIndex : entry.items.length - 1;
      if (idx < entry.items.length - 1) switchVersion(idx + 1);
    });

    updateNav();

    return nav;
  }

  function restoreChainedHighlights(responseDiv, parentQuoteId, contentContainer, activeParentItemId) {
    // Restore from in-memory entries — only children belonging to this version
    st.completedHighlights.forEach(function (chEntry, chQuoteId) {
      if (chEntry._jrTemp) return; // skip in-progress (unsent) highlights
      if (chEntry.parentId !== parentQuoteId) return;
      if (activeParentItemId && chEntry.parentItemId !== activeParentItemId) return;
      if (chEntry.wholeResponse) return; // reply-to-all: opened via reply button, not text-matched
      JR.restoreHighlightInElement(responseDiv, {
        quoteId: chQuoteId, text: chEntry.text, nth: chEntry.nth,
        sentence: chEntry.sentence, blockTypes: chEntry.blockTypes, question: chEntry.question,
        parentId: chEntry.parentId, parentItemId: chEntry.parentItemId,
        items: chEntry.items, activeItemIndex: chEntry.activeItemIndex,
      }, contentContainer);
    });
    // Also check storage for children not yet in memory (after a reload): all versions, so edits keep their arrows —
    // until each is (then they come from memory: this runs on every patch of a followed copy)
    var storeKey = parentQuoteId + "/" + activeParentItemId;
    if (responseDiv._jrStoredChildrenIn === storeKey) return;
    getChildHighlights(parentQuoteId, activeParentItemId).then(function (records) {
      var map = JR.groupByQuote(records), all = true;
      Object.keys(map).forEach(function (childKey) {
        var child = map[childKey];
        if (child.wholeResponse) {
          // Reply-to-all: add to memory without text-matching, opened via reply button
          if (!st.completedHighlights.has(childKey)) {
            st.completedHighlights.set(childKey, {
              quoteId: childKey,
              spans: [],
              text: child.text,
              sentence: child.sentence,
              blockTypes: null,
              question: child.question || null,
              contentContainer: contentContainer,
              parentId: child.parentId || null,
              parentItemId: child.parentItemId || null,
              items: child.items,
              activeItemIndex: child.activeItemIndex,
              wholeResponse: true,
            });
          }
          return;
        }
        if (responseDiv.querySelector('[data-jr-highlight-id="' + childKey + '"]')) return;
        if (!JR.restoreHighlightInElement(responseDiv, child, contentContainer)) all = false;
      });
      if (all) responseDiv._jrStoredChildrenIn = storeKey;
    });
  }

  /**
   * After Chrome updates or reloads the extension, this page's copy of Popup
   * can no longer save anything (chrome.storage is gone until a reload). Say so
   * instead of sending a question whose highlight would silently not be kept.
   */
  function extensionWasUpdated(popup) {
    if (isContextValid()) return false;
    if (!popup.querySelector(".jr-popup-stale")) {
      var note = document.createElement("div");
      note.className = "jr-popup-loading jr-popup-stale";
      note.textContent = "Popup was updated. Refresh the page to keep asking.";
      popup.appendChild(note);
    }
    return true;
  }

  /**
   * The question typed in a popup input. innerText keeps line breaks (Cmd+Enter,
   * pasted paragraphs) that textContent drops; blank lines are collapsed because
   * JR.parsePopupMessage splits the sent message on them.
   */
  function readQuestion(el) {
    return (el.innerText || "").replace(/\r/g, "").replace(/[ \t\u00a0]+\n/g, "\n").replace(/\n{2,}/g, "\n").trim();
  }

  var SEND_SVG = '<svg class="jr-icon-reg" viewBox="0 0 256 256" fill="currentColor"><path d="M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,136H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z"/></svg><svg class="jr-icon-bold" viewBox="0 0 256 256" fill="currentColor"><path d="M224.49,136.49l-72,72a12,12,0,0,1-17-17L187,140H40a12,12,0,0,1,0-24H187L135.51,64.48a12,12,0,0,1,17-17l72,72A12,12,0,0,1,224.49,136.49Z"/></svg>';

  function submitEdit(popup, hlId, entry, contentContainer, newQuestion, mode, files) {
    files = files || [];
    if (JR.blockedByComposerAttachments(popup.querySelector(".jr-popup-question"))) return false; // still editing
    entry._editFiles = files; // the new version's files (chat.js stores their count with it)
    entry._editFailed = null;
    if (extensionWasUpdated(popup)) return;
    // Exit edit mode, enter generating state
    popup.classList.add("jr-popup--generating");
    var questionDiv = popup.querySelector(".jr-popup-question");
    if (questionDiv) questionDiv.classList.remove("jr-popup-question--editing");
    var questionText = popup.querySelector(".jr-popup-question-text");
    if (questionText) {
      questionText.contentEditable = "false";
      questionText.textContent = newQuestion;
    }
    // The input strip becomes the sent question's strip (read-only)
    if (questionDiv && questionDiv._jrSentStrip) { JR.releaseStrip(questionDiv._jrSentStrip); questionDiv._jrSentStrip.remove(); questionDiv._jrSentStrip = null; }
    var oldStrip = JR.stripAbove(questionDiv);
    var sentStrip = files.length ? JR.attachmentStrip(files) : null;
    if (oldStrip) { JR.releaseStrip(oldStrip); oldStrip.replaceWith(sentStrip || document.createComment("")); }

    // Remove response, show loading
    var responseDiv = popup.querySelector(".jr-popup-response");
    if (responseDiv) responseDiv.remove();
    var oldLoading = popup.querySelector(".jr-popup-loading");
    if (oldLoading) oldLoading.remove();

    popup.appendChild(JR.createLoadingDiv());
    JR.repositionPopup();

    // Build injection message
    var text = entry.text;
    var sentence = entry.sentence;
    var message = JR.buildMessage({
      question: newQuestion, text: text, sentence: sentence,
      wholeResponse: !!entry.wholeResponse, mode: mode || "medium",
    });

    var waitOpts = {
      popup: popup, text: text, sentence: sentence,
      blockTypes: entry.blockTypes, parentId: entry.parentId,
      question: newQuestion, editOpts: { hlId: hlId }
    };

    JR.enqueueMessage({
      message: message,
      waitOpts: waitOpts,
      files: files,
      onAttached: function (res) {
        if (sentStrip) { JR.releaseStrip(sentStrip); sentStrip.replaceWith(res.sent.length ? (sentStrip = JR.attachmentStrip(res.sent)) : document.createComment("")); }
        if (questionDiv) JR.showAttachmentNote(questionDiv, res.failed);
        entry._editFiles = res.sent;
        entry._editFailed = res.failed;
      },
    });
  }

  function showCompletedResponse(popup, upper, id, entry, contentContainer) {
    // Land on the version the user last viewed (stored as the active item;
    // a finished edit makes the new version active).
    if (entry.items && entry.items.length > 0) {
      var idx = entry.activeItemIndex;
      if (idx == null || idx < 0 || idx >= entry.items.length) idx = entry.items.length - 1;
      entry.activeItemIndex = idx;
      var item = entry.items[idx];
      // A stale pending one failed (no watch running after reload/reopen)
      if (item.status === "pending" && !st.responseWatchActive) {
        item.status = "failed";
        updateHighlightFields(item.id, { status: "failed" });
      }
      // failed, but its answer is in the chat after all (it came after Popup gave up — live 2026-11-19, a Claude Code
      // answer with a tool step): it is done
      if (item.status === "failed" && (item.turnKeys || []).some(function (k) { var t = JR.site.findTurnByKey(k); return t && JR.site.assistantText(t).trim(); })) {
        item.status = "done";
        updateHighlightFields(item.id, { status: "done" });
      }
      // No Q&A known for it (none in the chat links to it): nothing can ever load it — "failed" with Retry, not
      // "Loading…" for good (live 2026-11-18, an old item). In memory only: if its Q&A turns up, adoption links it.
      // (not while the conversation data is still read: adoption may link it in a moment — review: a Retry then sent it twice)
      if (item.status === "done" && !(item.turnKeys || []).length && JR.qa.apiStatus !== "loading" && JR.qa.apiStatus !== "unused") item.status = "failed";
      entry.question = item.question;
    }

    // Show the question with inline edit toggle
    if (entry.question) {
      var questionDiv = document.createElement("div");
      questionDiv.className = "jr-popup-question jr-popup-question--editable";

      var questionInner = document.createElement("div");
      questionInner.className = "jr-popup-question-inner";

      var chevronSpan = document.createElement("span");
      chevronSpan.className = "jr-popup-question-chevron";
      chevronSpan.innerHTML = CHEVRON_RIGHT_SVG;
      questionInner.appendChild(chevronSpan);

      var questionText = document.createElement("span");
      questionText.className = "jr-popup-question-text";
      questionText.textContent = entry.question;
      questionText.addEventListener("paste", function (e) {
        e.preventDefault();
        var t = (e.clipboardData || window.clipboardData).getData("text/plain");
        document.execCommand("insertText", false, t);
      });
      questionInner.appendChild(questionText);
      questionDiv.appendChild(questionInner);

      // Right-side controls container
      var controlsDiv = document.createElement("div");
      controlsDiv.className = "jr-popup-question-controls";

      // Version nav (inline, shown by default if multiple items exist)
      var hasVersions = entry.items && entry.items.length > 1;
      var versionNav = null;
      if (hasVersions) {
        versionNav = buildVersionNavInline(upper, id);
        controlsDiv.appendChild(versionNav);
      }

      // Send wrapper (hidden until edit mode)
      var sendWrapper = document.createElement("div");
      sendWrapper.className = "jr-edit-send-wrapper";
      sendWrapper.style.display = "none";

      var sendBtn = document.createElement("button");
      sendBtn.type = "button";
      sendBtn.className = "jr-popup-edit-send";
      sendBtn.setAttribute("aria-label", "Send question");
      sendBtn.innerHTML = SEND_SVG;
      sendBtn.disabled = true;
      sendWrapper.appendChild(sendBtn);

      var editDropdown = document.createElement("div");
      editDropdown.className = "jr-send-mode-dropdown jr-disabled";
      function rebuildEditDropdown() {
        populateModeDropdown(editDropdown, function (key) {
          var current = readQuestion(questionText);
          if (!editChanged(current)) return;
          editing = false; // prevent blur→exitEditMode from reverting text
          st.responseMode = key;
          if (submitEdit(popup, id, entry, contentContainer, current, key, editAttach.files()) === false) editing = true; // blocked: keep editing
        });
      }
      rebuildEditDropdown();
      sendWrapper.appendChild(editDropdown);
      controlsDiv.appendChild(sendWrapper);

      questionDiv.appendChild(controlsDiv);

      var editing = false;
      var originalText = entry.question;
      var lastCaretRange = null;
      // Edits start with no attachments (the new version carries only what is added now)
      var editAttach = JR.acceptAttachments(questionDiv, questionText, updateEditSend, function () { return editing; });
      /** A new version can be sent: non-empty text that changed, or any attachment added. */
      function editChanged(current) {
        return !!current && (current !== originalText || editAttach.files().length > 0);
      }
      function updateEditSend() {
        var ok = editChanged(readQuestion(questionText));
        sendBtn.disabled = !ok;
        editDropdown.classList.toggle("jr-disabled", !ok);
        if (editing && document.activeElement !== questionText) questionText.focus({ preventScroll: true }); // after an × click
      }

      // Track caret position on mousemove for click-to-edit placement
      questionText.addEventListener("mousemove", function (e) {
        if (editing || st.cancelResponseWatch) { lastCaretRange = null; return; }
        var caretRange = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (!caretRange || !questionText.contains(caretRange.startContainer)) {
          lastCaretRange = null;
          return;
        }
        lastCaretRange = caretRange;
      });

      questionText.addEventListener("mouseleave", function () {
        lastCaretRange = null;
      });

      function enterEditMode(clickEvent) {
        if (editing) return;
        // Block editing while a response is still generating
        if (st.cancelResponseWatch) return;
        editing = true;
        originalText = readQuestion(questionText);
        questionDiv.classList.add("jr-popup-question--editing");
        questionText.contentEditable = "true";
        questionText.focus({ preventScroll: true }); // focusing scrolled the chat to the question row: lost place (R36c)
        // Place caret at click position if available
        var sel = window.getSelection();
        if (clickEvent && lastCaretRange) {
          var range = document.createRange();
          try {
            range.setStart(lastCaretRange.startContainer, lastCaretRange.startOffset);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          } catch (ex) {
            range.selectNodeContents(questionText);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        } else {
          var range = document.createRange();
          range.selectNodeContents(questionText);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        lastCaretRange = null;
        // The version's attachments and notes step aside: an edit starts with none
        if (questionDiv._jrSentStrip) questionDiv._jrSentStrip.classList.add("jr-attach-away");
        JR.layerNotes(questionDiv).forEach(function (n) { n.classList.add("jr-attach-away"); });
        if (versionNav) versionNav.style.display = "none";
        sendWrapper.style.display = "";
        sendBtn.disabled = true;
        editDropdown.classList.add("jr-disabled");
        rebuildEditDropdown();
      }

      function exitEditMode() {
        if (!editing) return;
        editing = false;
        questionDiv.classList.remove("jr-popup-question--editing");
        questionText.contentEditable = "false";
        questionText.textContent = originalText;
        editAttach.clear();
        if (questionDiv._jrSentStrip) questionDiv._jrSentStrip.classList.remove("jr-attach-away");
        JR.layerNotes(questionDiv).forEach(function (n) {
          if (n.classList.contains("jr-attach-note--blocked")) n.remove(); else n.classList.remove("jr-attach-away");
        });
        if (versionNav) versionNav.style.display = "";
        sendWrapper.style.display = "none";
        sendBtn.disabled = true;
        editDropdown.classList.add("jr-disabled");
      }

      // Click on question text → enter edit mode at click position
      questionText.addEventListener("click", function (e) {
        if (!editing) {
          e.stopPropagation();
          enterEditMode(e);
        }
      });

      // Track text changes to enable/disable send
      questionText.addEventListener("input", updateEditSend);

      // Losing focus keeps the edit (switching desktops, clicking elsewhere): only Esc or closing the popup gives it up

      // Enter sends edit, Cmd/Ctrl+Enter inserts newline, Escape cancels
      questionText.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          // Ignore Enter while an IME composition is active (e.g. Chinese/Japanese/Korean input)
          if (e.isComposing || e.keyCode === 229) return;
          if (e.metaKey || e.ctrlKey) {
            document.execCommand("insertLineBreak");
            e.preventDefault();
          } else {
            e.preventDefault();
            var current = readQuestion(questionText);
            if (editChanged(current)) {
              editing = false; // prevent blur→exitEditMode from reverting text
              if (submitEdit(popup, id, entry, contentContainer, current, st.responseMode, editAttach.files()) === false) editing = true; // blocked: keep editing
            }
          }
        }
      });
      questionText.addEventListener("jr-escape", function (e) { // Esc cancels the edit (kept from the site: early-hide.js)
        e.stopPropagation();
        exitEditMode();
      });

      sendBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var current = readQuestion(questionText);
        if (!editChanged(current)) return;
        editing = false; // prevent blur→exitEditMode from reverting text
        if (submitEdit(popup, id, entry, contentContainer, current, st.responseMode, editAttach.files()) === false) editing = true; // blocked: keep editing
      });

      JR.askArea(upper).appendChild(questionDiv);
      JR.showSentAttachments(questionDiv, entry.items && entry.items[entry.activeItemIndex]);
    }

    // Trash button (inside showCompletedResponse so rebuildPopupAfterEdit re-creates it)
    var deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "jr-toolbar-delete";
    deleteBtn.setAttribute("aria-label", "Delete highlight");
    deleteBtn.innerHTML = TRASH_SVG;
    deleteBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      showDeleteConfirmation(id, entry, popup);
    });
    deleteBtn.addEventListener("mousedown", function (e) {
      e.stopPropagation();
    });
    // (before an answer area a rebuild kept: that one isn't moved — moving resets its scroll)
    popup.insertBefore(deleteBtn, popup.querySelector(":scope > .jr-popup-response, :scope > .jr-popup-loading"));

    var activeItem = entry.items && entry.items[entry.activeItemIndex != null ? entry.activeItemIndex : 0];
    if (activeItem) showAnswer(popup, id, entry, activeItem, contentContainer);
  }

  /**
   * A popup's answer area for one version (GLOSSARY.md: answer state) — the one way every path shows it (open, version
   * switch, the rebuild after a send or a question read back): pending "Loading…", failed its reason and Retry, done
   * the site answer. One already showing that Q&A stays as it is (the streaming copy at the end of a send, a rebuild):
   * not redrawn, nothing jumps. Another one goes, its height kept by "Loading…" until the new copy is in.
   */
  function showAnswer(popup, hlId, entry, item, contentContainer) {
    var keys = (item.turnKeys || []).join(), keep = null, oldH = 0;
    if (item.status === "done" && keys) {
      popup.querySelectorAll(":scope > .jr-popup-response").forEach(function (r) { if (r._jrKeys === keys) keep = r; });
    }
    popup.querySelectorAll(":scope > .jr-popup-response, :scope > .jr-popup-loading:not(.jr-popup-stale)").forEach(function (el) {
      if (keep && (el === keep || el === keep._jrWait)) return;
      oldH += el.offsetHeight;
      el.remove();
    });
    var wait = null;
    if (item.status === "pending") wait = popup.appendChild(JR.createLoadingDiv());
    else {
      appendResponseWithReply(popup, hlId, entry, contentContainer, item.id, keep); // (follows its original)
      if (!keep && item.status === "done") wait = popup.querySelector(":scope > .jr-popup-loading");
    }
    if (wait && oldH) wait.style.setProperty("--jr-hold-h", oldH + "px");
    // A finished one's question isn't stored: read back from the site's data, the popup shows it once it arrives
    // (JR.onQAContentLoaded); its answer comes from its original meanwhile
    if (item.status === "done" && item.question == null) JR.qa.ensure(item.turnKeys);
  }

  /**
   * The answer area of a finished or failed version, with Popup's own layer (chained highlights, Reply) — into an
   * area already showing it (reuse: the streaming copy), else a new one. Only through showAnswer.
   */
  function appendResponseWithReply(popup, hlId, entry, contentContainer, activeItemId, reuse) {
    var activeItem = null;
    if (entry.items) {
      for (var ai = 0; ai < entry.items.length; ai++) {
        if (entry.items[ai].id === activeItemId) { activeItem = entry.items[ai]; break; }
      }
    }
    // A failed version: its reason and Retry instead of the answer
    if (activeItem && activeItem.status === "failed") {
      var timeoutDiv = document.createElement("div");
      timeoutDiv.className = "jr-popup-loading";
      var msg = document.createElement("div");
      msg.textContent = entry._jrFailReason || "Couldn\u2019t get a response";
      timeoutDiv.appendChild(msg);
      // Failed items saved before 1.2.0-dev.11 have no stored question (some stored the text "null"): nothing to resend.
      var savedQuestion = activeItem ? activeItem.question : entry.question;
      if (!savedQuestion || savedQuestion === "null") {
        msg.textContent += " \u2014 the question wasn\u2019t saved. Delete this highlight and ask again.";
        popup.appendChild(timeoutDiv);
        return timeoutDiv;
      }
      var retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "jr-retry-btn";
      retryBtn.title = "Try again";
      retryBtn.innerHTML = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M244,56v48a12,12,0,0,1-12,12H184a12,12,0,1,1,0-24H201.1l-19-17.38c-.13-.12-.26-.24-.38-.37A76,76,0,1,0,127,204h1a75.53,75.53,0,0,0,52.15-20.72,12,12,0,0,1,16.49,17.45A99.45,99.45,0,0,1,128,228h-1.37A100,100,0,1,1,198.51,57.06L220,76.72V56a12,12,0,0,1,24,0Z"/></svg>';
      retryBtn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (extensionWasUpdated(popup)) return;
        if (JR.blockedByComposerAttachments(timeoutDiv)) return;
        var retryItemId = activeItemId;
        var retryQuestion = activeItem ? activeItem.question : entry.question;
        var text = entry.text;
        var sentence = entry.sentence;
        var retryMessage = JR.buildMessage({
          question: retryQuestion, text: text, sentence: sentence,
          wholeResponse: !!entry.wholeResponse, mode: st.responseMode,
        });
        // Back to pending, so captureResponse finishes it in place
        activeItem.status = "pending";
        // Enter generating state
        popup.classList.add("jr-popup--generating");
        timeoutDiv.remove();
        popup.appendChild(JR.createLoadingDiv());
        var retryFiles = (activeItem && activeItem._files) || [];
        var filesGone = !retryFiles.length && activeItem && activeItem.attachments > 0;
        JR.enqueueMessage({ // queued like any send: two live watches would fight over shared state
          message: retryMessage,
          files: retryFiles,
          onAttached: function (res) { // the version shows what the retry really sent
            if (activeItem) { activeItem._files = res.sent; activeItem._failedFiles = res.failed; }
            var q = popup.querySelector(".jr-popup-question");
            if (q) JR.showSentAttachments(q, activeItem);
          },
          waitOpts: {
            popup: popup, text: text, sentence: sentence,
            blockTypes: entry.blockTypes, parentId: entry.parentId,
            question: retryQuestion,
            preRegisteredHlId: hlId, preRegisteredItemId: retryItemId
          },
        });
        var qd = popup.querySelector(".jr-popup-question");
        if (filesGone && qd) JR.showAttachmentNote(qd, null, "Files gone after the reload: sent the text only");
      });
      retryBtn.addEventListener("mousedown", function (ev) { ev.stopPropagation(); });
      timeoutDiv.appendChild(retryBtn);
      popup.appendChild(timeoutDiv);
      return timeoutDiv;
    }

    // A new one is empty until it follows its original (GLOSSARY.md: site answer, no drawing of Popup's): "Loading…"
    // meanwhile, in its place — the first patch shows it (at once for an original on the page)
    var responseDiv = reuse;
    if (!responseDiv) {
      responseDiv = document.createElement("div");
      responseDiv.className = "jr-popup-response jr-popup-response--waiting";
      responseDiv._jrWait = popup.appendChild(JR.createLoadingDiv());
      popup.appendChild(responseDiv);
    }
    if (activeItem) responseDiv._jrKeys = (activeItem.turnKeys || []).join(); // (showAnswer keeps it for this Q&A)

    wireResponseClicks(responseDiv);
    processResponseLinks(responseDiv);
    processResponseImages(responseDiv);
    restoreChainedHighlights(responseDiv, hlId, contentContainer, activeItemId);
    // Design A (GLOSSARY.md): from now on the copy follows its original — whatever the site draws or changes there
    // shows here; Popup's own layer is put back after each patch. Again when this popup is active again (removePopup).
    if (activeItem && activeItem.turnKeys && activeItem.turnKeys.length && JR.siteAnswer) {
      responseDiv._jrSiteFollow = function () {
        JR.siteAnswer.follow(responseDiv, activeItem.turnKeys, function (el, turn) {
          if (responseDiv._jrWait) { responseDiv._jrWait.remove(); responseDiv._jrWait = null; responseDiv.classList.remove("jr-popup-response--waiting"); }
          // its question isn't stored and the site's data didn't give it (Claude Code has none to read): from the
          // original's question row (live 2026-11-19: a Claude Code answer from the frame had no question line)
          var parsed = activeItem.question == null && turn && JR.parsePopupMessage(JR.site.userText(turn) || "");
          if (parsed) {
            activeItem.turnKeys.forEach(function (k) { // (onto what is read back already: its answer's text, for ordering)
              JR.qa.put(k, Object.assign({}, JR.qa.get([k]) || {}, { question: parsed.question, text: parsed.text, sentence: parsed.sentence, isPopup: true }));
            });
            if (JR.onQAContentLoaded) setTimeout(function () { JR.onQAContentLoaded(activeItem.turnKeys); }, 0); // (its question row shows; the answer area stays)
          }
          processResponseLinks(responseDiv);
          processResponseImages(responseDiv);
          restoreChainedHighlights(responseDiv, hlId, contentContainer, activeItemId);
        });
      };
      // (not one under an open child — a capture rebuild of a parent: only the active popup follows; removePopup has it
      // follow again when it is active again)
      if (!st.popupStack.some(function (s) { return s.popup === popup; })) responseDiv._jrSiteFollow();
    }

    // Reply button — per-version via activeItemId
    var replyBtn = document.createElement("button");
    replyBtn.type = "button";
    replyBtn.className = "jr-reply-whole-btn";
    replyBtn._jrReplyAnchor = true;
    replyBtn.setAttribute("aria-label", "Reply to response");
    replyBtn.innerHTML = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M232.49,160.49l-48,48a12,12,0,0,1-17-17L195,164H128A108.12,108.12,0,0,1,20,56a12,12,0,0,1,24,0,84.09,84.09,0,0,0,84,84h67l-27.52-27.51a12,12,0,0,1,17-17l48,48A12,12,0,0,1,232.49,160.49Z"/></svg> Reply';

    replyBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();

      // Find existing reply for THIS version (pending or completed)
      var existingReplyId = null;
      st.completedHighlights.forEach(function (chEntry, chId) {
        if (chEntry.parentId === hlId && chEntry.wholeResponse
            && chEntry.parentItemId === activeItemId) {
          existingReplyId = chId;
        }
      });

      // Like clicking a highlight: an open reply popup comes back to the top
      // (or stays as it is); otherwise it opens on top of this popup.
      var ownPopup = replyBtn.closest(".jr-popup");
      var peelUntil = function (done) {
        while (st.activePopup && st.popupStack.length > 0 && !done()) JR.removePopup();
      };
      var replyOpen = existingReplyId && (st.activeHighlightId === existingReplyId ||
        st.popupStack.some(function (s) { return s.highlightId === existingReplyId; }));
      if (replyOpen) {
        peelUntil(function () { return st.activeHighlightId === existingReplyId; });
        return;
      }
      peelUntil(function () { return st.activePopup === ownPopup; });

      if (existingReplyId) {
        JR.pushPopupState();
        JR.createPopup({ completedId: existingReplyId });
        return;
      }

      // Truncate response text for display
      var fullText = JR.popupResponseText(responseDiv);
      var truncated = fullText;
      if (fullText.length > 200) {
        var cutoff = 200;
        var terminators = JR.SENTENCE_TERMINATORS;
        for (var ti = cutoff; ti < fullText.length && ti < cutoff + 100; ti++) {
          if (terminators.indexOf(fullText[ti]) !== -1) { cutoff = ti + 1; break; }
        }
        truncated = fullText.slice(0, cutoff).trim() + "\u2026";
      }
      JR.pushPopupState();
      JR.createPopup({
        text: truncated, sentence: null, blockTypes: null,
        parentId: hlId, wholeResponse: true, wholeResponseFull: fullText
      });
      // Auto-focus the input so user can start typing immediately
      if (st.activePopup) {
        var replyPopup = st.activePopup;
        setTimeout(function () {
          var input = replyPopup.querySelector(".jr-popup-question-text[contenteditable]");
          if (input) input.focus({ preventScroll: true });
        }, 50);
      }
    });
    replyBtn.addEventListener("mousedown", function (ev) {
      ev.stopPropagation();
    });
    replyBtn.setAttribute("data-jr-keep", ""); // stays when the copy follows its original (site-answer.js)
    var oldReply = responseDiv.querySelector(":scope > .jr-reply-whole-btn"); // (a kept area: this one's, for this version)
    if (oldReply) oldReply.remove();
    responseDiv.appendChild(replyBtn);

    return responseDiv;
  }

  // --- Unified popup creation ---

  /**
   * Create a popup at any depth. Works for:
   *  - Level 1: text selected in AI response     { text, sentence, blockTypes, rect, range }
   *  - Chained: text selected in popup response   { text, range, parentId }
   *  - Completed: reopening a saved highlight      { completedId }
   */
  JR.wireResponseClicks = wireResponseClicks;
  JR.processResponseLinks = processResponseLinks;
  JR.processResponseImages = processResponseImages; // [CAROUSEL-LOCKED]
  JR.openLightbox = openLightbox; // attachment thumbnails open in the same lightbox (attachments.js)

  JR.createPopup = function (opts) {
    // claude.ai pinned to its bottom follows any growth there: a popup reaching below the chat's end scrolled the chat
    // with it (live 2026-11-19, Claude Code: 116 px when a child opened, back on Esc) — let go of the pin first
    if (JR.site.unpin) JR.site.unpin();
    var completedId = opts.completedId || null;
    var parentId = opts.parentId || null;
    var range = opts.range || null;
    var rect = opts.rect || null;

    // --- Resolve completed entry ---
    var entry = null;
    if (completedId) {
      entry = st.completedHighlights.get(completedId);
      if (!entry) return;
    }

    var isCompleted = !!entry;
    var isChained = isCompleted ? !!entry.parentId : !!parentId;

    var text = isCompleted ? entry.text : opts.text;
    var sentence = isCompleted ? entry.sentence : (opts.sentence || null);
    var blockTypes = isCompleted ? entry.blockTypes : (opts.blockTypes || null);

    // --- Chained sentence extraction (before highlightRange mutates DOM) ---
    if (!isCompleted && isChained && range) {
      var chainedBlockTypes = [];
      try {
        var startEl = range.startContainer;
        if (startEl.nodeType === Node.TEXT_NODE) startEl = startEl.parentElement;
        var respDiv = startEl.closest(".jr-popup-response");
        if (respDiv) {
          sentence = JR.extractSentenceInContainer(range, chainedBlockTypes, respDiv);
          if (chainedBlockTypes.length > 0) blockTypes = chainedBlockTypes;
        }
      } catch (ex) {
        console.warn("[JR] chained sentence extraction failed:", ex);
      }
    }

    // --- Highlight range (new popups only) ---
    var wrappers = [];
    if (!isCompleted && range) {
      wrappers = JR.highlightRange(range);
      st.activeSourceHighlights = wrappers;
    }

    // --- Create popup element ---
    var popup = document.createElement("div");
    popup.className = "jr-popup" + (isChained ? " jr-popup--chained" : "");
    popup._jrMade = true; // removeAllPopups sweeps Popup's own popups it lost track of
    popup._jrChained = isChained;
    var w = isChained ? st.customPopupWidthChained : st.customPopupWidthL1;
    if (w) popup.style.width = w + "px";
    var h = isChained ? st.customPopupHeightChained : st.customPopupHeightL1;
    if (h) popup.style.setProperty("--jr-popup-h", h);

    // --- Upper card (toolbar + highlight + question) ---
    var upper = document.createElement("div");
    upper.className = "jr-popup-upper";
    popup.appendChild(upper);

    // --- Context blockquote ---
    var highlight = document.createElement("div");
    highlight.className = "jr-popup-highlight";
    var highlightInner = document.createElement("div");
    highlightInner.className = "jr-popup-highlight-inner";
    var quoteSpans = wrappers.length ? wrappers : (entry && entry.spans) || [];
    var quoteRoot = JR.quoteRoot(quoteSpans);
    var quoteHasMath = !!(quoteRoot && quoteRoot.querySelector(JR.site.mathSelector));
    if (sentence) {
      JR.renderSentenceContext(highlightInner, sentence, text, blockTypes, quoteHasMath);
    } else {
      highlightInner.textContent = JR.truncateText(text, JR.MAX_DISPLAY_CHARS);
    }
    if (quoteHasMath) JR.renderQuoteMath(highlightInner, quoteSpans, text);
    highlight.appendChild(highlightInner);
    upper.appendChild(highlight);

    // --- Body: input row (new) or response HTML (completed) ---
    if (isCompleted) {
      showCompletedResponse(popup, upper, completedId, entry, resolveContentContainer(wrappers, isChained, entry));
    } else {
      buildInputRow(upper, text, sentence, blockTypes, wrappers, parentId, opts.wholeResponse, opts.wholeResponseFull);
    }

    // --- Mousedown: stop propagation + close children to this level ---
    popup.addEventListener("mousedown", function (e) {
      e.stopPropagation();
      // Dismiss trigger button on click inside popup (but not on the trigger itself)
      if (JR.removeTriggerBtn && !e.target.closest(".jr-highlight-trigger-btn")) {
        JR.removeTriggerBtn();
      }
      if (st.activePopup && st.activePopup !== popup && st.popupStack.length > 0) {
        var hlSpan = e.target.closest(".jr-source-highlight");
        if (!hlSpan || st.activeSourceHighlights.indexOf(hlSpan) === -1) {
          while (st.activePopup && st.activePopup !== popup && st.popupStack.length > 0) {
            JR.removePopup();
          }
        }
      }
    });
    JR.addPopupResponseSelectionHandler(popup);

    // --- Resolve content container ---
    var contentContainer = resolveContentContainer(wrappers, isChained, entry);
    // Keep entry's contentContainer reference fresh
    if (entry) {
      entry.contentContainer = contentContainer;
    }

    // --- Position ---
    var spans = isCompleted ? entry.spans : wrappers;

    // For reply-to-all popups (new or completed), find the reply button
    // live from the parent popup DOM — never store DOM refs in entry.spans
    var isWholeResponse = (isCompleted && entry && entry.wholeResponse) || opts.wholeResponse;
    if (isWholeResponse && spans.length === 0 && st.popupStack.length > 0) {
      var parentPopup = st.popupStack[st.popupStack.length - 1].popup;
      if (parentPopup) {
        var btn = parentPopup.querySelector(".jr-reply-whole-btn");
        if (btn) spans = [btn];
      }
    }
    var posRect;
    if (spans.length > 0) {
      posRect = JR.getHighlightRect(spans);
    } else if (rect) {
      posRect = rect;
    } else if (isChained && parentId) {
      var ancestor = JR.getAncestorWithSpans(parentId);
      if (ancestor && ancestor.spans && ancestor.spans.length > 0) {
        posRect = JR.getHighlightRect(ancestor.spans);
      }
    }
    if (!posRect) {
      // Fallback: center in viewport
      var vw = window.innerWidth, vh = window.innerHeight;
      posRect = { top: vh / 3, bottom: vh / 3, left: vw / 2, right: vw / 2, width: 0, height: 0 };
    }

    JR.positionPopup(popup, posRect, contentContainer, null, spans);
    JR.attachAboveAnchorObserver(popup);
    JR.addResizeHandlers(popup);

    // --- Register active state ---
    st.activePopup = popup;
    st.activeSourceHighlights = spans;
    if (isCompleted) {
      st.activeHighlightId = completedId;
    } else if (wrappers.length > 0) {
      // Create a temporary entry for new highlights
      var tempId = "temp-" + Date.now();
      for (var ti = 0; ti < wrappers.length; ti++) {
        wrappers[ti].setAttribute("data-jr-highlight-id", tempId);
      }
      st.completedHighlights.set(tempId, {
        quoteId: tempId,
        spans: wrappers,
        text: text,
        sentence: sentence,
        blockTypes: blockTypes,
        contentContainer: contentContainer,
        parentId: parentId || null,
        items: [],
        activeItemIndex: 0,
        _jrTemp: true,
      });
      st.activeHighlightId = tempId;
    } else {
      st.activeHighlightId = null;
    }
    // --- Scroll tracking (a resize re-places every popup: the chat column observer, content.js) ---
    attachScrollTracking(popup, spans, contentContainer);

    // Defer visual-only work (underlines, nav counter) to next frame so the
    // popup appears immediately without extra forced layout passes.
    var deferredHlId = st.activeHighlightId;
    requestAnimationFrame(function () {
      JR.syncHighlightActive(deferredHlId);
      JR.updateNavWidget();
    });
  };

  /**
   * Rebuild a completed popup after an edit response is captured.
   * Called from chat.js captureResponse when editOpts is present.
   */
  JR.rebuildPopupAfterEdit = function (popup, hlId) {
    var entry = st.completedHighlights.get(hlId);
    if (!entry) return;

    // The user may be reading while the answer finishes: keep both the popup's
    // and the chat's scroll position across the rebuild (no jump on "done").
    var oldResp = popup.querySelector(".jr-popup-response");
    var respTop = oldResp ? oldResp.scrollTop : 0;
    var follow = oldResp && oldResp._jrFollow && !oldResp._jrUserScrolled; // it streamed and the user let it follow
    var chat = JR.site.scrollContainer();
    var chatTop = chat ? chat.scrollTop : null;
    function keepPlace() {
      if (popup._jrTyped != null) JR.typeAnswer(popup); // the rebuilt answer: what isn't typed yet stays hidden
      var resp = popup.querySelector(".jr-popup-response");
      if (resp) resp.scrollTop = respTop;
      if (resp && follow) JR.followAnswer(resp); // on to the end of the finished answer (Reply)
      if (chat && chatTop !== null) chat.scrollTop = chatTop;
    }

    // Exit generating state
    popup.classList.remove("jr-popup--generating");

    // Find the upper card and strip question/version nav from it
    var upper = popup.querySelector(".jr-popup-upper");
    if (upper) {
      upper.querySelectorAll(".jr-popup-attach, .jr-attach-note").forEach(function (s) { JR.releaseStrip(s); s.remove(); });
      var questionDiv = upper.querySelector(".jr-popup-question");
      if (questionDiv) questionDiv.remove();
      var versionNav = upper.querySelector(".jr-popup-version-nav");
      if (versionNav) versionNav.remove();
    }

    // Popup's own parts outside the upper card go; the answer area is showAnswer's (it stays when it shows this Q&A)
    var children = Array.from(popup.children);
    for (var i = 0; i < children.length; i++) {
      var cl = children[i].classList;
      if (!cl.contains("jr-popup-upper") && !cl.contains("jr-popup-arrow") &&
          !cl.contains("jr-popup-response") && !(cl.contains("jr-popup-loading") && !cl.contains("jr-popup-stale"))) {
        children[i].remove();
      }
    }

    showCompletedResponse(popup, upper, hlId, entry, entry.contentContainer);
    keepPlace();
    JR.repositionPopup();
    // Also reposition on next frame in case pending layout/scroll changes
    // (e.g. ChatGPT auto-scroll after unlock) shift the highlight spans.
    requestAnimationFrame(function () {
      keepPlace();
      JR.repositionPopup();
    });
  };
})();
