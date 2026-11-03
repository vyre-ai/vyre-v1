// The models a subscription can use, asked of the vendor's own CLI the way the vendor's own app asks it, run as the person's engine (their sandbox, their sign-in through the Vault fill).
// Nothing here is a list Vyre keeps: what the CLI answers is what the menu shows, a model Vyre has never heard of included, named the way the vendor names it.
//
//   Codex 0.166.0   `codex app-server`, JSON-RPC over stdio: initialize, initialized, then model/list {includeHidden: false} (paged by nextCursor). Each model carries id, displayName, isDefault,
//                   supportedReasoningEfforts [{reasoningEffort}] and defaultReasoningEffort. Signed in with ChatGPT it asks chatgpt.com for the account's list and keeps it in
//                   $CODEX_HOME/models_cache.json; signed out it answers from the catalog built into the binary. RECORDED on box B with the pinned binary, signed out (3 Nov 2026).
//   Claude Code     `claude -p --input-format stream-json --output-format stream-json --verbose`, then the control request {subtype: "initialize"} the Agent SDK sends: its answer's `models` is
//   2.1.316         the /model picker, each row {value (the alias: default, opus, sonnet, haiku, fable, ...), resolvedModel (the id it means today), displayName, description ("Opus 5.5 ·
//                   ..."), supportedEffortLevels}. Signed in, the CLI has already merged what the account's plan offers (its bootstrap call and served catalog) into that list.
//                   RECORDED on box B with the pinned binary, signed out (3 Nov 2026).
//   Grok 1.0.70     `grok models`: plain text, "Default model: <id>" then "  * <id> (default)" and "  - <id>" lines. It reads the account's list when signed in (~/.grok/models_cache.json).
//                   RECORDED on box B with the pinned binary, signed out (3 Nov 2026).
import { lines } from "./lines.ts";
import type { CliId, Launcher } from "./types.ts";

/** One model as the vendor's CLI listed it. `id` is what Vyre passes to the CLI's --model; `alias` is the CLI's own name that keeps resolving to the newest (Claude Code's opus, sonnet). */
export interface LiveModel {
  id: string;
  /** The vendor's own name for it ("GPT-6.1-Sol", "Opus 5.5"). */
  title: string;
  alias?: string;
  /** The model the vendor's app picks when the person has not. */
  isDefault?: boolean;
  /** Reasoning-effort levels the vendor offers for it, in its words (low, medium, high, xhigh, max, ...). */
  efforts?: string[];
  defaultEffort?: string;
}

/** A talk with the CLI: what to start, what to write first, and what each output line means. `done` with a list ends the talk; `send` writes more (the next page). */
export interface ModelDialog {
  argv: readonly string[];
  /** Fixed environment of the run (switches that keep the CLI quiet). */
  env?: Readonly<Record<string, string>>;
  start: readonly string[];
  push(line: string): { send?: string[]; done?: LiveModel[]; fail?: string } | null;
  /** The output ended: the list, when the CLI's answer is the whole of its output (Grok). */
  end(): LiveModel[] | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const json = (line: string): Record<string, unknown> | null => { try { const v: unknown = JSON.parse(line); return isObj(v) ? v : null; } catch { return null; } };
const rpc = (o: Record<string, unknown>): string => `${JSON.stringify({ jsonrpc: "2.0", ...o })}\n`;
const efforts = (v: unknown, key?: string): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((e) => (key && isObj(e) ? text(e[key]) : text(e))).filter((e) => e !== "");
  return out.length > 0 ? out : undefined;
};

/** Codex: one model of model/list. Hidden models (kept for old threads) are not offered. */
export function codexModel(m: unknown): LiveModel | null {
  if (!isObj(m) || m["hidden"] === true) return null;
  const id = text(m["model"]) || text(m["id"]);
  if (id === "") return null;
  const e = efforts(m["supportedReasoningEfforts"], "reasoningEffort");
  const d = text(m["defaultReasoningEffort"]);
  return { id, title: text(m["displayName"]) || id, ...(m["isDefault"] === true ? { isDefault: true } : {}), ...(e ? { efforts: e } : {}), ...(d ? { defaultEffort: d } : {}) };
}

const PAGES = 8;
export function codexDialog(): ModelDialog {
  const got: LiveModel[] = [];
  let next = 2, pages = 0;
  const ask = (cursor?: string): string => rpc({ id: next, method: "model/list", params: { includeHidden: false, ...(cursor ? { cursor } : {}) } });
  return {
    argv: ["codex", "app-server"],
    start: [rpc({ id: 1, method: "initialize", params: { clientInfo: { name: "vyre", title: "Vyre", version: "1" }, capabilities: null } }), rpc({ method: "initialized" }), ask()],
    push(line) {
      const j = json(line);
      if (!j || j["id"] !== next) return null;
      if (isObj(j["error"])) return { fail: text(j["error"]["message"]) || "Codex did not list its models." };
      const r = j["result"];
      if (!isObj(r) || !Array.isArray(r["data"])) return { fail: "Codex answered model/list with something else." };
      for (const m of r["data"]) { const one = codexModel(m); if (one && !got.some((g) => g.id === one.id)) got.push(one); }
      const cursor = text(r["nextCursor"]);
      pages += 1;
      if (cursor === "" || pages >= PAGES) return { done: got };
      next += 1;
      return { send: [ask(cursor)] };
    },
    end: () => null,
  };
}

/** Claude Code names the model an alias means first in the row's description ("Opus 5.5 · Best for ..."). */
function claudeName(row: Record<string, unknown>): string {
  const head = text(row["description"]).split(" · ")[0]?.trim() ?? "";
  // a description that is a sentence ("Use the default model ...") names no model
  return head !== "" && head.length <= 40 && !/^(use|custom)\b/i.test(head) && !head.includes("(") ? head : "";
}

/** Claude Code: the rows of its /model picker. The Default row is not a model of its own: it marks the model it resolves to as the default. Two aliases of one model are one row. */
export function claudeModels(rows: unknown): LiveModel[] {
  if (!Array.isArray(rows)) return [];
  const out: LiveModel[] = [];
  let fallbackDefault: string | null = null;
  for (const r of rows) {
    if (!isObj(r)) continue;
    const value = text(r["value"]), resolved = text(r["resolvedModel"]);
    if (value === "default" || value === "") { if (resolved !== "") fallbackDefault = resolved; continue; }
    const id = resolved || value;
    if (out.some((o) => o.id === id)) continue;
    const e = efforts(r["supportedEffortLevels"]);
    out.push({ id, title: claudeName(r) || text(r["displayName"]) || id, ...(value !== id ? { alias: value } : {}), ...(e ? { efforts: e } : {}) });
  }
  const d = out.find((o) => o.id === fallbackDefault);
  if (d) d.isDefault = true;
  return out;
}

const CLAUDE_INIT = "vyre_models";
export function claudeDialog(): ModelDialog {
  return {
    argv: ["claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"],
    // nonessential traffic stays on: the CLI's call for what the plan offers counts as nonessential, and it is the point of the run
    env: { DISABLE_AUTOUPDATER: "1" },
    start: [`${JSON.stringify({ type: "control_request", request_id: CLAUDE_INIT, request: { subtype: "initialize" } })}\n`],
    push(line) {
      const j = json(line);
      if (!j || j["type"] !== "control_response" || !isObj(j["response"])) return null;
      const r = j["response"];
      if (r["request_id"] !== undefined && r["request_id"] !== CLAUDE_INIT) return null;
      if (r["subtype"] === "error") return { fail: text(r["error"]) || "Claude Code did not list its models." };
      const body = isObj(r["response"]) ? r["response"] : {};
      return { done: claudeModels(body["models"]) };
    },
    end: () => null,
  };
}

/** "grok-4.6" reads "Grok 4.6": the Grok CLI prints ids only, and its own picker shows them that way. */
export function grokTitle(id: string): string {
  const parts = id.split("-").filter((p) => p !== "");
  return parts.map((p, i) => (i === 0 || !/^\d/.test(p) ? p.charAt(0).toUpperCase() + p.slice(1) : p)).join(" ") || id;
}

/** Grok: the text of `grok models`. */
export function grokModels(out: string): LiveModel[] {
  const models: LiveModel[] = [];
  let def = "";
  for (const raw of out.split("\n")) {
    const line = raw.trim();
    const d = /^Default model:\s*(\S+)/i.exec(line);
    if (d) { def = d[1] as string; continue; }
    const m = /^[*-]\s+(\S+)(\s+\(default\))?/.exec(line);
    if (!m) continue;
    const id = m[1] as string;
    if (models.some((x) => x.id === id)) continue;
    models.push({ id, title: grokTitle(id), ...(m[2] ? { isDefault: true } : {}) });
  }
  if (def !== "" && !models.some((m) => m.isDefault)) { const m = models.find((x) => x.id === def); if (m) m.isDefault = true; }
  return models;
}

export function grokDialog(): ModelDialog {
  const seen: string[] = [];
  return {
    argv: ["grok", "models"],
    env: { GROK_CLAUDE_MCPS_ENABLED: "0", GROK_CURSOR_MCPS_ENABLED: "0" },
    start: [],
    push(line) { seen.push(line); return null; },
    end() { const m = grokModels(seen.join("\n")); return m.length > 0 ? m : null; },
  };
}

export const MODEL_DIALOGS: Readonly<Record<CliId, () => ModelDialog>> = { codex: codexDialog, claude_code: claudeDialog, grok: grokDialog };

export class ModelListError extends Error {
  constructor(message: string) { super(message); this.name = "ModelListError"; }
}

/**
 * Ask the CLI for its models through the launcher the turns use (the sandbox, the fill). Ends the process as soon as the answer is in; gives up after `timeoutMs`. Throws ModelListError with a
 * plain reason when there is no answer; the caller keeps the list it had.
 */
export async function listCliModels(launcher: Launcher, cli: CliId, o: { cwd?: string; env?: Readonly<Record<string, string>>; timeoutMs?: number } = {}): Promise<LiveModel[]> {
  const dialog = MODEL_DIALOGS[cli]();
  const proc = await launcher.spawn({ argv: dialog.argv, ...(o.cwd !== undefined ? { cwd: o.cwd } : {}), env: { ...dialog.env, ...o.env } });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ModelListError("The engine did not list its models in time.")), o.timeoutMs ?? 20_000); });
  const talk = (async (): Promise<LiveModel[]> => {
    for (const s of dialog.start) await proc.write(s);
    if (dialog.start.length === 0) proc.endInput();
    for await (const line of lines(proc.stdout)) {
      const step = dialog.push(line);
      if (!step) continue;
      if (step.fail !== undefined) throw new ModelListError(step.fail);
      if (step.done) return step.done;
      for (const s of step.send ?? []) await proc.write(s);
    }
    const last = dialog.end();
    if (last) return last;
    const exit = await proc.exited;
    const why = proc.stderrTail().trim().split("\n").at(-1)?.slice(0, 200) ?? "";
    throw new ModelListError(why !== "" ? why : `The engine ended (${exit.code ?? exit.signal ?? "?"}) without listing its models.`);
  })();
  try {
    return await Promise.race([talk, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    talk.catch(() => undefined);
    try { proc.endInput(); } catch { /* closed */ }
    proc.kill("SIGTERM");
    // the process ends and its sign-in files are put back (fill launcher) before the caller goes on
    await Promise.race([proc.exited.catch(() => undefined), new Promise((r) => setTimeout(r, 3_000))]);
  }
}
