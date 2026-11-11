// rc.22 bug 15, a hypothesis tested at daemon level: when access.sync fails for a moment (a busy server), a chat made in that moment is in the chat module but not in the access snapshot the
// pipeline reads, so the owner's next call on it answers "not found" until some later sync succeeds. Fault: the table access.sync reads is renamed for the commit, then put back.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { boot, post, seededDirFrom } from "./daemon-boot-rig.ts";

const seededDir = seededDirFrom(bootCore);
const call = async (d: Awaited<ReturnType<typeof boot>>, cap: string, body: unknown): Promise<{ status: number; body: any }> => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await post(d, `/v1/${cap.replaceAll(".", "/")}`, body);
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

test("a chat made while access.sync fails is readable by its owner afterwards", async () => {
  const dir = seededDir();
  const d = await boot(dir);
  try {
    const made0 = await call(d, "agents.create", { name: "Desk", role: "You help.", idempotencyKey: "as-agent" });
    const agentId = (made0.body?.data?.agent?.agentId ?? "") as string;
    const ok = await call(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "as-1" });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    d.db!.run("ALTER TABLE access_grants RENAME TO access_grants_held");
    let made: { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    try { made = await call(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "as-2" }); } finally { d.db!.run("ALTER TABLE access_grants_held RENAME TO access_grants"); }
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const id = made.body.data.thread.threadId as string;
    // the table is back: the next sync succeeds. The owner must be able to read the chat they just made, within a moment and without any other change to trigger it.
    let got = await call(d, "threads.get", { threadId: id });
    for (let i = 0; i < 40 && got.status !== 200; i++) { await new Promise((r) => setTimeout(r, 250)); got = await call(d, "threads.get", { threadId: id }); }
    assert.equal(got.status, 200, `the owner reads the chat they just made: ${JSON.stringify(got.body).slice(0, 200)}`);
    const sent = await call(d, "chat.post", { threadId: id, body: "hello", idempotencyKey: "as-3" });
    assert.equal(sent.status, 200, `and writes in it: ${JSON.stringify(sent.body).slice(0, 200)}`);
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
