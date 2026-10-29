// attachments.js — Files added to a popup question by paste or drop. They stay in
// memory and show as a strip above the text: images as thumbnails, other files as
// chips (icon + name). Sending hands them to ChatGPT's own upload (chat.js).
(function () {
  "use strict";

  var FILE_SVG = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,51.31,188.69,80H160ZM200,216H56V40h88V88a8,8,0,0,0,8,8h48V216Z"/></svg>';
  var X_SVG = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg>';

  function isImage(file) { return /^image\//.test(file.type || ""); }

  /**
   * One thumbnail (image) or chip (other file). With onRemove it gets an × that
   * calls it; without, it is a read-only copy (the question after sending).
   */
  JR.attachmentItem = function (file, onRemove) {
    var item = document.createElement("span");
    item.className = "jr-attach-item";
    if (isImage(file)) {
      var url = URL.createObjectURL(file);
      var img = document.createElement("img");
      img.className = "jr-attach-thumb";
      img.src = url;
      img.alt = file.name;
      img.addEventListener("click", function (e) {
        e.stopPropagation();
        if (JR.openLightbox) JR.openLightbox(item.closest(".jr-popup-response") || item, [url], 0);
      });
      item.appendChild(img);
      item._jrRevoke = function () { URL.revokeObjectURL(url); };
    } else {
      var chip = document.createElement("span");
      chip.className = "jr-attach-chip";
      chip.innerHTML = FILE_SVG;
      chip.appendChild(document.createTextNode(file.name));
      chip.title = file.name;
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
    note.textContent = message || (failed.length === 1 ? "1 attachment was" : failed.length + " attachments were") + " not sent: " +
      failed.map(function (f) { return f.file.name + " (" + f.reason + ")"; }).join(", ");
    questionDiv.appendChild(note);
  };

  /** Free a strip's image previews (object URLs keep the image data alive). */
  JR.releaseStrip = function (strip) {
    if (!strip || !strip.children) return;
    Array.prototype.forEach.call(strip.children, function (it) { if (it._jrRevoke) it._jrRevoke(); });
  };

  /** A strip of read-only items for files that were sent. */
  JR.attachmentStrip = function (files) {
    var strip = document.createElement("div");
    strip.className = "jr-popup-attach";
    files.forEach(function (f) { strip.appendChild(JR.attachmentItem(f, null)); });
    return strip;
  };

  /**
   * Let a popup question take files: paste into inputEl, or drop onto
   * questionDiv (it shows a dashed outline while files are dragged over it).
   * Returns { files(), clear() }; onChange runs after every change. isOn (optional):
   * files are only taken while it returns true (an answered question while edited).
   */
  JR.acceptAttachments = function (questionDiv, inputEl, onChange, isOn) {
    isOn = isOn || function () { return true; };
    var files = [];
    var strip = document.createElement("div");
    strip.className = "jr-popup-attach";
    strip.hidden = true;
    questionDiv.insertBefore(strip, questionDiv.firstChild);

    // Clicking a thumbnail or × must not take focus from the text (an edit ends on blur)
    strip.addEventListener("mousedown", function (e) { e.preventDefault(); });

    function render() {
      JR.releaseStrip(strip);
      strip.textContent = "";
      files.forEach(function (f, i) {
        strip.appendChild(JR.attachmentItem(f, function () { files.splice(i, 1); render(); }));
      });
      strip.hidden = !files.length;
      if (onChange) onChange();
    }
    function add(list) {
      Array.prototype.forEach.call(list, function (f) { files.push(f); });
      render();
    }
    function hasFiles(dt) { return !!dt && Array.prototype.indexOf.call(dt.types || [], "Files") !== -1; }

    // Capture phase: runs before popup.js's text-paste handler on the same element.
    inputEl.addEventListener("paste", function (e) {
      var dt = e.clipboardData;
      if (!dt || !dt.files || !dt.files.length || !isOn()) return; // plain text: popup.js pastes it
      // Text copied from Word/Excel/a web page also carries a picture of it: that is a text paste
      if (Array.prototype.indexOf.call(dt.types || [], "text/html") !== -1) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      add(dt.files);
    }, true);
    questionDiv.addEventListener("dragover", function (e) {
      if (!hasFiles(e.dataTransfer) || !isOn()) return;
      e.preventDefault();
      questionDiv.classList.add("jr-attach-drop");
    });
    questionDiv.addEventListener("dragleave", function (e) {
      if (!questionDiv.contains(e.relatedTarget)) questionDiv.classList.remove("jr-attach-drop");
    });
    questionDiv.addEventListener("drop", function (e) {
      questionDiv.classList.remove("jr-attach-drop");
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length || !isOn()) return;
      e.preventDefault();
      add(e.dataTransfer.files);
    });

    return {
      files: function () { return files.slice(); },
      clear: function () { files = []; render(); },
    };
  };
})();
