// Shared by the tools tests (P-L2_16b): the harness of the lifecycle tests with a scripted agentd on top of the fake machine. agentd answers each tool by its mcpName; a test can replace an answer
// or make a tool refuse the way agentd does (a code and a message). Every call agentd got is kept: which tool, with which arguments, for which computer.
import { handlers } from "../impl.ts";
import { provision, wake } from "../handlers/lifecycle.ts";
import { ToolError } from "../handlers/tools/common.ts";
import type { ToolAnswer, ToolArgs, ToolCode, ToolHost } from "../handlers/tools/common.ts";
import { bindHost } from "../projections.ts";
import type { ComputerHost } from "../projections.ts";
import { asPerson, harness, INTAKE } from "../fixtures/harness.ts";
import type { Harness, HarnessOptions } from "../fixtures/harness.ts";

export const tool = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;

export interface ToolCall { computerId: string; tool: string; args: ToolArgs; timeoutMs: number }
export type Answer = (args: ToolArgs, call: ToolCall) => ToolAnswer | Promise<ToolAnswer>;

export const PNG = "iVBORw0KGgo=";
const page = { url: "https://example.com/", title: "Example", };

/** What a healthy agentd answers for every tool, by mcpName. */
export const ANSWERS: Record<string, Answer> = {
  chrome_snapshot: () => ({ ...page, tree: "- page [e1]\n  - button [e2] Submit", truncated: false }),
  chrome_act: () => ({ ok: true }),
  chrome_click: () => ({ ok: true }),
  chrome_type: () => ({ ok: true }),
  chrome_fill: (a) => ({ ok: true, filled: Array.isArray(a["fields"]) ? a["fields"].length : 0 }),
  chrome_open: (a) => ({ tabId: "t1", url: String(a["url"]), title: "Example" }),
  chrome_tabs: () => ({ tabs: [{ tabId: "t1", url: page.url, title: page.title, active: true }] }),
  chrome_wait: () => ({ ok: true, waitedMs: 12 }),
  chrome_screenshot: () => ({ png: PNG, width: 800, height: 600 }),
  chrome_eval: () => ({ result: 42 }),
  chrome_console: () => ({ messages: [{ level: "log", text: "hello", at: 1_760_000_000_000 }] }),
  chrome_net: () => ({ requests: [{ method: "POST", url: "https://example.com/api", status: 200, ms: 12, body: '{"token":"abc123","ok":true}' }] }),
  chrome_inspect: () => ({ element: { role: "button", text: "Submit" } }),
  chrome_state: () => ({ ...page, loading: false }),
  chrome_status: () => ({ connected: true, paused: false, held: [] }),
  chrome_stop: () => ({ stopped: true }),
  chrome_resume: () => ({ resumed: true }),
  chrome_send: () => ({ sent: true }),
  chrome_plan: () => ({ ok: true }),
  chrome_api: () => ({ status: 200, headers: { "content-type": "application/json", "set-cookie": "sid=1" }, body: { ok: true, session: "abc" } }),
  chrome_sources: () => ({ scripts: ["https://example.com/app.js"], endpoints: [{ method: "GET", url: "https://example.com/api/items" }] }),
  screen_screenshot: () => ({ png: PNG, width: 1280, height: 800 }),
  screen_click: () => ({ ok: true }),
  screen_move: () => ({ ok: true }),
  screen_drag: () => ({ ok: true }),
  screen_type: () => ({ ok: true }),
  screen_key: () => ({ ok: true }),
  screen_scroll: () => ({ ok: true }),
  screen_wait: () => ({ ok: true }),
  computer_files_list: () => ({ entries: [{ name: "notes.md", kind: "file", size: 3, modifiedAt: 1_760_000_000_000 }, { name: "work", kind: "folder" }] }),
  computer_files_read: () => ({ content: "abc", encoding: "utf8", truncated: false }),
  computer_files_write: () => ({ ok: true, versionId: "ver_1" }),
  computer_files_move: () => ({ ok: true }),
  computer_files_delete: () => ({ ok: true }),
};

/** Put a scripted agentd on the machine a harness is bound to. Rebind after creating another harness: building one binds its own plain machine. */
export function agentd(h: Harness, answers: Record<string, Answer> = {}) {
  const calls: ToolCall[] = [];
  const refusals = new Map<string, ToolError>();
  const table: Record<string, Answer> = { ...ANSWERS, ...answers };
  const host: ComputerHost & ToolHost = {
    ...h.fake.host,
    async tool(a) {
      calls.push(a);
      const refused = refusals.get(a.tool);
      if (refused) throw refused;
      const answer = table[a.tool];
      if (!answer) throw new ToolError("unavailable", `no answer for ${a.tool}`);
      return answer(a.args, a);
    },
  };
  bindHost(host);
  return {
    host, calls, table,
    refuse(name: string, code: ToolCode, message = "refused by agentd"): void { refusals.set(name, new ToolError(code, message)); },
    allow(name: string): void { refusals.delete(name); },
    named(name: string): ToolCall[] { return calls.filter((c) => c.tool === name); },
    rebind(): void { bindHost(host); },
  };
}
export type Agentd = ReturnType<typeof agentd>;

/** A Team Space with one agent computer (INTAKE's), awake unless asked otherwise, and agentd on it. */
export async function world(o: { asleep?: boolean; answers?: Record<string, Answer>; harness?: HarnessOptions } = {}) {
  const h = harness(o.harness);
  const made = await provision(h.ctx, { agentId: INTAKE, idempotencyKey: "k-tools" });
  const id = made.computer.computerId;
  const d = agentd(h, o.answers);
  if (o.asleep !== true) await wake(h.ctx, { computerId: id });
  /** The agent that owns the computer, calling a tool without naming it. One harness for the whole test, so its emitted events and the capabilities it called are in one place. */
  let owner: Harness | null = null;
  const agent = (): Harness => { owner ??= asPerson(h, { kind: "agent", id: INTAKE }); d.rebind(); return owner; };
  return { h, id, d, agent };
}
export type World = Awaited<ReturnType<typeof world>>;

export const steps = (h: Harness): Array<Record<string, unknown>> => h.rows("SELECT * FROM computers_timeline ORDER BY idx");
