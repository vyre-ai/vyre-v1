// A stand-in for `codex` (exec --json) and `grok` (-p, streaming-json) that signs in the way the real ones do: by reading the files in its home. It never prints a token; it answers with what it found, so a
// test can see that the files were there, were 0600, were the right ones, and that the token was not also in the environment.
//   argv[0] codex: reads $CODEX_HOME/auth.json (else $HOME/.codex/auth.json); the prompt is on stdin.   argv[0] grok: reads $HOME/.grok/auth.json; the prompt is on stdin.
//   prompt "authcheck": "<cli> signed in as <digest of the access token> mode <octal> env <names of the sign-in variables that are set>"
//   prompt "leak": the access token in the reply and on stderr (the scrubber must remove both)
//   anything else: echoes the prompt
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const argv = process.argv.slice(2);
const cli = argv[0];
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const home = process.env.HOME ?? "";
const file = cli === "codex" ? path.join(process.env.CODEX_HOME ?? path.join(home, ".codex"), "auth.json") : path.join(home, ".grok", "auth.json");

function describe() {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch { return { found: false }; }
  const mode = (fs.statSync(file).mode & 0o777).toString(8);
  let token = "";
  try { const j = JSON.parse(raw); token = j.tokens?.access_token ?? j.token ?? ""; } catch { /* not json */ }
  const env = ["VYRE_CRED_FILES", "CODEX_API_KEY", "XAI_API_KEY", "OPENAI_API_KEY"].filter((k) => process.env[k] !== undefined);
  return { found: true, mode, token, digest: `${token.length}:${token.slice(-4)}`, env };
}

function answer(prompt) {
  const d = describe();
  if (prompt.trim().startsWith("authcheck")) return d.found ? `${cli} signed in as ${d.digest} mode ${d.mode} env ${d.env.join(",") || "none"}` : `${cli} has no sign-in files`;
  if (prompt.trim().startsWith("leak")) { process.stderr.write(`token ${d.token}\n`); return `the token is ${d.token}`; }
  return prompt;
}

let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { prompt += c; });
process.stdin.on("end", () => {
  // a grok turn is a Claude-style stream: the prompt may be a JSON user message
  let text = prompt;
  try { const m = JSON.parse(prompt.split("\n").find((l) => l.trim() !== "") ?? ""); const c = m?.message?.content; text = Array.isArray(c) ? c.map((p) => p.text ?? "").join("") : typeof c === "string" ? c : prompt; } catch { /* plain text */ }
  const reply = answer(text);
  if (cli === "codex") {
    out({ type: "thread.started", thread_id: "thr_fake" });
    out({ type: "item.completed", item: { id: "i1", type: "agent_message", text: reply } });
    out({ type: "turn.completed", usage: { input_tokens: 5, output_tokens: 3 } });
  } else {
    out({ type: "system", subtype: "init", session_id: "fake-grok", mcp_servers: [] });
    out({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: reply } } });
    out({ type: "result", subtype: "success", is_error: false, result: reply, session_id: "fake-grok", usage: { input_tokens: 5, output_tokens: 3 } });
  }
});
