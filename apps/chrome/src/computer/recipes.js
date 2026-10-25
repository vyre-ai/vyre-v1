// @ts-check
// Learned recipes (V1-SPEC 3.12 and 2.7, ARCH 7.12 and the computers detail): when a person records while they take over and chooses "work out the app's backend calls", the recording
// becomes a site recipe, a small .md note in the agent's recipes/ folder. The note holds the steps the person took and, for every backend call the page made, a call note: the method,
// the address with its changing parts as {names}, and the parameters by name and type. The agent reads the note and tries the direct call before it drives the page again.
// A note holds no value: parameters are names and types only, secret-named parameters say "from the Vault" and carry no example, every address loses its query values and every
// typed character is left out. Nothing here talks to a browser; saveRecipe writes through the agent session.

import { isSecretName, maskText, scrub } from "../agent/mask.js";
import { hostUnder } from "../worker/match.js";

const MAX_STEPS = 60;
const MAX_CALLS = 30;
const SITE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;

/**
 * What a recording sheet hands over (events.jsonl and network.har reduced to what a recipe needs).
 * @typedef {{ kind: "navigate" | "click" | "key" | "type" | "select", url?: string, role?: string, name?: string, key?: string }} RecordedStep
 * @typedef {{ method: string, url: string, status: number, type?: string, mime?: string, body?: string, ms?: number }} RecordedCall
 * @typedef {{ id: string, site: string, startedAt: number, steps: RecordedStep[], calls: RecordedCall[] }} Recording
 */

/** The recipe file name for a site: the host, lower case. Throws on anything that is not a host name. @param {string} site */
export function recipeName(site) {
  const host = String(site).trim().toLowerCase().replace(/\.$/, "");
  if (!SITE.test(host) || host.includes("..")) throw new Error(`"${site}" is not a site name`);
  return `${host}.md`;
}

/** @param {string} segment */
const changing = (segment) => /^\d{2,}$/.test(segment) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) || /^[A-Za-z0-9_-]{20,}$/.test(segment) || /^[a-z]{2,5}_[a-z0-9]{6,}$/.test(segment);

/**
 * An address as a call template: origin, then the path with each changing part named {id}, {id2}..., and the query keys as parameters (values dropped).
 * @param {string} u @returns {{ template: string, host: string, query: string[] } | null}
 */
export function callTemplate(u) {
  /** @type {URL} */
  let x;
  try { x = new URL(u); } catch { return null; }
  if (x.protocol !== "https:" && x.protocol !== "http:") return null;
  let n = 0;
  const path = x.pathname.split("/").map((s) => (s && changing(s) ? (n++ === 0 ? "{id}" : `{id${n}}`) : s)).join("/");
  return { template: `${x.protocol}//${x.host}${path}`, host: x.hostname.toLowerCase(), query: [...new Set([...x.searchParams.keys()])].sort() };
}

/** @param {unknown} v @returns {string} */
function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "list";
  return typeof v === "object" ? "object" : typeof v;
}

/**
 * Parameter names and types from a JSON or form body; never values. Nested objects are listed as dotted names to two levels.
 * @param {string | undefined} body @param {string | undefined} mime @returns {{ name: string, type: string, secret: boolean }[]}
 */
export function paramsOf(body, mime) {
  if (!body) return [];
  /** @type {{ name: string, type: string, secret: boolean }[]} */
  const out = [];
  /** @param {unknown} v @param {string} prefix @param {number} depth */
  const walk = (v, prefix, depth) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return;
    for (const [k, x] of Object.entries(v)) {
      const name = prefix ? `${prefix}.${k}` : k;
      out.push({ name, type: typeOf(x), secret: isSecretName(k) });
      if (depth < 1) walk(x, name, depth + 1);
    }
  };
  if (/x-www-form-urlencoded/i.test(mime ?? "")) {
    for (const k of new URLSearchParams(body).keys()) out.push({ name: k, type: "string", secret: isSecretName(k) });
  } else {
    try { walk(JSON.parse(body), "", 0); } catch { /* not JSON: no parameters to name */ }
  }
  const seen = new Set();
  return out.filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true))).slice(0, 40);
}

/** One recorded step as a line of words. Typed text and keys' values are never recorded, so there is none to leave out. @param {RecordedStep} s @returns {string} */
function stepLine(s) {
  const target = s.name ? ` ${s.role ?? "element"} "${scrub(s.name)}"` : s.role ? ` ${s.role}` : "";
  switch (s.kind) {
    case "navigate": return `Open ${scrub(s.url ?? "")}`;
    case "click": return `Click${target || " the element"}`;
    case "type": return `Type into${target || " the field"} (a value from the Vault or the task, never written here)`;
    case "select": return `Choose an option in${target || " the list"}`;
    case "key": return `Press ${scrub(s.key ?? "a key")}`;
    default: return "Do a step";
  }
}

/**
 * The call notes of a recording: XHR and fetch calls to the site that worked (2xx), one per method and address template, in the order first made.
 * @param {Recording} rec
 */
export function callNotes(rec) {
  const site = rec.site.toLowerCase();
  /** @type {Map<string, { method: string, template: string, query: string[], params: { name: string, type: string, secret: boolean }[], status: number, ms?: number }>} */
  const found = new Map();
  for (const c of rec.calls) {
    if (c.type && c.type !== "XHR" && c.type !== "Fetch") continue;
    if (!(c.status >= 200 && c.status < 300)) continue;
    const t = callTemplate(c.url);
    if (!t || !hostUnder(t.host, site)) continue;
    const key = `${c.method.toUpperCase()} ${t.template}`;
    if (found.has(key)) continue;
    found.set(key, { method: c.method.toUpperCase(), template: t.template, query: t.query, params: paramsOf(c.body, c.mime), status: c.status, ...(c.ms !== undefined ? { ms: c.ms } : {}) });
    if (found.size >= MAX_CALLS) break;
  }
  return [...found.values()];
}

/**
 * The recipe note for a recording: where it goes (recipes/<site>.md) and its markdown.
 * @param {Recording} rec @param {{ now?: () => number, source?: string }} [o]
 * @returns {{ name: string, path: string, markdown: string, calls: number, steps: number }}
 */
export function recipeNote(rec, o = {}) {
  const name = recipeName(rec.site);
  const day = new Date((o.now ?? Date.now)()).toISOString().slice(0, 10);
  const steps = rec.steps.slice(0, MAX_STEPS).map(stepLine);
  const calls = callNotes(rec);
  const lines = [
    "---",
    "kind: site-recipe",
    `site: ${rec.site.toLowerCase()}`,
    `learned: ${day}`,
    `source: ${o.source ?? `work/recordings/${rec.id}`}`,
    "---",
    `# ${rec.site.toLowerCase()}`,
    "",
    "Learned from a recording. Try the backend calls first; drive the page only when a call fails or is missing. Secrets come from the Vault by handle and are never written in this note.",
    "",
    "## Steps",
    ...(steps.length ? steps.map((s, i) => `${i + 1}. ${s}`) : ["(none recorded)"]),
    "",
    "## Backend calls",
  ];
  if (!calls.length) lines.push("(none seen)");
  for (const c of calls) {
    lines.push("", `### ${c.method} ${c.template}`, `- Worked in the recording (${c.status}${c.ms !== undefined ? `, ${c.ms} ms` : ""}).`);
    if (c.query.length) lines.push(`- Query: ${c.query.join(", ")}`);
    if (c.params.length) {
      lines.push("- Parameters:");
      for (const p of c.params) lines.push(`  - ${p.name} (${p.type})${p.secret ? ": from the Vault by handle" : ""}`);
    } else lines.push("- Parameters: none in the body.");
  }
  lines.push("");
  const markdown = maskText(lines.join("\n"));
  return { name, path: `recipes/${name}`, markdown, calls: calls.length, steps: steps.length };
}

/**
 * Write the note into the agent's recipes folder: a new file, or the new version of the file the site already has.
 * @param {{ recipesFolderId: string, invoke(capability: string, input?: Record<string, any>): Promise<any> }} session
 * @param {ReturnType<typeof recipeNote>} note @param {{ recordingId: string }} meta
 * @returns {Promise<{ path: string, created: boolean, fileId: string }>}
 */
export async function saveRecipe(session, note, meta) {
  const listed = await session.invoke("files.list", { folder: session.recipesFolderId });
  const files = Array.isArray(listed && listed.files) ? listed.files : [];
  const have = files.find((/** @type {any} */ f) => f && f.name === note.name);
  if (have && typeof have.id === "string") {
    await session.invoke("files.write", { fileId: have.id, content: note.markdown, reason: `Recipe relearned from ${meta.recordingId}` });
    return { path: note.path, created: false, fileId: have.id };
  }
  const made = await session.invoke("files.create", { folderId: session.recipesFolderId, name: note.name, content: note.markdown, mime: "text/markdown", kind: "file", idempotencyKey: `recipe-${note.name}-${meta.recordingId}` });
  const id = made && (made.file && made.file.id ? made.file.id : made.id);
  return { path: note.path, created: true, fileId: typeof id === "string" ? id : "" };
}
