// storage.js — Persistence of highlight KEYS using chrome.storage.local
//
// Popup stores only what it needs to find things again, never content:
//   which text is highlighted (text + the turn it's in), how highlights nest,
//   and which ChatGPT turns hold each Popup Q&A (so they can be hidden and
//   their content read back from ChatGPT's own conversation).
//
// Schema v2 — one storage key per conversation, so a save only touches that
// conversation's small record instead of rewriting every highlight ever made:
//   "popup:conv:<conversationId>" (DeepSeek / claude.ai: "popup:deepseek:conv:…" / "popup:claude:conv:…") → {
//     v: 2,
//     items: [{ id, quoteId, text, nth, parentId, parentItemId, sourceTurnKey,
//               turnKeys: [..], status: "done"|"pending"|"timeout", active,
//               wholeResponse, createdAt }],
//     hidden: [turnKey, ...]   // Q&A turns of deleted highlights (stay hidden)
//   }
// Each item = one version of a highlight; items sharing a quoteId are versions
// of the same highlight (only one active). parentId = parent's quoteId.
//
// The in-memory entries (JR.state.completedHighlights) also carry a finished
// item's question for the current page session (read back from the site via
// JR.qa, never written here). No answer content anywhere: a popup shows the site's own.

const LEGACY_KEY = "jumpreturn_highlights";
const LEGACY_DELETED_KEY = "jumpreturn_deleted_turns";
const LEGACY_BACKUP_KEY = "jumpreturn_highlights_v1_backup";
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

/** Storage key for the conversation a URL belongs to (per site: src/site-hosts.js). */
function convKeyForUrl(url) {
  return JR_HOST.convKey(url);
}

// --- Serialized read-modify-write ---------------------------------------------
// Every write goes through one promise chain, so two quick saves can never read
// the same old copy and overwrite each other.

var _writeChain = Promise.resolve();
var _docCache = {}; // storage key → doc (current page's conversations only)
var _tabToken = Math.random().toString(36).slice(2), _writeCount = 0, _lastWrite = {}; // storage key → this tab's last write

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
    doc.w = _tabToken + ":" + (++_writeCount); // this tab's write (onChanged below keeps the cache for it)
    _lastWrite[key] = doc.w;
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
    // (Chrome tells every tab of every write, this one's own too: its cache is that write — kept)
    Object.keys(changes).forEach(function (k) { var v = changes[k].newValue; if (!(v && v.w && v.w === _lastWrite[k])) delete _docCache[k]; });
  });
} catch (e) { /* context invalidated */ }

// --- Field mapping between in-memory items and stored records -----------------

/** Legacy v1 records (migration only): their status was coded in the stored HTML. */
function statusFromHTML(responseHTML) {
  if (responseHTML === "__TIMEOUT__") return "timeout";
  if (responseHTML === "__PENDING__") return "pending";
  return "done";
}

/** An answer state (GLOSSARY.md: pending / failed / done) as stored ("timeout" for failed, as since v2). */
function storedStatus(status) {
  return status === "failed" ? "timeout" : status === "pending" ? "pending" : "done";
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
    attachments: rec.attachments || 0,
    createdAt: rec.createdAt,
    question: rec.question || null,
    sentence: null,
    blockTypes: null,
    // A pending item whose turn is already known was interrupted by a reload:
    // its answer exists in the chat, so it loads like a finished one.
    status: rec.status === "timeout" ? "failed"
      : rec.status === "pending" && !(rec.turnKeys || []).length ? "pending"
      : "done",
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
function recordFor(opts) {
  return {
    id: opts.id || crypto.randomUUID(),
    quoteId: opts.quoteId || crypto.randomUUID(),
    text: opts.text,
    nth: opts.nth || undefined, // which occurrence of text in its answer (0 = first, not stored)
    parentId: opts.parentId || null,
    parentItemId: opts.parentItemId || null,
    sourceTurnKey: opts.sourceTurnKey || null,
    turnKeys: (opts.turnKeys || []).filter(Boolean),
    status: storedStatus(opts.status),
    // The question is kept only until the answer exists (needed to show and
    // resend a pending/failed question); finished items keep keys only.
    question: storedStatus(opts.status) === "done" ? undefined : (opts.question || undefined),
    active: opts.active !== false,
    wholeResponse: !!opts.wholeResponse,
    attachments: opts.attachments || undefined, // how many files the question carried (not the files)
    createdAt: Date.now(),
  };
}

function addRecord(doc, rec) {
  // A new version (edit/retry) is the same highlight: keep where its text was.
  if (!rec.nth) {
    var first = doc.items.find(function (it) { return it.quoteId === rec.quoteId && it.nth; });
    if (first) rec.nth = first.nth;
  }
  if (rec.active) {
    doc.items.forEach(function (it) { if (it.quoteId === rec.quoteId) it.active = false; });
  }
  doc.items.push(rec);
}

async function saveHighlight(opts) {
  var rec = recordFor(opts);
  await modifyDoc(convKeyForUrl(opts.url), function (doc) { addRecord(doc, rec); });
  return rec;
}

/** Several items of one conversation (opts.url) in one write — a rebuild of ~100 was ~100 whole-document writes. */
async function saveHighlights(list) {
  if (!list.length) return [];
  var recs = list.map(recordFor);
  // (rebuilt from the conversation: one another tab of the chat stored meanwhile isn't stored twice — audit 11-20)
  var saved = await modifyDoc(convKeyForUrl(list[0].url), function (doc) {
    var have = new Set();
    doc.items.forEach(function (it) { (it.turnKeys || []).forEach(function (k) { have.add(k); }); });
    var fresh = recs.filter(function (rec) { return !(rec.turnKeys || []).some(function (k) { return have.has(k); }); });
    fresh.forEach(function (rec) { addRecord(doc, rec); });
    return fresh;
  });
  return saved || [];
}

/**
 * Update fields on an item. Accepts: status (pending / failed / done),
 * turnKeys, sourceTurnKey, active, parentItemId. Optional third arg: url.
 */
function updateHighlightFields(id, fields, url) {
  // url: the conversation the item belongs to. Pass it from async flows (a
  // capture can finish after the user navigated to another conversation).
  return modifyDoc(convKeyForUrl(url), function (doc) {
    var rec = doc.items.find(function (it) { return it.id === id; });
    if (!rec) return;
    if ("status" in fields) rec.status = storedStatus(fields.status);
    if ("question" in fields && rec.status !== "done") rec.question = fields.question || undefined;
    if (rec.status === "done") delete rec.question;
    if (fields.turnKeys) rec.turnKeys = fields.turnKeys.filter(Boolean);
    if ("sourceTurnKey" in fields) rec.sourceTurnKey = fields.sourceTurnKey;
    if ("active" in fields) rec.active = fields.active;
    if ("parentItemId" in fields) rec.parentItemId = fields.parentItemId;
    if ("attachments" in fields) rec.attachments = fields.attachments || undefined;
  });
}

/** All items of the conversation at url (public shape, content not filled). */
async function getHighlightsByUrl(url) {
  if (!isContextValid()) return [];
  var doc = await readDoc(convKeyForUrl(url));
  return doc.items.map(toPublic);
}

/** Active children of a parent highlight (optionally only those made in one parent version). */
async function getChildHighlights(parentQuoteId, parentItemId) { // every version (records), grouped by the caller
  var items = await getHighlightsByUrl();
  return items.filter(function (h) {
    if (h.parentId !== parentQuoteId) return false;
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
function addDeletedTurns(url, turnKeys, link) { // link: { id, turnKeys } — that item's turns, set in the same write
  return modifyDoc(convKeyForUrl(url), function (doc) {
    (turnKeys || []).forEach(function (k) { if (k && doc.hidden.indexOf(k) === -1) doc.hidden.push(k); });
    var rec = link && doc.items.find(function (it) { return it.id === link.id; });
    if (rec) rec.turnKeys = link.turnKeys.filter(Boolean);
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
