// A stand-in for the model-list calls of the three subscription CLIs (agent/src/drivers/cli/models.ts), spoken the way the pinned binaries speak them (recorded on box B, 3 Nov 2026):
//   codex app-server     JSON-RPC lines: initialize, initialized, model/list (paged: the first page carries nextCursor "p2")
//   claude -p --input-format stream-json ...   a control_request {subtype: initialize} answered by a control_response whose models are the /model picker
//   grok models          plain text
// Signed in (the sign-in reached the process: CLAUDE_CODE_OAUTH_TOKEN, or VYRE_CRED_FILES for Codex and Grok) the account's list carries a model the shipped catalog has never heard of.
// FAKE_MODELS picks a scenario: "fail" writes a reason on stderr and exits 2; "hang" never answers; "rpcerror" answers model/list with a JSON-RPC error.
import process from "node:process";
import readline from "node:readline";

const argv = process.argv.slice(2);
const program = argv[0] ?? "";
const scenario = process.env.FAKE_MODELS ?? "";
const signedIn = (process.env.CLAUDE_CODE_OAUTH_TOKEN ?? "") !== "" || (process.env.VYRE_CRED_FILES ?? "") !== "";
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

if (scenario === "fail") { process.stderr.write("error: could not reach the model list\n"); process.exit(2); }
if (scenario === "hang") { setInterval(() => undefined, 1000); }
else if (program === "grok" && argv[1] === "models") {
  process.stdout.write(`${signedIn ? "" : "You are not authenticated.\n\n"}Default model: ${signedIn ? "grok-5" : "grok-4.6"}\n\nAvailable models:\n`);
  if (signedIn) process.stdout.write("  * grok-5 (default)\n");
  process.stdout.write(`  ${signedIn ? "-" : "*"} grok-4.6${signedIn ? "" : " (default)"}\n  - grok-4.5\n`);
  process.exit(0);
} else {
  const rl = readline.createInterface({ input: process.stdin });
  const effort = (e) => ({ reasoningEffort: e, description: e });
  const codexPage = (cursor) => cursor === "p2"
    ? { data: [{ id: "gpt-5.5", model: "gpt-5.5", displayName: "GPT-5.5", hidden: false, isDefault: false, supportedReasoningEfforts: ["low", "medium", "high", "xhigh"].map(effort), defaultReasoningEffort: "medium" },
      { id: "gpt-old", model: "gpt-old", displayName: "GPT-Old", hidden: true, isDefault: false, supportedReasoningEfforts: [], defaultReasoningEffort: "medium" }], nextCursor: null }
    : { data: [
      ...(signedIn ? [{ id: "gpt-7-nova", model: "gpt-7-nova", displayName: "GPT-7-Nova", hidden: false, isDefault: true, supportedReasoningEfforts: ["low", "medium", "high", "max"].map(effort), defaultReasoningEffort: "medium" }] : []),
      { id: "gpt-6.1-sol", model: "gpt-6.1-sol", displayName: "GPT-6.1-Sol", hidden: false, isDefault: !signedIn, supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"].map(effort), defaultReasoningEffort: "low" },
    ], nextCursor: "p2" };
  const claudeRows = () => [
    { value: "default", resolvedModel: signedIn ? "claude-opus-6" : "claude-opus-5-5", displayName: "Default (recommended)", description: `Use the default model (currently ${signedIn ? "Opus 6" : "Opus 5.5"})`, supportedEffortLevels: ["low", "medium", "high", "max"] },
    { value: "opus", resolvedModel: signedIn ? "claude-opus-6" : "claude-opus-5-5", displayName: "Opus", description: `${signedIn ? "Opus 6" : "Opus 5.5"} · Best for everyday, complex tasks · $4/$20 per Mtok`, supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"] },
    { value: "sonnet", resolvedModel: "claude-sonnet-5-5", displayName: "Sonnet", description: "Sonnet 5.5 · Efficient for routine tasks", supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"] },
    { value: "haiku", resolvedModel: "claude-haiku-5-5", displayName: "Haiku", description: "Haiku 5.5 · Fastest for quick answers" },
  ];
  rl.on("line", (line) => {
    let j;
    try { j = JSON.parse(line); } catch { return; }
    if (program === "codex") {
      if (j.method === "initialize") out({ id: j.id, result: { userAgent: "codex fake", codexHome: process.env.CODEX_HOME ?? "", platformFamily: "unix", platformOs: "linux" } });
      else if (j.method === "model/list") {
        if (scenario === "rpcerror") out({ id: j.id, error: { code: -32000, message: "model list unavailable" } });
        else out({ id: j.id, result: codexPage(j.params?.cursor) });
      }
    } else if (program === "claude" && j.type === "control_request" && j.request?.subtype === "initialize") {
      out({ type: "system", subtype: "status", note: "an unrelated line first" });
      out({ type: "control_response", response: { subtype: "success", request_id: j.request_id, response: { commands: [], models: claudeRows(), account: { tokenSource: signedIn ? "CLAUDE_CODE_OAUTH_TOKEN" : "none" } } } });
    }
  });
}
