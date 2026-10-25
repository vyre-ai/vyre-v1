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
//   anything else answers with the prompt it was given
import process from "node:process";

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

function run(prompt) {
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
