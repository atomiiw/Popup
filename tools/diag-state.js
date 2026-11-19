// diag-state.js — testing only: refresh JR.diagnose and print what the live copy follows and the render frame's queue
// (python3 tools/chrome_js.py --url <conv> @tools/diag-state.js) — for a popup stuck on "Loading…".
(function(){var b=document.getElementById("jr-diagnostics-run"); if(b) b.click(); var d=document.getElementById("jr-diagnostics"); var j=JSON.parse(d.getAttribute("data-json")); return JSON.stringify({live:j.state.live, render:j.state.render, frames:document.querySelectorAll("iframe.jr-render-frame").length, v:j.version});})()
