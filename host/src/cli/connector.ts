// `vyre connector init|build|test|run|publish|export|list`: the connector commands in words a person types. The generated table already maps each one to its capability; this adds what the table
// cannot: friendly flags (--connection, --input, --dry-run), the connector key as the first word, and for `build` following the Run until it ends, so the terminal shows the outcome.
import { camel } from "./args.ts";
import type { Parsed } from "./args.ts";
import { callCap, NotRunning, resolveTarget, showError, notRunningHint } from "./client.ts";
import { EXIT, errLine, line } from "./io.ts";
import type { CliIo } from "./io.ts";

const CAPS: Record<string, { cap: string; positional: string[] }> = {
  init: { cap: "connectors.init", positional: ["key"] },
  build: { cap: "connectors.build", positional: ["key"] },
  test: { cap: "connectors.test", positional: ["key"] },
  run: { cap: "connectors.run", positional: ["key", "action"] },
  publish: { cap: "connectors.publish", positional: ["key"] },
  export: { cap: "connectors.export", positional: ["key"] },
  list: { cap: "connectors.list", positional: [] },
};
const ALIAS: Record<string, string> = { connection: "connectionId", docs: "docsUrl", "dry-run": "dryRun", draft: "draftId" };
const TERMINAL = new Set(["succeeded", "failed", "stopped"]);

export const connectorBooleans = new Set(["dry-run", "no-wait", "json"]);

function mint(): string { return `idem_${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("")}`; }

export async function connectorCommand(io: CliIo, p: Parsed): Promise<number> {
  const sub = p.positional[1];
  const spec = sub ? CAPS[sub] : undefined;
  if (!sub || !spec) { errLine(io, `usage: vyre connector <${Object.keys(CAPS).join("|")}> [key] [action] [--connection con_x] [--input '{...}'] [--dry-run]`); return EXIT.USAGE; }
  const target = resolveTarget(io, p.flags);
  if (!target) { errLine(io, "No server or token found. Use --server and --token, or run on the server's own machine."); return EXIT.USAGE; }

  const input: Record<string, unknown> = {};
  spec.positional.forEach((name, i) => { const w = p.positional[2 + i]; if (w !== undefined) input[name] = w; });
  for (const [flag, raw] of p.flags) {
    if (["json", "server", "token", "data-dir", "no-wait"].includes(flag)) continue;
    const name = ALIAS[flag] ?? camel(flag);
    if (name === "input") { try { input["input"] = JSON.parse(String(raw)) as unknown; } catch { errLine(io, "--input must be JSON"); return EXIT.USAGE; } continue; }
    input[name] = raw === true ? true : raw === "true" ? true : raw === "false" ? false : raw;
  }
  if (sub === "run" && input["input"] === undefined) input["input"] = {};
  if (sub === "build" || sub === "publish" || sub === "run") input["idempotencyKey"] ??= mint();
  const extra = p.positional.slice(2 + spec.positional.length);
  if (extra.length) { errLine(io, `unexpected argument "${extra[0]}"`); return EXIT.USAGE; }

  try {
    const r = await callCap(io, target, spec.cap, input);
    if (!r.ok) return showError(io, r);
    if (sub !== "build" || p.flags.has("no-wait")) { line(io, JSON.stringify(r.data, null, 2)); return EXIT.OK; }
    const runId = (r.data as { runId?: string }).runId;
    if (!runId) { line(io, JSON.stringify(r.data, null, 2)); return EXIT.OK; }
    line(io, `Build started as ${runId}. Waiting for it to finish (Ctrl-C leaves it running).`);
    for (let waited = 0; waited < 600_000; waited += 1000) {
      const g = await callCap(io, target, "runs.get", { runId });
      if (!g.ok) return showError(io, g);
      const run = (g.data as { run?: { status?: string } }).run;
      if (run?.status && TERMINAL.has(run.status)) { line(io, JSON.stringify({ ...(r.data as object), run }, null, 2)); return run.status === "succeeded" ? EXIT.OK : EXIT.FAILED; }
      await io.sleep(1000);
    }
    errLine(io, `The build is still running after 10 minutes. Follow it with: vyre runs get ${runId}`);
    return EXIT.FAILED;
  } catch (e) {
    if (e instanceof NotRunning) { errLine(io, `${e.message}. ${notRunningHint}`); return EXIT.NOT_RUNNING; }
    throw e;
  }
}
