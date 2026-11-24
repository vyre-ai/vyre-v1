// The vyre-hook mode of the bridge shim (lane l-hooks): what a CLI engine's generated hooks config runs. The real shim program runs as a child process against a real bridge socket; the endpoint behind it
// is a stand-in that answers vyre/hook. Exit 2 with the reason on stderr stops the CLI's call; a note goes out as additional context; no endpoint, a slow one or a bad answer lets the call go on.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openMcpBridge } from "../mcp-bridge.ts";
import { shimCommand } from "../../../agent/src/drivers/cli/hooks-config.ts";

async function run(
  answer: (body: { method: string; params: { event: string; payload: Record<string, unknown> } }) => unknown | null,
  event = "PreToolUse",
  delayMs = 0,
) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-hookshim-"));
  const seen: unknown[] = [];
  const bridge = await openMcpBridge(
    { url: "http://127.0.0.1:9/mcp", token: "tok_test" },
    {
      scratch,
      fetch: (async (_u: unknown, i?: RequestInit) => {
        const body = JSON.parse(String(i?.body));
        seen.push(body);
        const a = answer(body);
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
        if (a === null) throw new Error("down");
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: a }), {
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    },
  );
  try {
    const cmd = shimCommand(bridge.stdio, event);
    const p = spawn("/bin/sh", ["-c", cmd], { env: { ...process.env, VYRE_MCP_TOKEN: "tok_test" } });
    let out = "",
      err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.stdin.end(JSON.stringify({ tool_name: "Bash", tool_input: { command: "rm -rf x" } }));
    const code = await new Promise<number | null>((ok) => p.on("close", ok));
    return { code, out, err, seen };
  } finally {
    await bridge.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

test("a block stops the CLI's call: exit 2 and the reason on stderr; the event reaches Vyre with the tool and its input", async () => {
  const r = await run(() => ({ block: "No deletes in this chat", notes: [] }));
  assert.equal(r.code, 2);
  assert.match(r.err, /No deletes in this chat/);
  const b = r.seen[0] as { method: string; params: { event: string; payload: { tool_name: string } } };
  assert.deepEqual([b.method, b.params.event, b.params.payload.tool_name], ["vyre/hook", "PreToolUse", "Bash"]);
});

test("a note goes out as additional context and the call goes on", async () => {
  const r = await run(() => ({ block: null, notes: ["Use the staging folder"] }));
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).hookSpecificOutput.additionalContext, "Use the staging folder");
});

test("nothing to say: the call goes on; an endpoint that is down or a bad answer refuses a call about to be made (the hook that holds a spending limit fails closed), and lets the events after a call go on", async () => {
  assert.equal((await run(() => ({ block: null, notes: [] }))).code, 0);
  for (const bad of [() => null, () => "nonsense"] as const) {
    const r = await run(bad);
    assert.equal(r.code, 2, "refused");
    assert.match(r.err, /spending limit/);
    assert.equal((await run(bad, "PostToolUse")).code, 0, "after a call it goes on");
  }
});

test("no answer in time refuses a call about to be made: the shim does not wait for ever", async () => {
  process.env["VYRE_HOOK_TIMEOUT_MS"] = "400";
  try {
    const slow = await run(() => ({ block: null, notes: [] }), "PreToolUse", 2_000);
    assert.equal(slow.code, 2);
    assert.match(slow.err, /spending limit/);
  } finally {
    delete process.env["VYRE_HOOK_TIMEOUT_MS"];
  }
});
