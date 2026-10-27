// load-smoke.js — run every content script in manifest order inside JavaScriptCore
// against a stub browser, to catch load-time exceptions (e.g. using JR.perf
// before it is defined). Not a functional test.
// Usage: osascript -l JavaScript tools/load-smoke.js /path/to/Popup
ObjC.import('Foundation');
function read(p) { return $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null).js; }
function run(argv) {
  var root = argv[0];
  var manifest = JSON.parse(read(root + '/manifest.json'));
  // Universal stub: callable, any property is another stub, usable as a value.
  function stub() {
    var f = function () { return p; };
    var p = new Proxy(f, {
      get: function (t, k) {
        if (k === Symbol.toPrimitive) return function () { return 0; };
        if (k === 'then') return undefined;          // not a thenable
        if (k === 'length') return 0;
        if (k === 'isConnected') return false;
        // DOM traversal ends immediately (otherwise "walk up parentElement" loops forever)
        if (/^(parentElement|parentNode|firstChild|lastChild|nextSibling|previousSibling|firstElementChild|nextElementSibling|activeElement|offsetParent)$/.test(k)) return null;
        if (/^(querySelector|closest|getElementById|matches|getAttribute|contains|hasAttribute)$/.test(k)) return function () { return null; };
        if (/^(querySelectorAll|getElementsByTagName|getEntries)$/.test(k)) return function () { return []; };
        return stub();
      },
      apply: function () { return stub(); },
      construct: function () { return stub(); },
    });
    return p;
  }
  var g = {
    document: stub(), location: { href: 'https://chatgpt.com/c/00000000-0000-0000-0000-000000000000', pathname: '/c/00000000-0000-0000-0000-000000000000', hash: '' },
    chrome: { runtime: { id: 'x', getManifest: function () { return manifest; } },
              storage: { local: { get: function () { return Promise.resolve({}); }, set: function () { return Promise.resolve(); }, remove: function () { return Promise.resolve(); }, getBytesInUse: function () {} },
                         onChanged: { addListener: function () {} } } },
    history: { pushState: function () {}, replaceState: function () {} },
    navigator: { onLine: true }, performance: { now: function () { return Date.now(); } },
    setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; },
    requestAnimationFrame: function () { return 0; }, cancelAnimationFrame: function () {},
    MutationObserver: function () { return { observe: function () {}, disconnect: function () {} }; },
    ResizeObserver: function () { return { observe: function () {}, disconnect: function () {} }; },
    PerformanceObserver: function () { return { observe: function () {} }; },
    getComputedStyle: stub(), CustomEvent: function () {}, Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    NodeFilter: { SHOW_TEXT: 4, SHOW_ELEMENT: 1, FILTER_ACCEPT: 1, FILTER_SKIP: 3 },
    Element: function () {}, InputEvent: function () {}, KeyboardEvent: function () {}, Event: function () {},
    crypto: { randomUUID: function () { return 'id'; } }, console: { log: function () {}, warn: function () {}, error: function () {} },
  };
  g.window = g; g.Element.prototype = {}; g.addEventListener = function () {}; g.removeEventListener = function () {};
  var out = [];
  var names = Object.keys(g);
  // Scripts of one content_scripts entry share one global scope (as in Chrome),
  // so run each entry as one function; each file is wrapped to report its own error.
  // Scripts of one content_scripts entry share one global scope (as in Chrome):
  // each file is eval'd inside the same function, so its top-level declarations
  // (including async functions) stay visible to the files after it.
  // Chrome runs all scripts of a world in one global scope, so install the stubs
  // as globals and eval each file globally: top-level declarations (including
  // async functions) stay visible to the files after it, as in the extension.
  var G = (0, eval)('this');
  names.forEach(function (n) { if (n !== 'window') G[n] = g[n]; });
  G.window = G; // in a page, window is the global object
  manifest.content_scripts.forEach(function (cs) {
    (cs.js || []).forEach(function (file) {
      try { (0, eval)(read(root + '/' + file)); out.push('ok   ' + file); }
      catch (e) { out.push('FAIL ' + file + ' :: ' + e); }
    });
  });
  return out.join('\n');
}
