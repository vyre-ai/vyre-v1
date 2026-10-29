// OpenAI-compatible endpoints, live against a stub HTTP server on this machine (no fake fetch): a custom endpoint with a key held in the Vault by handle, streaming and a tool call, and a Local
// model with no key. The stub speaks Chat Completions server-sent events. The network guard (lib/net-guard.ts) is real: loopback is reachable only when the person is on their own computer.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createSessionOpener, createApiTools } from "../src/drivers/open/index.ts";
import type { McpPort, OpenAccount, SessionOpenerDeps } from "../src/drivers/open/index.ts";
import { ctx } from "../src/drivers/api/testing.ts";
import { createTurnEngine } from "../src/turn-engine/index.ts";
import type { EngineAgent, SessionSpec } from "../src/turn-engine/index.ts";
import { makeSession } from "../src/tools/harness.ts";
import type { Lookup, ValueSource } from "../src/vault-use/index.ts";

const KEY = "sk-acme-gateway-0123456789abcdef"; // secret-scan: fake
const TRACE = "b".repeat(32);

interface Seen { method: string; url: string; headers: http.IncomingHttpHeaders; body: any }
interface Stub { base: string; seen: Seen[]; close(): Promise<void> }

const sse = (...chunks: unknown[]): string => `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`;
const delta = (d: unknown, finish: string | null = null) => ({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: d, finish_reason: finish }] });

/** A Chat Completions server: the first completion calls a tool, the next answers in words. `tool` is the tool name to call. */
async function stub(tool: string): Promise<Stub> {
  const seen: Seen[] = [];
  let completions = 0;
  const server = http.createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => parts.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(parts).toString("utf8");
      seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: raw === "" ? undefined : JSON.parse(raw) });
      if (req.method === "GET" && req.url === "/v1/models") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ data: [{ id: "llama3" }, { id: "qwen3" }] })); return; }
      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        completions += 1;
        res.writeHead(200, { "content-type": "text/event-stream" });
        const out = completions === 1 && tool !== ""
          ? [delta({ role: "assistant", content: "Let me look. " }), delta({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: tool, arguments: "" } }] }), delta({ tool_calls: [{ index: 0, function: { arguments: "{}" } }] }), delta({}, "tool_calls")]
          : [delta({ role: "assistant", content: "Found " }), delta({ content: "3 leads." }), delta({}, "stop"), { id: "c1", choices: [], usage: { prompt_tokens: 9, completion_tokens: 4 } }];
        // two writes with a pause, so the answer really streams
        const text = sse(...out);
        const cut = Math.floor(text.length / 2);
        res.write(text.slice(0, cut));
        setTimeout(() => res.end(text.slice(cut)), 15);
        return;
      }
      res.writeHead(404); res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, seen, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

const value = (v: string, itemId: string): Lookup => ({ kind: "value", itemId, value: v, spaceOnly: false, injectIntoDeployments: false });

function rig(accounts: Record<string, OpenAccount>, vault: Record<string, Lookup>, tool: ReturnType<typeof makeSession> | null, over: Partial<SessionOpenerDeps> = {}) {
  const used: unknown[] = [];
  const source: ValueSource = { lookup: async (h) => vault[h] ?? { kind: "unknown" } };
  const mcp: McpPort = { mint: async () => { throw new Error("no MCP for an API account"); }, close: async () => undefined };
  const tools = tool ? createApiTools({ session: tool.session, space: "spc_1", system: () => [{ text: "You are Intake.", stable: true }] }) : null;
  const opener = createSessionOpener({
    source, reportMiss: () => undefined, launcher: { spawn: async () => { throw new Error("no process"); } }, mcp,
    apiContext: tools ? tools.context : () => ctx(), onUsed: (e) => { used.push(e.used); }, ...over,
  });
  const engine = createTurnEngine({
    holder: "host:s",
    ...(tools ? { callTool: tools.runner } : {}),
    openSession: (spec: SessionSpec) => {
      const account = spec.agent.accountRef === undefined ? undefined : accounts[spec.agent.accountRef];
      return opener.openSession({ ...spec, ...(account ? { account } : {}), turnId: "turn_1", traceId: TRACE } as SessionSpec);
    },
  });
  return { opener, engine, used };
}

async function ask(g: ReturnType<typeof rig>, a: EngineAgent) {
  g.engine.openThread({ id: "T1", kind: "chat", starter: "dana", agents: [a] });
  g.engine.receive({ threadId: "T1", author: { kind: "person", id: "dana" }, body: "who are my newest leads?" });
  await g.engine.idle("T1");
  const turn = g.engine.turns("T1").at(-1)!;
  const reply = g.engine.messages("T1").filter((m) => m.author.kind === "agent").at(-1)?.body ?? "";
  return { turn, reply };
}

const agent = (accountRef: string, model: string): EngineAgent => ({ id: "intake", mode: "lead", model, accountRef });

test("a custom endpoint: the key is filled from the Vault into the request header, the answer streams, a tool call runs and its result goes back", async () => {
  const t = makeSession();
  const name = [...t.loaded.defaults].find((n) => { const d = t.loaded.catalog.byName(n); return d !== undefined && d.effects === "read" && d.local === "none" && n !== "tool_search"; });
  assert.ok(name, "the default tool set has a plain read tool");
  const s = await stub(name);
  const g = rig({ "#Acme_Gateway": { ref: "#Acme_Gateway", driver: "custom", kind: "api_key", payer: "dana", base: `${s.base}/v1` } }, { "#Acme_Gateway": value(KEY, "vit_acme") }, t, { own: () => true });
  const { turn, reply } = await ask(g, agent("#Acme_Gateway", "llama3"));
  assert.equal(turn.state, "completed", JSON.stringify(turn.error));
  assert.equal(reply, "Let me look. Found 3 leads.");
  const posts = s.seen.filter((r) => r.method === "POST");
  assert.equal(posts.length, 2, "the tool result went back to the model");
  assert.equal(posts[0]?.headers["authorization"], `Bearer ${KEY}`, "the key came from the Vault at the HTTP layer");
  assert.equal(posts[0]?.body.stream, true);
  assert.equal(posts[0]?.body.model, "llama3");
  assert.ok((posts[0]?.body.tools as Array<{ function: { name: string } }>).some((x) => x.function.name === name), "the tool was advertised");
  assert.ok(JSON.stringify(posts[1]?.body.messages).includes("call_1"), "the second request carries the tool result");
  assert.equal(t.calls.length, 1, "the tool ran once, as the agent for the asker");
  assert.ok(g.engine.events("T1").some((e) => e.type === "turn.block" && e.kind === "tool_call"));
  assert.ok(!JSON.stringify({ e: g.engine.events(), m: g.engine.messages("T1"), u: g.used }).includes(KEY), "the key is in no event, message or audit row");
  assert.deepEqual(g.used[0], [{ handle: "#Acme_Gateway", itemId: "vit_acme" }]);
  await g.opener.close(); await s.close();
});

test("the Local model driver needs no key: the server address is enough, /v1 is added, nothing is asked of the Vault", async () => {
  const s = await stub("");
  const g = rig({ "#Ollama": { ref: "#Ollama", driver: "local", kind: "api_key", payer: "dana", base: s.base, keyless: true } }, {}, null, { own: () => true });
  const { turn, reply } = await ask(g, agent("#Ollama", "llama3"));
  assert.equal(turn.state, "completed", JSON.stringify(turn.error));
  assert.equal(reply, "Found 3 leads.");
  const post = s.seen.find((r) => r.method === "POST");
  assert.equal(post?.url, "/v1/chat/completions");
  assert.equal(post?.headers["authorization"], undefined, "no key header");
  assert.deepEqual(g.used, [], "the Vault was not used");
  assert.equal(turn.tokensIn, 9);
  await g.opener.close(); await s.close();
});

test("the network guard: a stub on loopback is refused when the person is not on their own computer, and the stub is never reached", async () => {
  const s = await stub("");
  const g = rig({ "#Acme_Gateway": { ref: "#Acme_Gateway", driver: "custom", kind: "api_key", payer: "dana", base: `${s.base}/v1` } }, { "#Acme_Gateway": value(KEY, "vit_acme") }, null, { own: () => false });
  const { turn } = await ask(g, agent("#Acme_Gateway", "llama3"));
  assert.equal(turn.state, "failed");
  assert.equal(s.seen.length, 0, "nothing was sent");
  assert.ok(!JSON.stringify(turn).includes(KEY));
  await g.opener.close(); await s.close();
});

test("a custom endpoint with a key is https or this machine only; a custom account with no address is refused", async () => {
  const g = rig({
    "#Plain": { ref: "#Plain", driver: "custom", kind: "api_key", payer: "dana", base: "http://llm.example.test/v1" },
    "#NoBase": { ref: "#NoBase", driver: "custom", kind: "api_key", payer: "dana" },
  }, { "#Plain": value(KEY, "vit_p"), "#NoBase": value(KEY, "vit_n") }, null, { own: () => true });
  for (const [ref, code] of [["#Plain", "provider.bad_address"], ["#NoBase", "provider.bad_address"]] as const) {
    await assert.rejects(g.opener.openSession({ threadId: "T9", agent: agent(ref, "m"), asker: "dana", account: { ref, driver: "custom", kind: "api_key", ...(ref === "#Plain" ? { base: "http://llm.example.test/v1" } : {}) }, turnId: "t", traceId: TRACE } as SessionSpec), (e: { code?: string }) => e.code === code);
  }
  await g.opener.close();
});
