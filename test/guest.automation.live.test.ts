// An Automation that starts on a chat message does not run for a guest (lane f-guest, 14 Nov 2026, the lead's ruling). A guest's post in a channel is a message like any other, but the Automation runs under its own
// standing, which reaches what its owner's does, so a person with no standing in the Space does not start one by posting. The drop is logged (automation.trigger_dropped, reason outsider). A member's post runs it, a
// guest promoted to member starts it from their next post, and a role cloned from Guest does not.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { world } from "./guest-channel-kit.ts";

type Msg = { body?: string };

test("a guest's post starts no on-message Automation and the drop is logged; a member's and a promoted guest's post does", async () => {
  const w = await world();
  try {
    const g = await w.invite(w.pub, "reply", "auto@example.com", "autoguest");
    const made = await w.o("automations.create", {
      name: "On channel message",
      idempotencyKey: "au-1",
      definition: {
        triggers: [{ key: "chat_message" }],
        nodes: [
          {
            id: "a",
            key: "post_message",
            input: { threadId: w.other.mainThreadId, text: "FIRED-AUTOMATION from {{ trigger.author.id }}" },
          },
        ],
      },
    });
    await w.o("automations.set_enabled", { automationId: (made.automation?.id ?? made.id) as string, enabled: true });
    const fired = async (): Promise<number> =>
      ((await w.o("chat.messages.list", { threadId: w.other.mainThreadId })).messages as Msg[]).filter((m) =>
        (m.body ?? "").includes("FIRED-AUTOMATION"),
      ).length;
    const dropped = (): number => {
      w.d.sink.flush();
      const db = new DatabaseSync(w.d.paths.events ?? `${w.dir}/events.db`, { readOnly: true });
      const rows = db.prepare("SELECT payload FROM events WHERE type = 'automation.trigger_dropped'").all() as Array<{
        payload: Uint8Array;
      }>;
      db.close();
      return rows.filter((r) => Buffer.from(r.payload).toString("utf8").includes('"outsider"')).length;
    };
    const settle = async (): Promise<void> => {
      for (let i = 0; i < 14; i++) {
        await w.d.hooks?.pump?.();
        await new Promise((x) => setTimeout(x, 300));
      }
    };

    await w.o("chat.post", { threadId: w.pub.mainThreadId, body: "a member of the Space speaks" });
    await settle();
    const afterOwner = await fired();
    assert.ok(afterOwner >= 1, "control: the owner's post starts it");
    // a guest posts: no run, and the drop is in the log
    await g.call("chat.post", { threadId: w.pub.mainThreadId, body: "a guest speaks" });
    await settle();
    assert.equal(await fired(), afterOwner, "a guest's post starts nothing");
    assert.ok(dropped() >= 1, "and the drop is logged with the reason outsider");
    // a role cloned from Guest, replacing Guest: still not run
    const roles = (await w.o("access.roles.list")).roles as Array<{ id: string; name: string }>;
    const idOf = (n: string): string => roles.find((r) => r.name === n)!.id;
    const subject = { kind: "person", id: g.personId };
    const client = (
      await w.o("access.roles.create", { name: "Client", cloneFrom: idOf("Guest"), idempotencyKey: "au-clone" })
    ).role as { id: string };
    await w.o("access.roles.assign", { subject, roleId: client.id });
    await w.o("access.roles.unassign", { subject, roleId: idOf("Guest") });
    await g.call("chat.post", { threadId: w.pub.mainThreadId, body: "a Client speaks" });
    await settle();
    assert.equal(await fired(), afterOwner, "a role cloned from Guest starts nothing");
    // promoted to member: the next post runs it
    await w.o("access.roles.assign", { subject, roleId: idOf("Member") });
    await g.call("chat.post", { threadId: w.pub.mainThreadId, body: "now a member speaks" });
    await settle();
    assert.equal(await fired(), afterOwner + 1, "a guest made a member starts it from their next post, with no wait");
  } finally {
    await w.stop();
  }
});
