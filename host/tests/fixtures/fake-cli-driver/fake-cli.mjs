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
//   tool      "tool <name> <json arguments>": calls any tool over the Vyre MCP server and answers "<name> answered: <text>" or "<name> refused: <text>" (or "mcp error: ..."). A model that reads memory through its tools.
//   anything else answers with the prompt it was given
import process from "node:process";
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const session = `fake-${process.pid}`;
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const KEYS = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "CODEX_API_KEY", "XAI_API_KEY"];
const secret = () => KEYS.map((k) => process.env[k]).find((v) => v !== undefined && v !== "") ?? "";
let sendSequence = 0;

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
    const idempotencyKey = `fake-send-${address}-${mailbox ?? "default"}-${++sendSequence}`;
    const r = await mcp.call("mail_send", {
      mailboxId: mailbox ?? "mbx_a1b2c3", to: [{ address }], subject: "Hello from the fake engine", text: "Sent by the fake engine.", idempotencyKey,
    });
    if (r?.error) { reply([`mcp error: ${r.error.message ?? "the call failed"}`]); return; }
    const text = (r?.result?.content ?? []).map((c) => c.text ?? "").join("\n");
    reply([`mail_send ${r?.result?.isError ? "refused" : "answered"}: ${text}`]);
  } catch (e) {
    reply([`mcp error: ${e instanceof Error ? e.message : "the call failed"}`]);
  } finally { mcp?.close(); }
}

/** The turn context an engine puts in front of the message is system context a real model reads and does not act on as a command: this fake picks its scenario from the words after it. */
const withoutContext = (p) => p.replace(/^<vyre-context>[\s\S]*?<\/vyre-context>\s*/, "");

async function callTool(prompt) {
  const m = /^\s*tool\s+(\S+)\s*(.*)$/s.exec(prompt);
  if (!m) { reply(["mcp error: say which tool"]); return; }
  let args = {};
  try { args = m[2].trim() === "" ? {} : JSON.parse(m[2]); } catch { reply(["mcp error: the arguments are not JSON"]); return; }
  let mcp;
  try {
    mcp = await mcpOpen();
    const r = await mcp.call(m[1], args);
    if (r?.error) { reply([`mcp error: ${r.error.message ?? "the call failed"}`]); return; }
    const text = (r?.result?.content ?? []).map((c) => c.text ?? "").join("\n");
    reply([`${m[1]} ${r?.result?.isError ? "refused" : "answered"}: ${text}`]);
  } catch (e) {
    reply([`mcp error: ${e instanceof Error ? e.message : "the call failed"}`]);
  } finally { mcp?.close(); }
}

// A real claude merges a user message that arrives while it is mid-turn into that turn (one result for both) instead of answering it as a turn of its own. `holding` is the part of a turn where the fake does the same:
// what arrives then is absorbed into the running turn's answer, and no second result follows.
let holding = false;
const absorbed = [];

/**
 * "slow <words> <ms>": a reply that arrives the way a real one does: a pause before the first word, then the words one by one as partial messages (stream_event text deltas), then the whole assistant message
 * (which repeats the text) and the result. A screen that shows the text only when the turn ends, or shows it twice, is caught by it.
 */
async function slow(prompt) {
  const m = /^\s*slow\s+(\d+)\s+(\d+)/.exec(prompt);
  const n = m ? Number(m[1]) : 6, ms = m ? Number(m[2]) : 500;
  init();
  const mid = `m_slow_${process.pid}_${Date.now()}`;   // the partial messages and the whole one carry the same message id, as the real CLI's do
  out({ type: "stream_event", event: { type: "message_start", message: { id: mid } } });
  await new Promise((res) => setTimeout(res, ms * 2));
  const words = Array.from({ length: n }, (_, i) => `word${i + 1}`);
  for (const w of words) {
    out({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `${w} ` } } });
    await new Promise((res) => setTimeout(res, ms));
  }
  const full = words.map((w) => `${w} `).join("");
  out({ type: "assistant", message: { id: mid, content: [{ type: "text", text: full }], usage: { input_tokens: 9, output_tokens: n } } });
  out({ type: "result", subtype: "success", is_error: false, result: full, session_id: session, usage: { input_tokens: 9, output_tokens: n } });
}

/**
 * "think <ms>": a reply that works before it speaks, the way a real one does: it thinks (thinking deltas), reads a file (a Read tool call and its result), thinks again, reads another, then answers in words.
 * The line under the reply must say so while it happens, and "Worked for N s" must stay under the finished reply.
 */
async function think(prompt) {
  const m = /^\s*think\s+(\d+)/.exec(prompt);
  const ms = m ? Number(m[1]) : 600;
  const wait = (n) => new Promise((res) => setTimeout(res, n));
  init();
  const mid = `m_think_${process.pid}_${Date.now()}`;
  out({ type: "stream_event", event: { type: "message_start", message: { id: mid } } });
  const thought = async (text) => { for (const w of text.split(" ")) { out({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: `${w} ` } } }); await wait(60); } };
  await thought("I should look at the notes first and then compare them with the plan.");
  await wait(ms);
  out({ type: "stream_event", event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: `toolu_a_${process.pid}`, name: "Read" } } });
  // the whole message arrives with the call's input, as the real CLI's does
  out({ type: "assistant", message: { id: `m_ta_${process.pid}`, content: [{ type: "tool_use", id: `toolu_a_${process.pid}`, name: "Read", input: { file_path: "/work/notes/model.ts" } }] } });
  await wait(ms * 2);
  out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: `toolu_a_${process.pid}`, content: "ok" }] } });
  await thought("That covers the first part, now the second file.");
  out({ type: "stream_event", event: { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: `toolu_b_${process.pid}`, name: "WebSearch" } } });
  out({ type: "assistant", message: { id: `m_tb_${process.pid}`, content: [{ type: "tool_use", id: `toolu_b_${process.pid}`, name: "WebSearch", input: { query: "stream pacing" } }] } });
  await wait(ms * 2);
  out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: `toolu_b_${process.pid}`, content: "ok" }] } });
  // a command with a secret in it: it must never be shown, only "Running a command"
  out({ type: "stream_event", event: { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: `toolu_c_${process.pid}`, name: "Bash" } } });
  out({ type: "assistant", message: { id: `m_tc_${process.pid}`, content: [{ type: "tool_use", id: `toolu_c_${process.pid}`, name: "Bash", input: { command: "curl -H 'Authorization: Bearer sk-ant-FAKESECRETFAKESECRET123456' https://example.com/x?token=abc" } }] } });
  await wait(ms * 2);
  out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: `toolu_c_${process.pid}`, content: "ok" }] } });
  await wait(ms);
  const words = ["The", "notes", "agree", "with", "the", "plan."];
  for (const w of words) { out({ type: "stream_event", event: { type: "content_block_delta", index: 3, delta: { type: "text_delta", text: `${w} ` } } }); await wait(120); }
  const full = words.map((w) => `${w} `).join("");
  out({ type: "assistant", message: { id: mid, content: [{ type: "text", text: full }], usage: { input_tokens: 9, output_tokens: words.length } } });
  out({ type: "result", subtype: "success", is_error: false, result: full, session_id: session, usage: { input_tokens: 9, output_tokens: words.length } });
}

/** "askhold <ms> <json>": asks the question over MCP (ask_question), then keeps its turn open for <ms> as a model does while it finishes its sentence, and only then ends it. */
async function askHold(prompt) {
  const m = /^\s*askhold\s+(\d+)\s+(.*)$/s.exec(prompt);
  if (!m) { reply(["askhold: say how long and what to ask"]); return; }
  let args = {};
  try { args = JSON.parse(m[2].trim()); } catch { reply(["askhold: the question is not JSON"]); return; }
  let mcp;
  try {
    mcp = await mcpOpen();
    const r = await mcp.call("ask_question", args);
    holding = true;
    init();
    // while it finishes its work the model reads a few files: each is a tool call and its result, a step boundary the engine looks at for steering
    const until = Date.now() + Number(m[1]);
    for (let n = 1; Date.now() < until; n++) {
      out({ type: "assistant", message: { id: `m_step${n}`, content: [{ type: "tool_use", id: `toolu_step${n}`, name: "Read", input: { file_path: "/tmp/x" } }] } });
      await new Promise((res) => setTimeout(res, 150));
      out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: `toolu_step${n}`, content: "ok" }] } });
      await new Promise((res) => setTimeout(res, 150));
    }
    holding = false;
    const merged = absorbed.splice(0, absorbed.length);
    // The real engine reads a mid-turn message at its next step and acts on it inside the turn it is running: one that carries a new instruction (askhold ...) is carried out here, before the turn's one result.
    const next = merged.flatMap((p) => p.split("\n")).reverse().find((l) => /^askhold\s+\d+/.test(l.trim()));
    if (next) { mcp?.close(); mcp = undefined; await askHold(next.trim()); return; }
    reply([r?.error || r?.result?.isError ? `ask_question refused: ${JSON.stringify(r)}` : `I have asked; waiting for your answer.${merged.length ? ` Merged: ${merged.join(" | ")}` : ""}`]);
  } catch (e) {
    reply([`mcp error: ${e instanceof Error ? e.message : "the call failed"}`]);
  } finally { mcp?.close(); }
}

async function run(raw) {
  const prompt = withoutContext(raw);
  // a "tool" line is the person's message, which comes last and may follow context or memory the engine put in front of it
  const toolLine = prompt.split("\n").reverse().find((l) => /^tool\s+\S+/.test(l));
  if (toolLine) { await callTool(toolLine); return; }
  const first = prompt.trim().split(/\s+/)[0];
  // a side question (/btw): its first message carries "The question: ..."; the answer streams a few words
  const asked = /The question: ([^\n]*)/.exec(prompt);
  if (asked && /A side question, asked while you may be busy/.test(prompt)) {
    init();
    const mid = `m_aside_${process.pid}_${Date.now()}`;
    out({ type: "stream_event", event: { type: "message_start", message: { id: mid } } });
    const words = `Aside answer to ${asked[1].trim()} is short`.split(" ");
    for (const w of words) { out({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `${w} ` } } }); await new Promise((res) => setTimeout(res, 250)); }
    const full = words.map((w) => `${w} `).join("");
    out({ type: "assistant", message: { id: mid, content: [{ type: "text", text: full }], usage: { input_tokens: 9, output_tokens: words.length } } });
    out({ type: "result", subtype: "success", is_error: false, result: full, session_id: session, usage: { input_tokens: 9, output_tokens: words.length } });
    return;
  }
  const holdLine = prompt.split("\n").reverse().find((l) => /^askhold\s+\d+/.test(l));   // the instruction may follow other lines the person's messages brought
  if (holdLine) { await askHold(holdLine.trim()); return; }
  if (first === "slow") { await slow(prompt.trim()); return; }
  if (first === "think") { await think(prompt.trim()); return; }
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
    case "tool": await callTool(prompt); break;
    case "authfail":
      init();
      out({ type: "result", subtype: "error_during_execution", is_error: true, result: "Invalid API key. Please run /login", session_id: session });
      break;
    default: reply([prompt]);
  }
}

// With --replay-user-messages the real engine echoes each user message when it takes it up: at the start of its turn, or, for one that arrives mid-turn, when it folds it in at a step boundary.
const replay = (text) => { if (argv.includes("--replay-user-messages")) out({ type: "user", isReplay: true, message: { role: "user", content: [{ type: "text", text }] } }); };

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
    if (holding) { absorbed.push(withoutContext(prompt)); replay(prompt); continue; }
    queue = queue.then(() => { replay(prompt); return run(prompt); });
  }
});
process.stdin.on("end", () => { queue.then(() => process.exit(0)); });
