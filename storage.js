// storage.js — Persistence of highlight KEYS using chrome.storage.local
//
// Popup stores only what it needs to find things again, never content:
//   which text is highlighted (text + the turn it's in), how highlights nest,
//   and which ChatGPT turns hold each Popup Q&A (so they can be hidden and
//   their content read back from ChatGPT's own conversation).
//
// Schema v2 — one storage key per conversation, so a save only touches that
// conversation's small record instead of rewriting every highlight ever made:
//   "popup:conv:<conversationId>" → {
//     v: 2,
//     items: [{ id, quoteId, text, nth, parentId, parentItemId, sourceTurnKey,
//               turnKeys: [..], status: "done"|"pending"|"timeout", active,
//               wholeResponse, createdAt }],
//     hidden: [turnKey, ...]   // Q&A turns of deleted highlights (stay hidden)
//   }
// Each item = one version of a highlight; items sharing a quoteId are versions
// of the same highlight (only one active). parentId = parent's quoteId.
//
// The in-memory entries (JR.state.completedHighlights) still carry question /
// responseHTML for the current page session; those are filled from ChatGPT's DOM
// via JR.qa and are never written here.

const LEGACY_KEY = "jumpreturn_highlights";
const LEGACY_DELETED_KEY = "jumpreturn_deleted_turns";
const LEGACY_BACKUP_KEY = "jumpreturn_highlights_v1_backup";
const CONV_PREFIX = "popup:conv:";
const META_KEY = "popup:meta";

/**
 * Check if the extension context is still valid (becomes invalid after extension reload).
 */
function isContextValid() {
  try {
    return !!chrome.runtime.id;
  } catch (e) {
    return false;
  }
}

/** Storage key for the conversation a URL belongs to. */
function convKeyForUrl(url) {
  var m = /\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(url || location.href);
  return CONV_PREFIX + (m ? m[1] : "url:" + (url || location.href).split("#")[0]);
}

// --- Serialized read-modify-write ---------------------------------------------
// Every write goes through one promise chain, so two quick saves can never read
// the same old copy and overwrite each other.

var _writeChain = Promise.resolve();
var _docCache = {}; // storage key → doc (current page's conversations only)

function emptyDoc() {
  return { v: 2, items: [], hidden: [] };
}

async function readDoc(key) {
  if (_docCache[key]) return _docCache[key];
  await migrateLegacyOnce();
  var result = await chrome.storage.local.get(key);
  if (typeof JR !== "undefined" && JR.perf) JR.perf.count("storageRead");
  var doc = result[key] || emptyDoc();
  _docCache[key] = doc;
  return doc;
}

function modifyDoc(key, fn) {
  if (!isContextValid()) return Promise.resolve(null);
  var p = _writeChain.then(async function () {
    var t0 = performance.now();
    var doc = await readDoc(key);
    var out = fn(doc);
    await chrome.storage.local.set({ [key]: doc });
    if (typeof JR !== "undefined" && JR.perf) JR.perf.time("storageWrite", Math.round(performance.now() - t0));
    return out;
  });
  _writeChain = p.catch(function (e) { console.warn("[Popup] storage write failed:", e); });
  return p;
}

// Another tab may change the same conversation — drop our cached copy.
try {
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "local") return;
    Object.keys(changes).forEach(function (k) { delete _docCache[k]; });
  });
} catch (e) { /* context invalidated */ }

// --- Field mapping between in-memory items and stored records -----------------

function statusFromHTML(responseHTML, fallback) {
  if (responseHTML === "__TIMEOUT__") return "timeout";
  if (responseHTML === "__PENDING__") return "pending";
  if (responseHTML) return "done";
  return fallback || "done";
}

/** Stored record → shape the rest of the code expects (content filled later by JR.qa). */
function toPublic(rec) {
  return {
    id: rec.id,
    quoteId: rec.quoteId,
    text: rec.text,
    nth: rec.nth || 0,
    parentId: rec.parentId || null,
    parentItemId: rec.parentItemId || null,
    sourceTurnKey: rec.sourceTurnKey || null,
    turnKeys: (rec.turnKeys || []).slice(),
    active: rec.active !== false,
    wholeResponse: !!rec.wholeResponse,
    createdAt: rec.createdAt,
    question: rec.question || null,
    sentence: null,
    blockTypes: null,
    // A pending item whose turn is already known was interrupted by a reload:
    // its answer exists in ChatGPT, so it loads like a finished one.
    responseHTML: rec.status === "timeout" ? "__TIMEOUT__"
      : rec.status === "pending" && !(rec.turnKeys || []).length ? "__PENDING__"
      : "__LOADING__",
  };
}

// --- Migration from v1 (one big array with full response HTML) ----------------

var _migration = null;

function migrateLegacyOnce() {
  if (_migration) return _migration;
  _migration = (async function () {
    if (!isContextValid()) return;
    var meta = (await chrome.storage.local.get(META_KEY))[META_KEY] || {};
    if (meta.migratedV2) return;
    var old = await chrome.storage.local.get([LEGACY_KEY, LEGACY_DELETED_KEY]);
    var list = old[LEGACY_KEY] || [];
    var deleted = old[LEGACY_DELETED_KEY] || {};
    var docs = {};
    function docFor(url) {
      var k = convKeyForUrl(url);
      if (!docs[k]) docs[k] = emptyDoc();
      return docs[k];
    }
    for (var i = 0; i < list.length; i++) {
      var h = list[i];
      if (!h || !h.url) continue;
      // Pre-quoteId records stored versions inline; expand them.
      var versions = (!h.quoteId && h.versions && h.versions.length)
        ? h.versions.map(function (v, vi) {
            return { id: h.id + "-v" + vi, question: v.question, responseHTML: v.responseHTML,
                     questionIndex: v.questionIndex, responseIndex: v.responseIndex,
                     active: vi === (h.activeVersion != null ? h.activeVersion : h.versions.length - 1) };
          })
        : [{ id: h.id, responseHTML: h.responseHTML, questionIndex: h.questionIndex,
             responseIndex: h.responseIndex, active: h.quoteId ? h.active !== false : true }];
      versions.forEach(function (v) {
        docFor(h.url).items.push({
          id: v.id,
          quoteId: h.quoteId || h.id,
          text: h.text,
          parentId: h.parentId || null,
          parentItemId: h.parentItemId || null,
          sourceTurnKey: null,
          turnKeys: [],
          status: statusFromHTML(v.responseHTML),
          active: v.active,
          wholeResponse: !!h.wholeResponse,
          createdAt: h.createdAt || Date.now(),
        });
      });
    }
    // Merge into any v2 docs that already exist (another tab may have migrated
    // and saved new highlights in the meantime) instead of overwriting them.
    var existing = await chrome.storage.local.get(Object.keys(docs));
    var writes = {};
    Object.keys(docs).forEach(function (k) {
      var cur = existing[k];
      if (!cur) { writes[k] = docs[k]; return; }
      var ids = new Set(cur.items.map(function (it) { return it.id; }));
      docs[k].items.forEach(function (it) { if (!ids.has(it.id)) cur.items.push(it); });
      writes[k] = cur;
    });
    if (list.length) writes[LEGACY_BACKUP_KEY] = list; // removed in a later version once v2 is proven
    writes[META_KEY] = Object.assign(meta, { migratedV2: Date.now() });
    await chrome.storage.local.set(writes);
    await chrome.storage.local.remove([LEGACY_KEY, LEGACY_DELETED_KEY]);
  })().catch(function (e) {
    console.warn("[Popup] storage migration failed:", e);
  });
  return _migration;
}

// --- Public API (names kept from v1) -------------------------------------------

/**
 * Save a new highlight item (one version). Content fields in opts are accepted
 * for call-site compatibility but NOT stored.
 */
async function saveHighlight(opts) {
  var rec = {
    id: opts.id || crypto.randomUUID(),
    quoteId: opts.quoteId || crypto.randomUUID(),
    text: opts.text,
    nth: opts.nth || undefined, // which occurrence of text in its answer (0 = first, not stored)
    parentId: opts.parentId || null,
    parentItemId: opts.parentItemId || null,
    sourceTurnKey: opts.sourceTurnKey || null,
    turnKeys: (opts.turnKeys || []).filter(Boolean),
    status: statusFromHTML(opts.responseHTML),
    // The question is kept only until the answer exists (needed to show and
    // resend a pending/failed question); finished items keep keys only.
    question: statusFromHTML(opts.responseHTML) === "done" ? undefined : (opts.question || undefined),
    active: opts.active !== false,
    wholeResponse: !!opts.wholeResponse,
    createdAt: Date.now(),
  };
  await modifyDoc(convKeyForUrl(opts.url), function (doc) {
    // A new version (edit/retry) is the same highlight: keep where its text was.
    if (!rec.nth) {
      var first = doc.items.find(function (it) { return it.quoteId === rec.quoteId && it.nth; });
      if (first) rec.nth = first.nth;
    }
    if (rec.active) {
      doc.items.forEach(function (it) { if (it.quoteId === rec.quoteId) it.active = false; });
    }
    doc.items.push(rec);
  });
  return rec;
}

/**
 * Update fields on an item. Accepts: responseHTML (only its status is kept),
 * turnKeys, sourceTurnKey, active, parentItemId. Optional third arg: url.
 */
function updateHighlightFields(id, fields, url) {
  // url: the conversation the item belongs to. Pass it from async flows (a
  // capture can finish after the user navigated to another conversation).
  return modifyDoc(convKeyForUrl(url), function (doc) {
    var rec = doc.items.find(function (it) { return it.id === id; });
    if (!rec) return;
    if ("responseHTML" in fields) rec.status = statusFromHTML(fields.responseHTML, rec.status);
    if ("question" in fields && rec.status !== "done") rec.question = fields.question || undefined;
    if (rec.status === "done") delete rec.question;
    if (fields.turnKeys) rec.turnKeys = fields.turnKeys.filter(Boolean);
    if ("sourceTurnKey" in fields) rec.sourceTurnKey = fields.sourceTurnKey;
    if ("active" in fields) rec.active = fields.active;
    if ("parentItemId" in fields) rec.parentItemId = fields.parentItemId;
  });
}

/** All items of the conversation at url (public shape, content not filled). */
async function getHighlightsByUrl(url) {
  if (!isContextValid()) return [];
  var doc = await readDoc(convKeyForUrl(url));
  return doc.items.map(toPublic);
}

/** Active children of a parent highlight (optionally only those made in one parent version). */
async function getChildHighlights(parentQuoteId, parentItemId) {
  var items = await getHighlightsByUrl();
  return items.filter(function (h) {
    if (h.parentId !== parentQuoteId || !h.active) return false;
    if (parentItemId && h.parentItemId !== parentItemId) return false;
    return true;
  });
}

/**
 * Delete a highlight and all its descendants. Their Q&A turn keys move to the
 * conversation's hidden list so the turns stay out of the main chat.
 */
function deleteHighlight(quoteId) {
  return modifyDoc(convKeyForUrl(), function (doc) {
    var del = new Set();
    (function collect(q) {
      del.add(q);
      doc.items.forEach(function (it) { if (it.parentId === q && !del.has(it.quoteId)) collect(it.quoteId); });
    })(quoteId);
    var keep = [];
    doc.items.forEach(function (it) {
      if (del.has(it.quoteId)) {
        (it.turnKeys || []).forEach(function (k) { if (doc.hidden.indexOf(k) === -1) doc.hidden.push(k); });
      } else {
        keep.push(it);
      }
    });
    doc.items = keep;
  });
}

/** Number of distinct descendant highlights under a quoteId. */
async function countDescendants(quoteId) {
  var items = await getHighlightsByUrl();
  var seen = new Set();
  (function walk(q) {
    items.forEach(function (it) {
      if (it.parentId === q && !seen.has(it.quoteId)) { seen.add(it.quoteId); walk(it.quoteId); }
    });
  })(quoteId);
  return seen.size;
}

/** Make itemId the active version of quoteId. */
function setActiveItem(quoteId, itemId) {
  return modifyDoc(convKeyForUrl(), function (doc) {
    doc.items.forEach(function (it) { if (it.quoteId === quoteId) it.active = (it.id === itemId); });
  });
}

/** Keep these Q&A turns hidden in this conversation (orphaned / deleted Q&A). */
function addDeletedTurns(url, turnKeys) {
  return modifyDoc(convKeyForUrl(url), function (doc) {
    (turnKeys || []).forEach(function (k) { if (k && doc.hidden.indexOf(k) === -1) doc.hidden.push(k); });
  });
}

/** Every turn key that must be hidden in the conversation at url. */
async function getHiddenTurnKeys(url) {
  if (!isContextValid()) return [];
  var doc = await readDoc(convKeyForUrl(url));
  var keys = doc.hidden.slice();
  doc.items.forEach(function (it) {
    (it.turnKeys || []).forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k); });
  });
  return keys;
}

/** Forget cached docs (on SPA navigation). */
function resetStorageCache() {
  _docCache = {};
}
