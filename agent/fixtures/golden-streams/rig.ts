// Test rig for the CLI driver tests: a launcher that starts fake-cli.mjs in place of the real program, a spy that records what the driver writes to stdin, builders for sessions and turns, and a real
// MCP server on a loopback port with bearer tokens, the way the CLI reaches Vyre in a booted daemon. No assertions here.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { createLocalLauncher } from "../../src/drivers/cli/index.ts";
import type { CliDriverDeps, Launcher, McpEndpoint } from "../../src/drivers/cli/index.ts";
import { createMcpServer } from "../../src/mcp/index.ts";
import type { McpCaller, McpServer } from "../../src/mcp/index.ts";
import { fakeInvoke, loadGenerated } from "../../src/tools/harness.ts";
import type { InvokeRecord } from "../../src/tools/harness.ts";
import type { DriverEvent, EngineAgent, SessionSpec, StoredMessage, TurnInput } from "../../src/turn-engine/types.ts";

export const FAKE_CLI = fileURLToPath(new URL("./fake-cli.mjs", import.meta.url));
export const fixtureText = (name: string): string => readFileSync(new URL(`./${name}.jsonl`, import.meta.url), "utf8");

export const TOKEN = "tok-allowed-0123456789abcdef";

/** Every argv the driver launched, in order, and every write it made to a process's stdin. */
export interface Spy { launches: string[][]; envs: Array<Readonly<Record<string, string>>>; writes: string[] }

/** The local launcher with the fake CLI in place of the program. `extraEnv` shows that the launcher passes only what it is given. */
export function fakeLauncher(spy: Spy, base: { PATH?: string } = {}): Launcher {
  const local = createLocalLauncher({
    wrap: (argv) => { spy.launches.push([...argv]); return [process.execPath, FAKE_CLI, ...argv]; },
    baseEnv: { PATH: base.PATH ?? process.env["PATH"] ?? "" },
  });
  return {
    async spawn(spec) {
      spy.envs.push(spec.env);
      const p = await local.spawn(spec);
      return { ...p, write: (data: string) => { spy.writes.push(data); return p.write(data); } };
    },
  };
}

export const newSpy = (): Spy => ({ launches: [], envs: [], writes: [] });

export const agent = (over: Partial<EngineAgent> = {}): EngineAgent => ({ id: "agt_intake", mode: "lead", model: "sonnet", ...over });
export const specOf = (over: Partial<EngineAgent> = {}, threadId = "thr_1"): SessionSpec => ({ threadId, agent: agent(over), asker: "per_dana" });

export const message = (body: string, id = "m1", over: Partial<StoredMessage> = {}): StoredMessage => ({
  id, threadId: "thr_1", threadSeq: 1, author: { kind: "person", id: "per_dana" }, mentions: [], depth: 0, body, ...over,
});

export function turnOf(body: string, over: Partial<TurnInput> = {}): TurnInput {
  return { threadId: "thr_1", turnId: "t1", agent: agent(), trigger: message(body), history: [], listeners: [], asker: "per_dana", ...over };
}

export async function collect(it: AsyncIterable<DriverEvent>): Promise<DriverEvent[]> {
  const out: DriverEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

export const texts = (events: readonly DriverEvent[]): string[] => events.flatMap((e) => (e.type === "text" ? [e.text] : []));
export const kinds = (events: readonly DriverEvent[]): string[] => events.map((e) => (e.type === "block" ? `block:${e.kind}` : e.type));
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await sleep(15);
  }
}

export function alive(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export const endpoint = (url = "http://127.0.0.1:9/mcp", token = TOKEN): McpEndpoint => ({ url, token });

export function driverDeps(spy: Spy, over: Partial<CliDriverDeps> = {}): CliDriverDeps {
  return { launcher: fakeLauncher(spy), mcp: async () => endpoint(), graceMs: 400, ...over };
}

export const driverCaller = (over: Partial<McpCaller> = {}): McpCaller => ({
  kind: "driver", sessionId: "ses_drv", space: "spc_1", principal: { kind: "agent", id: "agt_intake" }, actingFor: "per_dana", threadId: "thr_1", runId: "run_1", traceId: "a".repeat(32), ...over,
});

export interface McpRig {
  url: string;
  server: McpServer;
  /** What the MCP server counted: tool and outcome of every call. */
  calls: Array<{ tool: string; outcome: string }>;
  /** What reached the invoke pipeline. */
  invokes: InvokeRecord[];
  close(): Promise<void>;
}

/** The real MCP server (agent/src/mcp) behind a loopback HTTP listener, with the generated catalog and the Gate model of the tool tests. `callers` maps a bearer token to who it is. */
export async function startMcp(callers: Readonly<Record<string, McpCaller>>): Promise<McpRig> {
  const g = loadGenerated();
  const fake = fakeInvoke(g.caps);
  const calls: McpRig["calls"] = [];
  const server = createMcpServer({
    catalog: g.catalog, defaults: g.defaults, invoke: fake.invoke,
    open: async (token) => callers[token] ?? null,
    onCall: (_c, tool, outcome) => { calls.push({ tool, outcome }); },
  });
  const flat = (h: IncomingHttpHeaders): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(h)) if (v !== undefined) out[k] = Array.isArray(v) ? v.join(", ") : v;
    return out;
  };
  const http = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      void server.handle({ method: req.method ?? "GET", headers: flat(req.headers), body: Buffer.concat(chunks).toString("utf8") }).then((r) => { res.writeHead(r.status, r.headers).end(r.body); });
    });
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const port = (http.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/mcp`, server, calls, invokes: fake.calls,
    close: () => new Promise<void>((resolve) => { http.closeAllConnections(); http.close(() => resolve()); }),
  };
}
