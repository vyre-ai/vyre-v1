// The ceiling and "no agent turn" key on standing in the Space, not on a role's name (lane f-guest, 14 Nov 2026): a role cloned from Guest is an outsider; a harmless custom role beside Guest changes nothing; promoting a
// guest to Member lifts both at once (no kept answer): they can stop turns, and an agent answers them; demoting caps them at once.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { connect } from "./memory-live-kit.ts";
import { api } from "./member-key-kit.ts";
import { world } from "./guest-channel-kit.ts";

type Msg = {
  id?: string;
  messageId?: string;
  author?: { kind?: string };
  body?: string;
  blocks?: Array<{ data?: { text?: string } }>;
};

test("a role cloned from Guest, and Guest beside a harmless role, stay capped; a promoted guest has standing at once and a demoted member loses it at once", async () => {
  const w = await world();
  try {
    await connect(w.d);
    const g = await w.invite(w.pub, "reply", "standing@example.com", "standingguest");
    const thread = w.pub.mainThreadId;
    const roles = (await w.o("access.roles.list")).roles as Array<{ id: string; name: string }>;
    const idOf = (n: string): string => roles.find((r) => r.name === n)!.id;
    const subject = { kind: "person", id: g.personId };
    // the bridge says once per message that it did not answer a guest (reason guest): the count of those lines is the proof that the bridge saw an outsider, or did not
    const skips = (): number => {
      w.d.sink.flush();
      const rows = new DatabaseSync(w.d.paths.logs, { readOnly: true })
        .prepare("SELECT attrs FROM logs WHERE msg LIKE '%did not run a turn%'")
        .all() as Array<{ attrs: string | null }>;
      return rows.filter((r) => String(r.attrs ?? "").includes('"reason":"guest"')).length;
    };
    const settle = async (): Promise<void> => {
      for (let i = 0; i < 12; i++) {
        await w.d.hooks?.pump?.();
        await new Promise((x) => setTimeout(x, 300));
      }
    };
    const stop = async (): Promise<number> => (await g.call("engine.stop_all", { threadId: thread })).status;
    const agentLines = (ms: Msg[]): number =>
      ms.filter((m) => m.author?.kind === "agent" && (m.body ?? "") !== "").length;
    const mainCount = async (): Promise<number> =>
      agentLines((await w.o("chat.messages.list", { threadId: thread })).messages as Msg[]);
    const sent = new Map<string, number>();
    const post = async (body: string): Promise<string> => {
      const base = await mainCount();
      const r = await g.call("chat.post", { threadId: thread, body, mentions: [{ kind: "agent", id: w.agent }] });
      assert.equal(r.status, 200);
      const id = (r.data.messageId ?? r.data.message?.messageId ?? r.data.message?.id) as string;
      sent.set(id, base);
      return id;
    };
    // an agent line in the channel since the message, or in the thread under it
    const answered = async (messageId: string): Promise<boolean> => {
      await w.d.hooks?.pump?.();
      const under = (await w.o("chat.thread", { threadId: thread, messageId })).thread.threadId as string;
      return (
        (await mainCount()) > (sent.get(messageId) ?? 0) ||
        agentLines((await w.o("chat.messages.list", { threadId: under })).messages as Msg[]) > 0
      );
    };
    const quiet = async (messageId: string): Promise<void> => {
      for (let i = 0; i < 8; i++) {
        await new Promise((x) => setTimeout(x, 400));
        assert.equal(await answered(messageId), false, "no agent answered");
      }
    };

    assert.equal(await stop(), 403, "a guest is capped");
    // a role an admin cloned from Guest, replacing Guest
    const client = (
      await w.o("access.roles.create", { name: "Client", cloneFrom: idOf("Guest"), idempotencyKey: "st-clone" })
    ).role as { id: string };
    await w.o("access.roles.assign", { subject, roleId: client.id });
    await w.o("access.roles.unassign", { subject, roleId: idOf("Guest") });
    assert.equal(await stop(), 403, "a role cloned from Guest is capped like Guest");
    let before = skips();
    await quiet(await post("@Dex hello from a Client"));
    await settle();
    assert.equal(skips(), before + 1, "the bridge read a Client as an outsider: no agent turn");
    // Guest beside a harmless custom role
    const tag = (await w.o("access.roles.create", { name: "Tagged", idempotencyKey: "st-tag" })).role as { id: string };
    await w.o("access.roles.assign", { subject, roleId: idOf("Guest") });
    await w.o("access.roles.assign", { subject, roleId: tag.id });
    assert.equal(await stop(), 403, "a harmless custom role beside Guest changes nothing");
    // promoted to Member: standing at once, no kept answer
    await w.o("access.roles.assign", { subject, roleId: idOf("Member") });
    assert.equal(await stop(), 200, "promoted: no longer capped");
    before = skips();
    await post("@Dex hello as a member");
    await settle();
    assert.equal(
      skips(),
      before,
      "promoted: the bridge no longer reads them as an outsider, with no wait for a kept answer to run out",
    );
    // demoted again: capped at once, and the agent is quiet again
    await w.o("access.roles.unassign", { subject, roleId: idOf("Member") });
    assert.equal(await stop(), 403, "demoted: capped at once");
    before = skips();
    await quiet(await post("@Dex hello again as a guest"));
    await settle();
    assert.equal(skips(), before + 1, "demoted: an outsider again at once");
    assert.ok(api);
  } finally {
    await w.stop();
  }
});
