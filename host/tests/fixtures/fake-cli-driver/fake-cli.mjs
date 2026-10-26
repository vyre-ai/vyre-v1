// A stand-in for `claude` (Claude Code headless, stream-json) for the session-opener tests. The test launcher starts it with the argv the driver built (program name first), so the
// opener is tested through a real process: the environment, the pipes, the exit code and stderr are the real ones. It never prints a secret on its own account: the scenarios that do
// ("leak", "die") exist to prove the scrubber removes it on the way out.
//
// The first word of the prompt picks the scenario:
//   hello     two text deltas, usage, success (a streamed reply)
//   envcheck  which of the key variables are set and how long they are, whether any argv word holds one, whether the MCP token is in env and not in argv, the variable names the process has
//   leak      the key value in the reply text AND on stderr (the scrubber must remove both)
//   die       writes the key to stderr and exits 3 without a result
//   authfail  a result line that is an error (an expired sign-in)
//   send      "send <address> [mailboxId]": calls the mail_send tool over the Vyre MCP server named in --mcp-config (stdio shim or loopback URL, the same ways the real CLI would) and answers with
//             what the tool said, "mail_send answered: <text>" or "mail_send refused: <text>" (a Gate hold, a refusal) or "mcp error: <message>". Lets a test drive the Gate path end to end.
//   anything else answers with the prompt it was given
import process from "node:process";
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const session = `fake-${process.pid}`;
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const KEYS = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "CODEX_API_KEY", "XAI_API_KEY"];
const secret = () => KEYS.map((k) => process.env[k]).find((v) => v !== undefined && v !== "") ?? "";

if (argv.includes("--version")) { process.stdout.write("claude fake 0.0.0\n"); process.exit(0); }

const init = () => out({ type: "system", subtype: "init", session_id: session, mcp_servers: [{ name: "vyre", status: "connected" }] });
function reply(parts) {
  init();
  out({ type: "stream_event", event: { type: "message_start", message: { id: `m_${Date.now()}` } } });
  for (const text of parts) out({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } });
  out({ type: "result", subtype: "success", is_error: false, result: parts.join(""), session_id: session, usage: { input_tokens: 11, output_tokens: 7 } });
}

// ---- MCP client, just enough to call one tool -----------------------------------------------------------------------------------------------------------------------------------------
const expand = (v) => String(v).replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => process.env[k] ?? "");

/** One JSON-RPC conversation with the vyre MCP server: initialize, initialized, then calls. stdio: a child process, one JSON message per line. http: POSTs, with the session id the server answers. */
async function mcpOpen() {
  const cfg = JSON.parse(flag("--mcp-config") ?? "{}").mcpServers?.vyre;
  if (!cfg) throw new Error("there is no vyre MCP server in --mcp-config");
  let id = 0;
  let request;
  let notify;
  let close = () => {};
  if (cfg.command) {
    const env = { ...process.env, ...Object.fromEntries(Object.entries(cfg.env ?? {}).map(([k, v]) => [k, expand(v)])) };
    const child = spawn(cfg.command, cfg.args ?? [], { env, stdio: ["pipe", "pipe", "inherit"] });
    const waiting = new Map();
    let lines = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      lines += d;
      for (let at = lines.indexOf("\n"); at >= 0; at = lines.indexOf("\n")) {
        const line = lines.slice(0, at);
        lines = lines.slice(at + 1);
        if (line.trim() === "") continue;
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        const w = waiting.get(m.id);
        if (w) { waiting.delete(m.id); w(m); }
      }
    });
    child.on("exit", () => { for (const w of waiting.values()) w({ error: { message: "the MCP shim ended" } }); waiting.clear(); });
    request = (method, params) => new Promise((resolve) => { const n = ++id; waiting.set(n, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: n, method, params })}\n`); });
    notify = (method) => { child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`); };
    close = () => { try { child.stdin.end(); } catch { /* gone */ } };
  } else {
    let session;
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", ...Object.fromEntries(Object.entries(cfg.headers ?? {}).map(([k, v]) => [k.toLowerCase(), expand(v)])) };
    const post = async (body) => {
      const r = await fetch(cfg.url, { method: "POST", headers: { ...headers, ...(session ? { "mcp-session-id": session } : {}) }, body: JSON.stringify(body) });
      const sid = r.headers.get("mcp-session-id");
      if (sid) session = sid;
      const text = await r.text();
      if (text.trim() === "") return null;
      if ((r.headers.get("content-type") ?? "").includes("text/event-stream")) {
        const data = text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
        return data.length ? JSON.parse(data[data.length - 1]) : null;
      }
      return JSON.parse(text);
    };
    request = (method, params) => post({ jsonrpc: "2.0", id: ++id, method, params });
    notify = (method) => { void post({ jsonrpc: "2.0", method }); };
  }
  const hello = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake-cli", version: "0.0.0" } });
  if (hello?.error) throw new Error(hello.error.message ?? "the MCP server refused initialize");
  notify("notifications/initialized");
  return { call: (name, args) => request("tools/call", { name, arguments: args }), close };
}

async function sendMail(prompt) {
  const [, address, mailbox] = prompt.trim().split(/\s+/);
  if (!address) { reply(["mcp error: say who to send to"]); return; }
  let mcp;
  try {
    mcp = await mcpOpen();
    const r = await mcp.call("mail_send", {
      mailboxId: mailbox ?? "mbx_a1b2c3", to: [{ address }], subject: "Hello from the fake engine", text: "Sent by the fake engine.", idempotencyKey: `fake-send-${address}-${mailbox ?? "default"}`,
    });
    if (r?.error) { reply([`mcp error: ${r.error.message ?? "the call failed"}`]); return; }
    const text = (r?.result?.content ?? []).map((c) => c.text ?? "").join("\n");
    reply([`mail_send ${r?.result?.isError ? "refused" : "answered"}: ${text}`]);
  } catch (e) {
    reply([`mcp error: ${e instanceof Error ? e.message : "the call failed"}`]);
  } finally { mcp?.close(); }
}

async function run(prompt) {
  const first = prompt.trim().split(/\s+/)[0];
  switch (first) {
    case "hello": reply(["Hello", " from the fake engine."]); break;
    case "envcheck": {
      const mcp = flag("--mcp-config") ?? "";
      const token = process.env.VYRE_MCP_TOKEN ?? "";
      const words = argv.join("\n");
      const heldKeys = KEYS.filter((k) => (process.env[k] ?? "") !== "");
      const argvHoldsKey = KEYS.some((k) => (process.env[k] ?? "") !== "" && words.includes(process.env[k]));
      reply([JSON.stringify({
        keys: heldKeys.map((k) => `${k}:${process.env[k].length}`),
        argvHoldsKey,
        mcpTokenInEnv: token !== "",
        mcpTokenInArgv: token !== "" && words.includes(token),
        mcpUrl: JSON.parse(mcp || "{}").mcpServers?.vyre?.url ?? null,
        mcpAuth: JSON.parse(mcp || "{}").mcpServers?.vyre?.headers?.Authorization ?? null,
        env: Object.keys(process.env).sort(),
      })]);
      break;
    }
    case "leak":
      process.stderr.write(`debug: using ${secret()}\n`);
      reply(["The key is ", secret(), " ok"]);
      break;
    case "die":
      process.stderr.write(`boom: the engine crashed with ${secret()}\n`);
      process.exit(3);
      break;
    case "send": await sendMail(prompt); break;
    case "authfail":
      init();
      out({ type: "result", subtype: "error_during_execution", is_error: true, result: "Invalid API key. Please run /login", session_id: session });
      break;
    default: reply([prompt]);
  }
}

// Persistent engine: one JSON user message per line on stdin, answered in order.
let buf = "";
let queue = Promise.resolve();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  buf += d;
  for (let at = buf.indexOf("\n"); at >= 0; at = buf.indexOf("\n")) {
    const line = buf.slice(0, at);
    buf = buf.slice(at + 1);
    if (line.trim() === "") continue;
    let prompt = "";
    try { prompt = JSON.parse(line).message.content.map((c) => c.text ?? "").join("\n"); } catch { continue; }
    queue = queue.then(() => run(prompt));
  }
});
process.stdin.on("end", () => { queue.then(() => process.exit(0)); });
