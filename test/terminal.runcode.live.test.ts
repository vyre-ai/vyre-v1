// Run on a code block in a chat, on a booted daemon (rc.9). The terminal host is an in-memory stand-in bound in this process; the capabilities, the person's rules and the Gate are live.
// 1 a read-only command runs from the block and its output comes back; 2 anything that changes something is typed without Enter and nothing runs; 3 a command a deny rule stops is refused with
// the rule's sentence and never reaches the machine; 4 a destructive command is typed for the person to read and send, never run by the button.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, connect, seededDir } from "./memory-live-kit.ts";
import { bindHost } from "../modules/terminal/impl.ts";
import type { TerminalHost } from "../modules/terminal/projections.ts";
import { commandOf, riskOf, runThis } from "../apps/app/src/places/chats/terminal/runthis.ts";

function fakeHost() {
  const screens = new Map<string, string>();
  const typed: string[] = [];
  const ran: string[] = [];
  const host: TerminalHost = {
    async open(a) { screens.set(a.terminalId, ""); return { cwd: "/home/olivia", title: "This computer" }; },
    async input(id, data) { typed.push(data); screens.set(id, (screens.get(id) ?? "") + data); },
    async interrupt() {}, async resize() {},
    async read(id, o) { const all = screens.get(id) ?? ""; return { text: all.slice(o.since ?? 0), next: all.length }; },
    async run(_id, o) { ran.push(o.command); return { exitCode: 0, output: `ran: ${o.command}`, truncated: false, durationMs: 5 }; },
    async status(ids) { return ids.map((id) => ({ terminalId: id, state: "idle" as const, exitCode: null })); },
    async close() {}, async health() { return { ok: true, sessions: screens.size }; },
  };
  return { host, typed, ran };
}

let keys = 0;

test("terminal live: Run on a shell block runs a read, types a change, stops at a deny rule and types a destructive command", async () => {
  const fake = fakeHost();
  bindHost(fake.host);
  const d = await boot(seededDir());
  try {
    await connect(d);
    const deps = { call: async (cap: string, input: unknown) => { const r = await call(d, cap, { idempotencyKey: `rc-${++keys}`, ...(input as object) }); if (r.status !== 200) throw Object.assign(new Error(r.data?.error?.message ?? `${cap} ${r.status}`), { status: r.status, data: r.data }); return r.data; }, newKey: () => `rc-key-${++keys}` };
    const device = { key: "device:dev_macbook1", label: "This computer", kind: "device" as const, online: true, deviceId: "dev_macbook1" };

    // the block offers Run for one line only
    assert.equal(commandOf("bash", "ls -la /work", true), "ls -la /work");
    assert.equal(commandOf("bash", "cd a\nls", true), null);

    // 1 a read: judged read-only, runs, output returns
    assert.equal(await riskOf(deps, "ls -la /work"), "read");
    const ran = await runThis(deps, device, "ls -la /work", "read");
    assert.equal(ran.s, "ran");
    assert.equal(ran.s === "ran" && ran.output, "ran: ls -la /work");
    assert.deepEqual(fake.ran, ["ls -la /work"]);

    // 2 a change: typed, no Enter, nothing run
    assert.equal(await riskOf(deps, "npm install left-pad"), "change");
    const typed = await runThis(deps, device, "npm install left-pad", "change");
    assert.equal(typed.s, "typed");
    assert.ok(fake.typed.includes("npm install left-pad"));
    assert.ok(!fake.typed.some((t) => /\n|\r/.test(t)), "no Enter was sent");
    assert.deepEqual(fake.ran, ["ls -la /work"], "nothing else ran");

    // 3 a deny rule is a wall: the sentence comes back and the machine never hears it
    await deps.call("terminal.rules.set", { rules: { allow: [], ask: [], deny: ["curl *"], folders: [] } });
    const denied = await runThis(deps, device, "curl http://x.invalid", "read");
    assert.equal(denied.s, "refused");
    assert.match(denied.s === "refused" ? denied.why : "", /rule of yours/i);
    assert.ok(!fake.ran.some((c) => c.startsWith("curl")));

    // 4 destructive: judged danger, so it is typed for the person to read and press Enter on; Run never executes it (the person's own terminal.run carries no Gate hold, so the button must not call it)
    assert.equal(await riskOf(deps, "rm -rf /tmp/build"), "danger");
    const danger = await runThis(deps, device, "rm -rf /tmp/build", "danger");
    assert.equal(danger.s, "typed");
    assert.ok(!fake.ran.includes("rm -rf /tmp/build"), "a destructive command is not run by the button");
    assert.ok(fake.typed.includes("rm -rf /tmp/build"));
  } finally { await d.stop(); bindHost(null); }
});
