// Runs the prototype's own seed code in a node vm and returns what it builds, for the three Spaces:
//   files:   the Files module's folder tree (N), the shared list, the home folder and the sidebar ids
//   records: the Records module's record types (TY, with the synced HubSpot, GitHub and site tables) and their rows (D rows live on TY[id].rows)
// The Files and Records scripts of scripts/shots/prototype/vyre-v1.html are cut at the end of their seed code and run with stubs for the page (window, document, location),
// so nothing here is a copy of the prototype's data: change the prototype, run this again, and the output follows.
// CLI: node scripts/shots/gen-prototype-seed.mjs [--write]   writes apps/app/src/fixtures/prototype-seed.generated.json (CI regen job; never run on the Mac).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROTO = path.join(HERE, "prototype", "vyre-v1.html");
export const OUT = path.join(HERE, "..", "..", "apps", "app", "src", "fixtures", "prototype-seed.generated.json");
export const SPACES = [["team", "nw"], ["harbor", "hb"], ["personal", "me"]];

/** The page's text with the HTML escapes inside its textareas undone. */
export function protoText() {
  return fs.readFileSync(PROTO, "utf8").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&amp;", "&");
}

/** Anything: callable, indexable, never throws. The page code touches the DOM only inside functions the seed does not call, but a few top-level statements do. */
function loose() {
  const f = function () { return loose(); };
  return new Proxy(f, {
    get: (_t, k) => (k === Symbol.toPrimitive ? () => "" : k === "length" ? 0 : k === "then" ? undefined : loose()),
    set: () => true, apply: () => loose(), construct: () => loose(), has: () => true,
  });
}

function stubs(space) {
  const ui = new Proxy(function () {}, { get: (_t, k) => (k === "space" ? () => space : k === "then" ? undefined : loose()), has: () => true });
  const win = { VyreUI: ui, name: "", addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), innerWidth: 1280, innerHeight: 800, localStorage: { getItem: () => null, setItem() {} } };
  return {
    VyreUI: ui, window: win, parent: win, self: win, location: { hash: "", search: "" }, navigator: { clipboard: loose(), userAgent: "node" },
    document: loose(), matchMedia: win.matchMedia, localStorage: win.localStorage, setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame: () => 0,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, getComputedStyle: () => loose(), setInterval: () => 0, clearInterval() {}, queueMicrotask() {},
    ...Object.fromEntries(["CSS", "performance", "crypto", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "MutationObserver", "ResizeObserver", "IntersectionObserver", "URL", "URLSearchParams", "Blob", "FileReader", "Image", "DOMParser", "fetch", "Audio", "Worker", "history", "screen", "sessionStorage", "indexedDB", "TextEncoder", "TextDecoder", "atob", "btoa", "structuredClone", "HTMLElement", "Node"].map((k) => [k, loose()])),
    innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
    console: { log() {}, warn() {}, error() {} }, Intl, Date, Math, JSON, Object, Array, Map, Set, Promise, RegExp, String, Number, Symbol, Error,
  };
}

/** The module script that starts with `startMarker` after the textarea `id`, up to `endMarker`, as one function body. */
function slice(text, textareaId, startMarker, endMarker, endAfter) {
  const at = text.indexOf(`<textarea hidden id="${textareaId}">`);
  if (at < 0) throw new Error(`no ${textareaId} in the prototype`);
  const from = text.indexOf(startMarker, at);
  if (from < 0) throw new Error(`no start marker in ${textareaId}`);
  const search = endAfter ? text.indexOf(endAfter, from) : from;
  if (search < 0) throw new Error(`no ${endAfter} in ${textareaId}`);
  const to = text.indexOf(endMarker, search);
  if (to < 0) throw new Error(`no end marker ${endMarker} in ${textareaId}`);
  return text.slice(from + startMarker.length, to);
}

function run(body, expose, space) {
  const base = stubs(space);
  base.ui = { member: false };
  // every name the page code uses that is not declared in the cut resolves here: the stubs, then the host's builtins, then a do-nothing stand-in
  const scope = new Proxy({}, {
    has: () => true,
    get: (_t, k) => (typeof k === "symbol" ? undefined : k in base ? base[k] : k in globalThis ? globalThis[k] : loose()),
    set: (_t, k, v) => { base[k] = v; return true; },
  });
  const code = `with (__scope) { (function () {\n"use strict";\n${body}\nreturn (${expose});\n})() }`;
  const ctx = vm.createContext({ __scope: scope });
  const out = vm.runInContext(code, ctx, { filename: "prototype-seed", timeout: 60000 });
  return JSON.parse(JSON.stringify(out));
}

export function runSeed() {
  const text = protoText();
  const filesBody = slice(text, "src-files", '<script>\n(function () {\n  "use strict";\n', "\n  /* ================= inboxfiles", "const SIDE_IDS");
  const recordsBody = slice(text, "src-records", '<script>\n(function () {\n  "use strict";\n', "\n  /* the signed-in person's grants");
  const out = {};
  for (const [key, short] of SPACES) {
    out[short] = {
      files: run(filesBody, "({ N, SHARED, HOME_ID, SIDE_IDS: SIDE_IDS() })", key),
      records: run(recordsBody, "({ TY, TYHUE, TYICON })", key),
    };
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes("--write")) {
  fs.writeFileSync(OUT, JSON.stringify(runSeed(), null, 1) + "\n");
  console.log("wrote", OUT);
}
