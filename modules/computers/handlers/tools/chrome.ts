// The Chrome tools of an agent computer (spec 2.7; Vyre for Chrome signed in as the agent): read a page as a tree with refs, act, type, fill, open, tabs, wait, screenshot, eval, console, net, inspect,
// state, status, stop, resume, send, batch, plan, api, sources. Each is a request to agentd (common.ts); what this file adds is what must hold before the request leaves and the shape of the answer.
//
// Held items: agentd holds a send, a post or a payment instead of doing it and answers `heldId`. Only chrome_send releases it, and that capability is behind the Gate (the person approves).
// chrome_batch therefore refuses every tool the Gate or the risk class would treat differently from a plain step (send, api, eval, batch itself, stop, resume): a batch can never do what its parts
// could not do alone. #Handle.field references go to agentd untouched; it substitutes them on the computer and reports the values it used, which are scrubbed from every answer (common.ts).
import { maskValue } from "../record.ts";
import { raise } from "../../projections.ts";
import type { CompCtx } from "../../projections.ts";
import { call, clip, defined, keepShot, prepare, run, shape, siteOf } from "./common.ts";
import type { ToolAnswer, ToolArgs, ToolSpec } from "./common.ts";

interface Base { computerId?: string | undefined; tabId?: string | undefined }
const HTTP = /^https?:\/\//i;
const needRef = (ctx: CompCtx, ref: unknown, what: string): string => {
  if (typeof ref !== "string" || ref.trim() === "") raise(ctx, "validation.bad_input", `Name the element to ${what}: use a ref from chrome_snapshot.`);
  return ref;
};
const held = (out: ToolAnswer, done: string): string => (typeof out["heldId"] === "string" ? `Waiting for approval: ${done}` : done);

// ---- reading

export async function snapshot(ctx: CompCtx, input: Base & { selector?: string; format?: "tree" | "text" }) {
  const out = await run(ctx, input, { name: "chrome_snapshot", caption: null }, defined({ tabId: input.tabId, selector: input.selector, format: input.format }));
  return shape(ctx, "chrome_snapshot", out, { url: "s", title: "s", tree: "s", truncated: "b" });
}

export async function screenshot(ctx: CompCtx, input: Base & { ref?: string; fullPage?: boolean }) {
  const spec: ToolSpec = { name: "chrome_screenshot", caption: null };
  const r = await prepare(ctx, input.computerId, spec);
  if (!r) raise(ctx, "validation.bad_input", "The computer is asleep.");
  const out = await call(ctx, r, spec, defined({ tabId: input.tabId, ref: input.ref, fullPage: input.fullPage }));
  return keepShot(ctx, r.computer, "chrome_screenshot", out);
}

export async function consoleMessages(ctx: CompCtx, input: Base & { level?: string; limit?: number }) {
  const out = await run(ctx, input, { name: "chrome_console", caption: null }, defined({ tabId: input.tabId, level: input.level, limit: input.limit }));
  return shape(ctx, "chrome_console", out, { messages: "a" });
}

export async function net(ctx: CompCtx, input: Base & { filter?: string; bodies?: boolean; limit?: number }) {
  const out = await run(ctx, input, { name: "chrome_net", caption: null }, defined({ tabId: input.tabId, filter: input.filter, bodies: input.bodies, limit: input.limit }));
  const got = shape(ctx, "chrome_net", out, { requests: "a" });
  // Bodies are masked by key (a token in a JSON body) on top of the scrub of known Vault values; a body that is not JSON passes the scrub only.
  got["requests"] = (got["requests"] as unknown[]).map((q) => {
    if (typeof q !== "object" || q === null) return q;
    const r = { ...(q as Record<string, unknown>) };
    if (input.bodies !== true) delete r["body"];
    else if (typeof r["body"] === "string") {
      try { r["body"] = JSON.stringify(maskValue(JSON.parse(r["body"]))); } catch { /* not JSON */ }
    }
    return r;
  });
  return got;
}

export async function inspect(ctx: CompCtx, input: Base & { ref: string }) {
  const out = await run(ctx, input, { name: "chrome_inspect", caption: null }, defined({ tabId: input.tabId, ref: needRef(ctx, input.ref, "inspect") }));
  return shape(ctx, "chrome_inspect", out, { element: "o" });
}

export async function state(ctx: CompCtx, input: Base) {
  const out = await run(ctx, input, { name: "chrome_state", caption: null }, defined({ tabId: input.tabId }));
  return shape(ctx, "chrome_state", out, { url: "s", title: "s", loading: "b" });
}

/** Does not wake a sleeping computer: asleep means no browser, so nothing is connected and nothing is held. */
export async function status(ctx: CompCtx, input: Base) {
  const out = await run(ctx, input, { name: "chrome_status", caption: null, noWake: true, duringTakeover: true, asleep: { connected: false, paused: false, held: [] } }, {});
  const got = shape(ctx, "chrome_status", out, { connected: "b", paused: "b", held: "a" });
  got["held"] = (got["held"] as unknown[]).filter((x): x is string => typeof x === "string");
  return got;
}

export async function sources(ctx: CompCtx, input: Base) {
  const out = await run(ctx, input, { name: "chrome_sources", caption: null }, defined({ tabId: input.tabId }));
  return shape(ctx, "chrome_sources", out, { scripts: "a", endpoints: "a" });
}

// ---- acting

const DID: Readonly<Record<string, string>> = {
  click: "Clicked", double_click: "Double-clicked", hover: "Hovered over", press: "Pressed", select: "Selected in", scroll: "Scrolled", check: "Checked", uncheck: "Unchecked", focus: "Focused",
};

export async function act(ctx: CompCtx, input: Base & { ref?: string; action: string; value?: string }) {
  const keyOrScroll = input.action === "press" || input.action === "scroll";
  const ref = keyOrScroll ? input.ref : needRef(ctx, input.ref, input.action.replace("_", " "));
  if ((input.action === "press" || input.action === "select") && (input.value === undefined || input.value === "")) raise(ctx, "validation.bad_input", `${input.action === "press" ? "Name the key to press" : "Name the option to select"}.`);
  const spec: ToolSpec = { name: "chrome_act", caption: (a, o) => held(o, `${DID[input.action] ?? input.action} ${a["ref"] ? `element ${clip(a["ref"], 20)}` : input.action === "press" ? clip(input.value, 30) : "the page"}`.trim()) };
  const out = await run(ctx, input, spec, defined({ tabId: input.tabId, ref, action: input.action, value: input.value }));
  return shape(ctx, "chrome_act", out, { ok: "b", heldId: "s?", snapshot: "s?" });
}

export async function click(ctx: CompCtx, input: Base & { ref?: string; x?: number; y?: number; button?: string }) {
  const byRef = typeof input.ref === "string" && input.ref !== "";
  const byXY = Number.isInteger(input.x) && Number.isInteger(input.y);
  if (!byRef && !byXY) raise(ctx, "validation.bad_input", "Name the element by ref, or give x and y.");
  if (byXY && ((input.x as number) < 0 || (input.y as number) < 0)) raise(ctx, "validation.bad_input", "x and y are inside the page: zero or more.");
  const spec: ToolSpec = { name: "chrome_click", caption: (a, o) => held(o, byRef ? `Clicked element ${clip(a["ref"], 20)}` : `Clicked at ${String(a["x"])}, ${String(a["y"])}`) };
  const out = await run(ctx, input, spec, defined({ tabId: input.tabId, ref: byRef ? input.ref : undefined, x: byRef ? undefined : input.x, y: byRef ? undefined : input.y, button: input.button }));
  return shape(ctx, "chrome_click", out, { ok: "b", heldId: "s?" });
}

export async function type(ctx: CompCtx, input: Base & { ref?: string; text: string; submit?: boolean }) {
  if (typeof input.text !== "string") raise(ctx, "validation.bad_input", "Give the text to type.");
  if (input.text.length > 20_000) raise(ctx, "validation.bad_input", "That is too much to type in one call.");
  // The caption never carries the text: it may be a secret or a #Handle.field the computer is about to fill.
  const spec: ToolSpec = { name: "chrome_type", caption: (a, o) => held(o, `${a["submit"] === true ? "Typed and submitted" : "Typed"}${a["ref"] ? ` into element ${clip(a["ref"], 20)}` : ""}`) };
  const out = await run(ctx, input, spec, defined({ tabId: input.tabId, ref: input.ref, text: input.text, submit: input.submit }));
  return shape(ctx, "chrome_type", out, { ok: "b", heldId: "s?" });
}

export async function fill(ctx: CompCtx, input: Base & { fields: Array<{ ref: string; value: string }> }) {
  if (!Array.isArray(input.fields) || input.fields.length === 0) raise(ctx, "validation.bad_input", "Give at least one field to fill.");
  if (input.fields.length > 100) raise(ctx, "validation.bad_input", "That is too many fields for one call.");
  for (const f of input.fields) {
    needRef(ctx, f.ref, "fill");
    if (typeof f.value !== "string") raise(ctx, "validation.bad_input", "Every field needs a value.");
  }
  const spec: ToolSpec = { name: "chrome_fill", caption: (_a, o) => `Filled ${Number(o["filled"] ?? 0)} ${Number(o["filled"] ?? 0) === 1 ? "field" : "fields"}` };
  const out = await run(ctx, input, spec, defined({ tabId: input.tabId, fields: input.fields }));
  return shape(ctx, "chrome_fill", out, { ok: "b", filled: "n" });
}

export async function open(ctx: CompCtx, input: { computerId?: string | undefined; url: string; newTab?: boolean }) {
  if (typeof input.url !== "string" || !HTTP.test(input.url)) raise(ctx, "validation.bad_input", "Open an http or https address.");
  const spec: ToolSpec = { name: "chrome_open", caption: (a) => `Opened ${siteOf(a["url"])}`, timeoutMs: 60_000 };
  const out = await run(ctx, input, spec, defined({ url: input.url, newTab: input.newTab }));
  return shape(ctx, "chrome_open", out, { tabId: "s", url: "s", title: "s" });
}

export async function tabs(ctx: CompCtx, input: Base & { action: "list" | "use" | "new" | "close"; url?: string }) {
  if ((input.action === "use" || input.action === "close") && !input.tabId) raise(ctx, "validation.bad_input", `Name the tab to ${input.action}.`);
  if (input.url !== undefined && !HTTP.test(input.url)) raise(ctx, "validation.bad_input", "A new tab opens an http or https address.");
  const words: Record<string, string> = { use: "Switched tab", new: "Opened a new tab", close: "Closed a tab" };
  const spec: ToolSpec = { name: "chrome_tabs", caption: input.action === "list" ? null : () => words[input.action] ?? "Changed tabs" };
  const out = await run(ctx, input, spec, defined({ action: input.action, tabId: input.tabId, url: input.url }));
  const got = shape(ctx, "chrome_tabs", out, { tabs: "a" });
  got["tabs"] = (got["tabs"] as unknown[]).map((t) => shape(ctx, "chrome_tabs", t as ToolAnswer, { tabId: "s", url: "s", title: "s", active: "b" }));
  return got;
}

export async function wait(ctx: CompCtx, input: Base & { until: string; value?: string; timeoutMs?: number }) {
  if ((input.until === "text" || input.until === "selector") && !input.value) raise(ctx, "validation.bad_input", `Say which ${input.until} to wait for.`);
  if (input.until === "time" && !(Number(input.value) >= 0 && Number(input.value) <= 120_000)) raise(ctx, "validation.bad_input", "Waiting for a time takes milliseconds, up to 120000, as the value.");
  const limit = input.timeoutMs ?? 30_000;
  const what: Record<string, string> = { load: "the page to load", text: "text", selector: "an element", network_idle: "the network to settle", time: "a moment" };
  const out = await run(ctx, input, { name: "chrome_wait", caption: () => `Waited for ${what[input.until] ?? input.until}`, timeoutMs: limit + 5_000 }, defined({ tabId: input.tabId, until: input.until, value: input.value, timeoutMs: limit }));
  return shape(ctx, "chrome_wait", out, { ok: "b", waitedMs: "n" });
}

export async function evaluate(ctx: CompCtx, input: Base & { expression: string }) {
  if (typeof input.expression !== "string" || input.expression.trim() === "") raise(ctx, "validation.bad_input", "Give the expression to run.");
  if (input.expression.length > 20_000) raise(ctx, "validation.bad_input", "That expression is too long.");
  const out = await run(ctx, input, { name: "chrome_eval", caption: () => "Ran a script in the page" }, defined({ tabId: input.tabId, expression: input.expression }));
  return shape(ctx, "chrome_eval", out, { result: "j" });
}

export async function plan(ctx: CompCtx, input: { computerId?: string | undefined; goal: string; steps?: string[] }) {
  if (typeof input.goal !== "string" || input.goal.trim() === "") raise(ctx, "validation.bad_input", "Say what the plan is for.");
  const out = await run(ctx, input, { name: "chrome_plan", caption: () => `Plan: ${clip(input.goal, 120)}` }, defined({ goal: input.goal.slice(0, 500), steps: input.steps?.slice(0, 30).map((s) => String(s).slice(0, 300)) }));
  return shape(ctx, "chrome_plan", out, { ok: "b" });
}

// ---- stop, resume, send

export async function stop(ctx: CompCtx, input: { computerId?: string | undefined; reason?: string }) {
  const out = await run(ctx, input, { name: "chrome_stop", caption: () => "Stopped the browser", noWake: true, duringTakeover: true, asleep: { stopped: true } }, defined({ reason: input.reason?.slice(0, 300) }));
  return shape(ctx, "chrome_stop", out, { stopped: "b" });
}

export async function resume(ctx: CompCtx, input: { computerId?: string | undefined }) {
  const out = await run(ctx, input, { name: "chrome_resume", caption: () => "Resumed the browser", noWake: true, asleep: { resumed: false } }, {});
  return shape(ctx, "chrome_resume", out, { resumed: "b" });
}

/** Releases what agentd held. The Gate has already asked the person (the capability is `outward`, gate "send"); this only does it. */
export async function send(ctx: CompCtx, input: { computerId?: string | undefined; heldId: string }) {
  if (typeof input.heldId !== "string" || input.heldId === "") raise(ctx, "validation.bad_input", "Give the id of the held item.");
  const out = await run(ctx, input, { name: "chrome_send", caption: () => "Sent what was waiting for approval", timeoutMs: 60_000 }, { heldId: input.heldId });
  return shape(ctx, "chrome_send", out, { sent: "b", taskId: "s?" });
}

// ---- api

const SENSITIVE_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-csrf-token|x-xsrf-token)$/i;

/** A call to the site's own backend with this browser's session. The Gate already held a non-GET call. The answer keeps no credential the site sent back. */
export async function api(ctx: CompCtx, input: { computerId?: string | undefined; method: string; url: string; headers?: Record<string, string>; body?: unknown }) {
  if (typeof input.url !== "string" || !HTTP.test(input.url)) raise(ctx, "validation.bad_input", "Call an http or https address.");
  if (input.method === "GET" && input.body !== undefined) raise(ctx, "validation.bad_input", "A GET call has no body.");
  const out = await run(ctx, input, { name: "chrome_api", caption: (a) => `Called ${String(a["method"])} ${siteOf(a["url"])}`, timeoutMs: 60_000 }, defined({ method: input.method, url: input.url, headers: input.headers, body: input.body }));
  const got = shape(ctx, "chrome_api", out, { status: "n", headers: "o", body: "j" });
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(got["headers"] as Record<string, unknown>)) headers[k] = SENSITIVE_HEADER.test(k) ? "[masked]" : String(v);
  got["headers"] = headers;
  got["body"] = maskValue(got["body"]);
  return got;
}

// ---- batch

type StepFn = (ctx: CompCtx, input: any) => Promise<unknown>;
/** What a batch may run. Not here on purpose: send and api (Gate), eval (high risk, audited), stop and resume (control), batch (no nesting). */
const BATCHABLE: Readonly<Record<string, StepFn>> = {
  snapshot, act, click, type, fill, open, tabs, wait, screenshot, console: consoleMessages, net, inspect, state, plan, sources,
};

const messageOf = (e: unknown): string => {
  const shaped = e as { error?: { message?: string } } | null;
  return (shaped?.error?.message ?? (e instanceof Error ? e.message : "The step failed.")).slice(0, 300);
};

export async function batch(ctx: CompCtx, input: Base & { steps: Array<{ tool: string; args: Record<string, unknown> }> }) {
  if (!Array.isArray(input.steps) || input.steps.length === 0) raise(ctx, "validation.bad_input", "Give at least one step.");
  if (input.steps.length > 50) raise(ctx, "validation.bad_input", "A batch has at most 50 steps.");
  const named = input.steps.map((s) => String(s.tool).replace(/^computers\.chrome\./, "").replace(/^chrome_/, ""));
  for (const n of named) {
    if (!Object.hasOwn(BATCHABLE, n)) raise(ctx, "validation.bad_input", `chrome_batch cannot run "${n}". It runs ${Object.keys(BATCHABLE).join(", ")}.`, { tool: n });
  }
  // The first step wakes the computer and settles who it is for; the rest run against it.
  const results: Array<{ tool: string; ok: boolean; result?: unknown; heldId?: string }> = [];
  for (let i = 0; i < input.steps.length; i++) {
    const name = named[i] as string;
    const args: ToolArgs = { ...(input.steps[i]?.args ?? {}) };
    delete args["computerId"];
    const stepInput = { ...args, ...(input.computerId ? { computerId: input.computerId } : {}), ...(input.tabId && args["tabId"] === undefined ? { tabId: input.tabId } : {}) };
    try {
      const result = (await (BATCHABLE[name] as StepFn)(ctx, stepInput)) as Record<string, unknown>;
      const heldId = typeof result?.["heldId"] === "string" ? result["heldId"] : undefined;
      results.push({ tool: name, ok: true, result, ...(heldId ? { heldId } : {}) });
      if (heldId) break;
    } catch (e) {
      results.push({ tool: name, ok: false, result: { error: messageOf(e) } });
      break;
    }
  }
  return { results };
}
