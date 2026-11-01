// attachments.js — Files added to a popup question by paste or drop. They stay in
// memory and show as a row of small squares between the quote and the question:
// images as thumbnails, other files as a file icon with their extension. Sending
// hands them to ChatGPT's own upload (chat.js).
(function () {
  "use strict";

  var FILE_SVG = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,51.31,188.69,80H160ZM200,216H56V40h88V88a8,8,0,0,0,8,8h48V216Z"/></svg>';
  var X_SVG = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg>';

  function isImage(file) { return /^image\//.test(file.type || ""); }

  /**
   * A file name that fits a tile: the start of the name, "…", and always the
   * extension ("test-note.pdf" -> "test….pdf", "a.zip" stays "a.zip").
   */
  JR.shortFileName = function (name, max) {
    max = max || 9;
    if (name.length <= max) return name;
    var m = /^(.*?)(\.[^.]{1,6})?$/.exec(name), ext = m[2] || "";
    var keep = Math.max(1, max - ext.length - 1);
    return m[1].slice(0, keep) + "\u2026" + ext;
  };

  /**
   * One thumbnail (image) or chip (other file). With onRemove it gets an × that
   * calls it; without, it is a read-only copy (the question after sending).
   */
  JR.attachmentItem = function (file, onRemove, readyUrl) {
    var item = document.createElement("span");
    item.className = "jr-attach-item";
    if (readyUrl || isImage(file)) {
      var url = readyUrl || URL.createObjectURL(file);
      var img = document.createElement("img");
      img.className = "jr-attach-thumb";
      img.src = url;
      img.alt = file.name;
      img.addEventListener("click", function (e) {
        e.stopPropagation();
        if (JR.openLightbox) JR.openLightbox(item.closest(".jr-popup-response") || item, [url], 0);
      });
      item.appendChild(img);
      if (!readyUrl) item._jrRevoke = function () { URL.revokeObjectURL(url); };
    } else {
      var chip = document.createElement("span");
      chip.className = "jr-attach-chip";
      chip.innerHTML = FILE_SVG;
      var label = document.createElement("span");
      label.className = "jr-attach-ext";
      label.textContent = JR.shortFileName(file.name);
      chip.appendChild(label);
      chip.title = file.name;
      chip.setAttribute("aria-label", file.name);
      item.appendChild(chip);
    }
    if (onRemove) {
      var x = document.createElement("button");
      x.type = "button";
      x.className = "jr-attach-remove";
      x.setAttribute("aria-label", "Remove " + file.name);
      x.innerHTML = X_SVG;
      x.addEventListener("click", function (e) { e.stopPropagation(); onRemove(); });
      item.appendChild(x);
    }
    return item;
  };

  /**
   * Under a sent question: which attachments did not go out (session only; after a
   * reload the question simply has the attachments ChatGPT has).
   */
  JR.showAttachmentNote = function (questionDiv, failed, message) {
    if (!message && (!failed || !failed.length)) return;
    var note = document.createElement("div");
    note.className = "jr-attach-note";
    // One short line; the details on hover
    note.textContent = message || "Not sent: " + failed.map(function (f) { return f.file.name; }).join(", ");
    note.title = message || failed.map(function (f) { return f.file.name + " (" + f.reason + ")"; }).join("\n");
    // In the attachment layer, under the tiles and above the question (not in the question's
    // flex row: a note there squeezed the question to 0 px, T8/T9)
    if (questionDiv.parentNode) questionDiv.parentNode.insertBefore(note, questionDiv); else questionDiv.appendChild(note);
    return note;
  };

  function isLayer(el) { return !!el && (el.classList.contains("jr-attach-note") || el.classList.contains("jr-popup-attach")); }

  /** The notes in the attachment layer above a question row, top to bottom. */
  JR.layerNotes = function (questionDiv) {
    var out = [], n = questionDiv;
    while (isLayer(n = n.previousElementSibling)) if (n.classList.contains("jr-attach-note")) out.unshift(n);
    return out;
  };

  /**
   * The user's own files wait in ChatGPT's input box: a Popup message would carry
   * them along, hidden. Say so under questionDiv and return true (then don't send).
   */
  JR.blockedByComposerAttachments = function (questionDiv) {
    if (questionDiv) JR.layerNotes(questionDiv).forEach(function (n) { if (n.classList.contains("jr-attach-note--blocked")) n.remove(); });
    if (!JR.site.composerHasAttachments(JR.site.composer())) return false;
    var note = questionDiv && JR.showAttachmentNote(questionDiv, null,
      "Send or remove your files in ChatGPT\u2019s box first");
    if (note) note.classList.add("jr-attach-note--blocked");
    return true;
  };

  /** Free a strip's image previews (object URLs keep the image data alive). */
  JR.releaseStrip = function (strip) {
    if (!strip || !strip.children) return;
    Array.prototype.forEach.call(strip.children, function (it) { if (it._jrRevoke) it._jrRevoke(); });
  };

  /** A read-only item for an attachment known only from ChatGPT's data ({ id, name, mime }). */
  JR.attachmentItemFromMeta = function (a) {
    if (!/^image\//.test(a.mime) || !JR.qa || !JR.qa.fileUrl) return JR.attachmentItem({ name: a.name, type: a.mime }, null);
    var item = document.createElement("span"); // a placeholder until the address arrives
    item.className = "jr-attach-item";
    JR.qa.fileUrl(a.id).then(function (url) {
      var asFile = function (el) { el.replaceWith(JR.attachmentItem({ name: a.name, type: "" }, null)); }; // shown as a file instead
      if (!url) { asFile(item); return; }
      var real = JR.attachmentItem({ name: a.name, type: a.mime }, null, url);
      real.querySelector("img").addEventListener("error", function () { JR.qa.forgetFileUrl(a.id); asFile(real); });
      item.replaceWith(real);
    });
    return item;
  };

  /**
   * Above an answered question: the attachments that version carried, from memory
   * in this session (item._files), else from ChatGPT's conversation data (after a
   * reload). Replaces the strip shown for another version.
   */
  JR.showSentAttachments = function (questionDiv, item) {
    if (questionDiv._jrSentStrip) { JR.releaseStrip(questionDiv._jrSentStrip); questionDiv._jrSentStrip.remove(); }
    questionDiv._jrSentStrip = null;
    JR.layerNotes(questionDiv).forEach(function (n) { n.remove(); });
    if (!item) return;
    JR.showAttachmentNote(questionDiv, item._failedFiles); // what didn't go out (this session)
    var strip;
    if (item._files && item._files.length) {
      strip = JR.attachmentStrip(item._files);
    } else {
      var key = (item.turnKeys || [])[0];
      // Only questions sent with attachments: reading the conversation data costs a big download
      if (!key || !(item.attachments > 0) || !JR.qa || !JR.qa.attachmentsOf) return;
      strip = document.createElement("div");
      strip.className = "jr-popup-attach";
      strip.hidden = true;
      JR.qa.attachmentsOf(key).then(function (list) {
        list.forEach(function (a) { strip.appendChild(JR.attachmentItemFromMeta(a)); });
        strip.hidden = !list.length;
      });
    }
    questionDiv._jrSentStrip = strip;
    JR.placeStripAbove(strip, questionDiv);
  };

  /** A strip of read-only items for files that were sent. */
  JR.attachmentStrip = function (files) {
    var strip = document.createElement("div");
    strip.className = "jr-popup-attach";
    files.forEach(function (f) { strip.appendChild(JR.attachmentItem(f, null)); });
    return strip;
  };

  /**
   * Place a strip in the attachment layer above a question row (between it and the
   * quote): above the layer's notes, so the tiles come first.
   */
  JR.placeStripAbove = function (strip, questionDiv) {
    if (!questionDiv.parentNode) return;
    var target = questionDiv, n;
    while ((n = target.previousElementSibling) && n.classList.contains("jr-attach-note")) target = n;
    if (strip.nextSibling !== target) questionDiv.parentNode.insertBefore(strip, target);
  };

  /** The attachment strip nearest above a question row, if any. */
  JR.stripAbove = function (questionDiv) {
    var n = questionDiv;
    while (isLayer(n = n && n.previousElementSibling)) if (n.classList.contains("jr-popup-attach")) return n;
    return null;
  };

  /**
   * Let a popup question take files: paste into inputEl, or drop onto its
   * popup (JR.popupDrag; the question shows a dashed outline while files are dragged over it).
   * Returns { files(), clear() }; onChange runs after every change. isOn (optional):
   * files are only taken while it returns true (an answered question while edited).
   */
  function hasFiles(dt) { return !!dt && Array.prototype.indexOf.call(dt.types || [], "Files") !== -1; }

  /**
   * A file dragged over a popup goes to the popup, never to ChatGPT, which would take the drop for its
   * composer (and covers the page with its own "drop here" layer). early-hide.js forwards every drag
   * event here at document_start, so this runs before ChatGPT's own scripts see it.
   */
  var overPopup = false;
  // ChatGPT shows its "Add anything" layer while a file is over the page: tell it the drag left
  // (and, after a drop, that it ended) so the layer goes away while the file is over a popup.
  function releaseChat(target, dropped) {
    ["dragleave"].concat(dropped ? ["drop"] : []).forEach(function (type) {
      var ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: new DataTransfer(), clientX: 0, clientY: 0, relatedTarget: null });
      ev._jrCleanup = true;
      target.dispatchEvent(ev);
    });
  }

  var outlined = null; // the question showing the drop outline
  function outline(q) {
    if (outlined && outlined !== q) outlined.classList.remove("jr-attach-drop");
    if (q) q.classList.add("jr-attach-drop");
    outlined = q;
  }

  JR.popupDrag = function (e) {
    if (e._jrCleanup || !hasFiles(e.dataTransfer)) return;
    if (e.type === "dragleave" && !e.relatedTarget) { // left the window
      overPopup = false;
      outline(null);
      return;
    }
    var popups = document.querySelectorAll(".jr-popup"), popup = null;
    for (var i = popups.length - 1; i >= 0 && !popup; i--) { // the last one opened is on top
      var r = popups[i].getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) popup = popups[i];
    }
    var q = popup && Array.prototype.filter.call(popup.querySelectorAll(".jr-popup-question"), function (el) {
      return el._jrDrop && el._jrDrop.isOn(); // an answered question takes files only while edited
    })[0] || null;
    outline(e.type === "drop" ? null : q);
    if (window.jrEvLog) window.jrEvLog(e.type, "popup", e, { popup: !!popup, takes: !!q });
    if (!popup) { overPopup = false; return; }
    e.stopImmediatePropagation(); // ChatGPT never sees a drag over a popup (moves inside it included)
    if (e.type === "dragleave") return;
    e.preventDefault();
    if (e.type !== "drop") {
      e.dataTransfer.dropEffect = q ? "copy" : "none";
      if (!overPopup) releaseChat(e.target, false);
      overPopup = true;
      return;
    }
    if (q && e.dataTransfer.files.length) q._jrDrop.add(e.dataTransfer.files);
    releaseChat(e.target, true);
    overPopup = false;
  };

  JR.acceptAttachments = function (questionDiv, inputEl, onChange, isOn) {
    isOn = isOn || function () { return true; };
    var files = [];
    var strip = document.createElement("div");
    strip.className = "jr-popup-attach";
    strip.hidden = true;

    // Clicking a thumbnail or × must not take focus from the text
    strip.addEventListener("mousedown", function (e) { e.preventDefault(); });

    function render() {
      JR.releaseStrip(strip);
      strip.textContent = "";
      files.forEach(function (f, i) {
        strip.appendChild(JR.attachmentItem(f, function () { files.splice(i, 1); render(); }));
      });
      strip.hidden = !files.length;
      JR.placeStripAbove(strip, questionDiv); // the row may be placed in the popup after this was set up
      if (onChange) onChange();
    }
    function add(list) {
      Array.prototype.forEach.call(list, function (f) { files.push(f); });
      render();
    }
    // Capture phase: runs before popup.js's text-paste handler on the same element.
    inputEl.addEventListener("paste", function (e) {
      if (window.jrEvLog) window.jrEvLog("paste", "popup", e, { on: isOn() });
      var dt = e.clipboardData;
      if (!dt || !dt.files || !dt.files.length || !isOn()) return; // plain text: popup.js pastes it
      // Text copied from Word/Excel/a web page also carries a picture of it: that is a text paste
      // ("Copy image" on a web page carries an <img> tag but no text: that is the picture)
      if (Array.prototype.indexOf.call(dt.types || [], "text/html") !== -1 && dt.getData("text/plain")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      add(dt.files);
    }, true);
    questionDiv._jrDrop = { isOn: isOn, add: add }; // dropped files: JR.popupDrag

    JR.placeStripAbove(strip, questionDiv);
    return {
      files: function () { return files.slice(); },
      clear: function () { files = []; render(); },
      remove: function () { files = []; render(); strip.remove(); },
    };
  };
})();
