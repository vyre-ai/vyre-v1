// Steering proof on the real Claude CLI through Vyre's own CLI session: a turn with tool calls is running, a message is injected mid-turn, and the turn must end once, with the agent having changed course
// at its next step. NOT part of any CI glob. Needs VYRE_TEST_CLAUDE_SETUP_TOKEN. The token is passed in the process environment and scrubbed from every printed line.
import { createCliSession } from "../../agent/src/drivers/cli/session.ts";
import { claudeCode } from "../../agent/src/drivers/cli/claude.ts";
import { createLocalLauncher } from "../../agent/src/drivers/cli/launcher.ts";

const TOKEN = process.env["VYRE_TEST_CLAUDE_SETUP_TOKEN"] ?? "";
if (!TOKEN) throw new Error("VYRE_TEST_CLAUDE_SETUP_TOKEN is required");
const T0 = Date.now();
const say = (s: string): void => console.log(`${((Date.now() - T0) / 1000).toFixed(1).padStart(5)}  ${s.split(TOKEN).join("[token]").slice(0, 200)}`);
// The real adapter's decoder and flags, without Vyre's MCP server (this proof only needs the CLI's own Bash tool).
const adapter = { ...claudeCode, command: () => ["claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--replay-user-messages", "--permission-mode", "bypassPermissions", "--model", "sonnet"] };
const launcher = createLocalLauncher({ baseEnv: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "" } });
const session = createCliSession({ adapter, launcher, endpoint: { url: "", token: TOKEN }, model: "sonnet", resume: null, system: null, workFolder: process.env["PROOF_DIR"] ?? process.cwd(), env: { CLAUDE_CODE_OAUTH_TOKEN: TOKEN }, idleMs: 120_000 }, { threadId: "T", agent: { id: "a", mode: "lead", model: "sonnet" }, asker: "me", turnId: "t1", traceId: "x" } as never);
const msg = (id: string, body: string) => ({ id, threadId: "T", threadSeq: 1, author: { kind: "person", id: "me" }, mentions: [], depth: 0, body }) as never;
let tools = 0, results = 0, steered = false;
const trigger = msg("m1", "Use the Bash tool to run `sleep 8; echo one`, then `sleep 8; echo two`, then `sleep 8; echo three`, each as its own Bash call one after another, then reply with the word FINISHED.");
say(`>> person: ${(trigger as { body: string }).body.slice(0, 90)}`);
for await (const ev of session.send({ threadId: "T", turnId: "t1", agent: { id: "a", mode: "lead", model: "sonnet" }, trigger, history: [], listeners: [], asker: "me" } as never)) {
  if (ev.type === "block") { say(`${ev.kind} ${JSON.stringify(ev.payload)}`); if (ev.kind === "tool_call" && !steered) { steered = true; tools++; setTimeout(() => { say(">> person (mid-turn, injected): change of plan"); session.inject(msg("m2", "Change of plan: do not run any more commands. Reply with exactly the single word STEERED and nothing else.")); }, 2500); } }
  else if (ev.type === "text") say(`text: ${ev.text}`);
  else if (ev.type === "done") { results++; say("done (one turn end for the whole send)"); }
  else if (ev.type === "error") say(`error ${ev.code}: ${ev.message}`);
}
say(`send ended; done events: ${results}; stats ${JSON.stringify(session.stats())}`);
await session.close();
