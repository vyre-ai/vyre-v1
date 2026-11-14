// The server itself keeps working around a guest (lane f-guest, 14 Nov 2026). A guest is invited (the join steps run as the server: role, channel, grant, home channel), joins, reads, posts, mentions an agent and opens a reply
// thread; the owner asks an agent in the same channel (the bridge reads the channel); the daemon stops and boots again on the same folder (boot, the consumers, the lazy move). Nothing the server does for the channel or the
// guest is refused or throws: no log line of the daemon names a refusal, a thrown handler or a join step that failed.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { boot, connect, waitFor } from "./memory-live-kit.ts";
import { standIn } from "./member-key-kit.ts";
import { world } from "./guest-channel-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

// a guest's mention that the bridge deliberately does not answer is logged once as an info line (reason guest): that is the ruling, not a fault
const BAD =
  /handler threw|no_grant|role_lacks_permission|permission\.|did not run a turn|could not|join step|failed|refused/i;
function problems(d: Daemon): string[] {
  d.sink.flush();
  const rows = new DatabaseSync(d.paths.logs, { readOnly: true })
    .prepare("SELECT level, place, cap, msg, attrs FROM logs WHERE level >= 30 ORDER BY id")
    .all() as Array<{ level: number; place: string | null; cap: string | null; msg: string; attrs: string | null }>;
  return rows
    .map((r) => `${r.level} ${r.place ?? ""} ${r.cap ?? ""} ${r.msg} ${String(r.attrs ?? "").slice(0, 200)}`)
    .filter((l) => BAD.test(l) && !/loop_blocked/.test(l) && !/"reason":"guest"/.test(l));
}

test("the server's own work around a guest and a channel (join steps, bridge, consumers, boot, the lazy move) is neither refused nor thrown", async () => {
  const w = await world();
  const dir = w.dir;
  try {
    await connect(w.d);
    const g = await w.invite(w.pub, "reply", "srv@example.com", "srvguest");
    const thread = w.pub.mainThreadId;
    assert.equal(
      (await g.call("chat.post", { threadId: thread, body: "hello", mentions: [{ kind: "agent", id: w.agent }] }))
        .status,
      200,
    );
    const reply = (await g.call("chat.thread", { threadId: thread, messageId: w.first.pub })).data.thread
      .threadId as string;
    assert.equal((await g.call("chat.post", { threadId: reply, body: "in the thread" })).status, 200);
    // the owner asks the agent in the same channel: the bridge reads the channel, the thread under the message, the people
    await w.o("chat.post", {
      threadId: thread,
      body: "@Dex are you there?",
      mentions: [{ kind: "agent", id: w.agent }],
    });
    await waitFor(async () => {
      await w.d.hooks?.pump?.();
      return true;
    }, 5_000);
    for (let i = 0; i < 20; i++) {
      await w.d.hooks?.pump?.();
      await new Promise((x) => setTimeout(x, 400));
    }
    assert.deepEqual(
      problems(w.d),
      [],
      "no refusal or thrown handler while the server worked for the guest and the channel",
    );
    // boot again on the same folder: the consumers replay, the lazy move runs for any thread named, the guest still reads
    await w.d.stop();
    const again = await boot(dir, standIn);
    try {
      const r = await fetch(`${again.url}/v1/threads/get`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${g.token}` },
        body: JSON.stringify({ threadId: reply }),
      });
      assert.equal(r.status, 200, "the guest still opens the reply thread after a restart");
      for (let i = 0; i < 10; i++) {
        await again.hooks?.pump?.();
        await new Promise((x) => setTimeout(x, 300));
      }
      assert.deepEqual(problems(again), [], "and the second boot is clean");
    } finally {
      await again.stop();
    }
  } finally {
    try {
      await w.d.stop();
    } catch {
      /* already stopped */
    }
    (await import("node:fs")).rmSync(dir, { recursive: true, force: true });
  }
});
