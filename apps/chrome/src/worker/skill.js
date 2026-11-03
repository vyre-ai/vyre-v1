// @ts-check
// A reviewed recording becomes a skill (prototype "Show it once"): SKILL.md in plain words, and replay.json, the same steps as a script of the agent browsing tools
// (chrome_open, chrome_snapshot, chrome_click, chrome_type, chrome_fill, chrome_act, chrome_wait). The skill carries no picture, no typed password and no value the person
// marked "Ask each time"; a sign-in is one step that sends the agent to the Vault. Pure: the worker saves what this returns through skills.mine.add.
//
// replay.json is data, not code, so the skill ships no script file and adding it needs no admin. The agent reads it top to bottom and makes the call each step names.

/** @typedef {{ role: string, name: string, tag?: string, type?: string, selector?: string }} Target */
/** @typedef {{ id: string, kind: "open" | "click" | "type" | "select" | "press" | "signin", url: string, host: string, target?: Target, value?: string, key?: string, ask?: boolean, secret?: boolean, at: number, shot?: string | null }} Step */
/** @typedef {{ key: string, label: string, example: string, mode: "ask" | "fixed" }} Input */
/** @typedef {{ id: string, name: string, startedAt: number, endedAt?: number, steps: Step[], inputs: Input[], by?: string, saved?: { skillId: string, name: string, agents: string[] } | null }} Recording */

export const REPLAY_VERSION = 1;

/** A label as a key: "Contact name" -> "contact_name". @param {string} s */
export const keyOf = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "value";

/** The skill's name as the format wants it: letters, digits and dashes. @param {string} s */
export function skillName(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "recorded-task";
}

/** @param {string} url */
function where(url) {
  try { const u = new URL(url); return `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`; } catch { return url; }
}
const q = (/** @type {string} */ s) => `"${String(s).replace(/"/g, "'")}"`;
const roleWord = (/** @type {string} */ r) => (r === "link" ? "link" : r === "button" ? "button" : r === "textbox" ? "field" : r || "item");

/**
 * The step in plain words. A typed value that the person asked for each time reads as {the input}; a fixed one reads as the value.
 * @param {Step} s @param {Recording["inputs"]} inputs
 */
export function words(s, inputs) {
  const t = s.target;
  const inp = s.key ? inputs.find((i) => i.key === s.key) : undefined;
  const val = s.secret ? `{${((inp && inp.label) || (t && t.name) || "value").toLowerCase()}}` : inp ? (inp.mode === "ask" ? `{${inp.label.toLowerCase()}}` : q(inp.example)) : s.value ? q(s.value) : "the text";
  switch (s.kind) {
    case "open": return `Open ${where(s.url)}`;
    case "click": return t && t.name ? `Click the ${roleWord(t.role)} ${q(t.name)}` : "Click";
    case "type": return `Type ${val} in ${t && t.name ? q(t.name) : "the field"}`;
    case "select": return `Choose ${val} in ${t && t.name ? q(t.name) : "the list"}`;
    case "press": return `Press ${s.value || "Enter"}`;
    case "signin": return `Sign in to ${s.host} with Vault`;
    default: return "Do a step";
  }
}

/**
 * The inputs of a recording: every typed or chosen value gets one, keyed by the label of its field. Two fields with the same label share a key made unique with a number.
 * Keeps the choices a reviewer already made. @param {Step[]} steps @param {Input[]} [prior]
 */
export function inputsOf(steps, prior = []) {
  /** @type {Input[]} */
  const out = [];
  const seen = new Set();
  for (const s of steps) {
    if ((s.kind !== "type" && s.kind !== "select") || s.value === undefined) continue;
    const secret = Boolean(s.secret);
    const label = (s.target && s.target.name) || "Value";
    let key = s.key || keyOf(label);
    if (!s.key) { let n = 2; const base = key; while (seen.has(key)) key = `${base}_${n++}`; s.key = key; }
    if (seen.has(key)) continue;
    seen.add(key);
    const was = prior.find((p) => p.key === key);
    // a card number or code has no example and is always asked for
    out.push({ key, label: was ? was.label : label, example: secret ? "" : was ? was.example : s.value, mode: secret ? "ask" : was ? was.mode : "ask" });
  }
  return out;
}

/** @param {Recording} rec */
function hostsOf(rec) {
  return [...new Set(rec.steps.map((s) => s.host).filter(Boolean))];
}

/**
 * The replay script: one entry per step, each naming the browsing tool and how to find the thing it acts on. Elements are found again by role and name in a fresh
 * chrome_snapshot, never by a saved ref. @param {Recording} rec
 */
export function replayOf(rec) {
  const steps = rec.steps.map((s, i) => {
    /** @type {Record<string, unknown>} */
    const e = { n: i + 1, say: words(s, rec.inputs) };
    if (s.ask) e["askFirst"] = true;
    const find = s.target && s.target.name ? { role: s.target.role, name: s.target.name } : undefined;
    if (s.kind === "open") { e["tool"] = "chrome_open"; e["args"] = { url: s.url }; }
    else if (s.kind === "click") { e["tool"] = "chrome_click"; if (find) e["find"] = find; }
    else if (s.kind === "type") { e["tool"] = "chrome_type"; if (find) e["find"] = find; const inp = rec.inputs.find((x) => x.key === s.key); if (inp && inp.mode === "ask") e["input"] = inp.key; else e["text"] = inp ? inp.example : s.value ?? ""; }
    else if (s.kind === "select") { e["tool"] = "chrome_act"; e["action"] = "select"; if (find) e["find"] = find; const inp = rec.inputs.find((x) => x.key === s.key); if (inp && inp.mode === "ask") e["input"] = inp.key; else e["text"] = inp ? inp.example : s.value ?? ""; }
    else if (s.kind === "press") { e["tool"] = "chrome_act"; e["action"] = "press"; e["text"] = s.value || "Enter"; }
    else { e["tool"] = "vault_signin"; e["host"] = s.host; }
    return e;
  });
  return { version: REPLAY_VERSION, name: skillName(rec.name), sites: hostsOf(rec), inputs: rec.inputs.map((i) => ({ key: i.key, label: i.label, mode: i.mode, ...(i.mode === "fixed" ? { value: i.example } : { example: i.example }) })), steps };
}

/**
 * SKILL.md and its files. @param {Recording} rec @returns {{ name: string, text: string, files: Record<string, string> }}
 */
export function buildSkill(rec) {
  const name = skillName(rec.name);
  const sites = hostsOf(rec);
  const asks = rec.inputs.filter((i) => i.mode === "ask");
  const title = String(rec.name || "Recorded task").trim().slice(0, 120);
  const desc = `${title.replace(/[\r\n]+/g, " ")}. Shown once in Chrome${sites.length ? ` on ${sites.join(", ")}` : ""}; repeat the same steps in a browser${asks.length ? `. Ask for ${asks.map((i) => i.label.toLowerCase()).join(", ")}` : ""}.`.slice(0, 600);
  const lines = rec.steps.map((s, i) => `${i + 1}. ${words(s, rec.inputs)}${s.ask ? " (ask the person first and wait for yes)" : ""}`);
  const text = [
    "---",
    `name: ${name}`,
    `description: ${JSON.stringify(desc)}`,
    "---",
    "",
    `# ${title}`,
    "",
    `A person did this once in Chrome and Vyre wrote it down. Do the same on the same ${sites.length > 1 ? "sites" : "site"}${sites.length ? ` (${sites.join(", ")})` : ""}.`,
    "",
    "## Steps",
    ...lines,
    "",
    ...(rec.inputs.length ? ["## Inputs", ...rec.inputs.map((i) => (i.mode === "ask" ? `- **${i.label}**: ask the person, or read it from the chat. It was ${q(i.example)} when shown.` : `- **${i.label}**: always ${q(i.example)}.`)), ""] : []),
    "## How to run it",
    "- `replay.json` has the same steps as a script. Go top to bottom. For each step make the tool call it names.",
    "- Use your own Chrome tools: `chrome_open` (reuse the tab, never one tab per step), then `chrome_snapshot` and find the element by its `role` and `name` in that fresh snapshot. Refs from an earlier look are never reused.",
    "- A step with `input` takes the value you were given for that input. A step with `text` types exactly that.",
    "- `vault_signin`: call `vault_use` for the login of that site, then `chrome_fill` its fields as `#Handle.username` and `#Handle.password`. Never ask for, read or type a password yourself. If the Vault has no login for the site, stop and say so.",
    "- `askFirst`: say what the step does and wait for a yes before you do it.",
    "- A send, post, payment or delete is held by Chrome. Say what is waiting; the person approves it.",
    "- If an element is not there or the page looks different, stop and say which step. Do not guess a nearby control.",
    "",
  ].join("\n");
  return { name, text, files: { "replay.json": `${JSON.stringify(replayOf(rec), null, 2)}\n` } };
}

/**
 * Take what the review page changed (a name, deleted steps, "ask before" marks, input modes and labels) and apply it to a recording. Returns a new recording.
 * @param {Recording} rec @param {{ name?: string, remove?: string[], ask?: Record<string, boolean>, inputs?: Record<string, { mode?: string, label?: string, example?: string }> }} edit
 * @returns {Recording}
 */
export function applyEdits(rec, edit) {
  const gone = new Set(edit.remove || []);
  const steps = rec.steps.filter((s) => !gone.has(s.id)).map((s) => ({ ...s, ...(edit.ask && s.id in edit.ask ? { ask: Boolean(edit.ask[s.id]) } : {}) }));
  const prior = rec.inputs.map((i) => {
    const e = edit.inputs && edit.inputs[i.key];
    return e ? { ...i, ...(e.mode === "ask" || e.mode === "fixed" ? { mode: /** @type {"ask" | "fixed"} */ (e.mode) } : {}), ...(typeof e.label === "string" && e.label.trim() ? { label: e.label.trim().slice(0, 60) } : {}), ...(typeof e.example === "string" ? { example: e.example.slice(0, 500) } : {}) } : i;
  });
  const out = { ...rec, steps, name: typeof edit.name === "string" && edit.name.trim() ? edit.name.trim().slice(0, 120) : rec.name };
  out.inputs = inputsOf(steps, prior);
  return out;
}
