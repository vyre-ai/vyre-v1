// A stand-in for the three CLIs, for the driver tests. The test launcher starts it in place of `claude`, `codex` or `grok` with the argv the driver built (program name first), so the driver is
// tested through a real process: stdin and stdout pipes, the environment, signals and exit codes are the real ones.
//
// What it does with its input (the first word of the prompt picks the scenario):
//   text            replays <program>-text.jsonl
//   nopartial       replays claude-nopartial.jsonl (a message without deltas)
//   tool [name]     calls a Vyre tool over MCP exactly as the CLI would (initialize, then tools/call, bearer token from the environment), then replays <program>-tool.jsonl when the call
//                   worked and <program>-tool-denied.jsonl when the MCP server refused it
//   authfail, maxturns, mcpfail   replay the matching failure stream
//   slow [ms]       waits, then replays text (a turn that takes a while)
//   hang            starts, says nothing more, never ends
//   die             writes to stderr and exits 3 with no result
//   anything else   answers with the prompt it was given
// Claude Code and Grok read their MCP server from --mcp-config (JSON, the token expanded from the environment); Codex from -c mcp_servers.vyre.* overrides.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const bin = path.basename(argv[0] ?? "");
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const resume = bin === "codex" ? (argv.includes("resume") ? argv[argv.indexOf("resume") + 1] : undefined) : flag("--resume");
const session = resume ?? `fake-${process.pid}`;
const out = (line) => process.stdout.write(`${line}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (argv.includes("--version")) { out(`${bin} fake 0.0.0`); process.exit(0); }

function mcpTarget() {
  const token = process.env.VYRE_MCP_TOKEN ?? "";
  if (bin === "codex") {
    const overrides = argv.filter((_, i) => argv[i - 1] === "-c");
    const url = overrides.find((o) => o.startsWith("mcp_servers.vyre.url="));
    const env = overrides.find((o) => o.startsWith("mcp_servers.vyre.bearer_token_env_var="));
    if (!url) return null;
    return { url: JSON.parse(url.slice("mcp_servers.vyre.url=".length)), authorization: env ? `Bearer ${token}` : undefined };
  }
  const raw = flag("--mcp-config");
  if (!raw) return null;
  const server = JSON.parse(raw).mcpServers.vyre;
  const header = String(server.headers?.Authorization ?? "").split("${VYRE_MCP_TOKEN}").join(token);
  return { url: server.url, authorization: header || undefined };
}

async function callTool(name) {
  const target = mcpTarget();
  if (!target) return { ok: false };
  const post = (body, extra = {}) => fetch(target.url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(target.authorization ? { authorization: target.authorization } : {}), ...extra },
    body: JSON.stringify(body),
  });
  try {
    const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: bin, version: "0" } } });
    if (init.status !== 200) return { ok: false };
    const sid = init.headers.get("mcp-session-id");
    const extra = sid ? { "mcp-session-id": sid } : {};
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }, extra);
    const res = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: {} } }, extra);
    const body = await res.json();
    return { ok: res.status === 200 && !body.error && body.result?.isError !== true };
  } catch {
    return { ok: false };
  }
}

function replay(name) {
  const file = path.join(here, `${bin}-${name}.jsonl`);
  for (const line of fs.readFileSync(file, "utf8").split("\n")) if (line.trim() !== "") out(line.split("{{SESSION}}").join(session));
}

function say(text) {
  if (bin === "codex") {
    out(JSON.stringify({ type: "thread.started", thread_id: session }));
    out(JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "agent_message", text } }));
    out(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } }));
    return;
  }
  out(JSON.stringify({ type: "system", subtype: "init", session_id: session, mcp_servers: [{ name: "vyre", status: "connected" }] }));
  out(JSON.stringify({ type: "assistant", message: { id: `m_${Date.now()}`, content: [{ type: "text", text }], usage: { input_tokens: 1, output_tokens: 1 } }, session_id: session }));
  out(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: text, session_id: session, usage: { input_tokens: 1, output_tokens: 1 } }));
}

async function run(prompt) {
  const words = prompt.trim().split(/\s+/);
  switch (words[0]) {
    case "text": replay("text"); break;
    case "nopartial": replay("nopartial"); break;
    case "tool": replay((await callTool(words[1] ?? "schema_describe")).ok ? "tool" : "tool-denied"); break;
    case "authfail": replay("error-auth"); break;
    case "maxturns": replay("max-turns"); break;
    case "mcpfail": replay("mcp-failed"); break;
    case "slow": await sleep(Number(words[1] ?? 400)); replay("text"); break;
    case "hang":
      out(JSON.stringify(bin === "codex" ? { type: "thread.started", thread_id: session } : { type: "system", subtype: "init", session_id: session, mcp_servers: [{ name: "vyre", status: "connected" }] }));
      setInterval(() => undefined, 60_000);
      await new Promise(() => undefined);
      break;
    case "die": process.stderr.write("boom: the engine crashed\n"); process.exit(3); break;
    case "env": say(Object.keys(process.env).sort().join(",")); break;
    default: say(prompt);
  }
}

if (bin === "claude") {
  // Persistent: one user message per line on stdin, answered in order.
  let queue = Promise.resolve();
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => {
    buf += d;
    let at = buf.indexOf("\n");
    while (at >= 0) {
      const line = buf.slice(0, at);
      buf = buf.slice(at + 1);
      at = buf.indexOf("\n");
      if (line.trim() === "") continue;
      let prompt = "";
      try { prompt = JSON.parse(line).message.content.map((c) => c.text ?? "").join("\n"); } catch { continue; }
      queue = queue.then(() => run(prompt));
    }
  });
  process.stdin.on("end", () => { queue.then(() => process.exit(0)); });
} else {
  // One-shot: the whole prompt on stdin, one answer, exit.
  let prompt = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => { prompt += d; });
  process.stdin.on("end", async () => {
    await run(prompt);
  });
}
