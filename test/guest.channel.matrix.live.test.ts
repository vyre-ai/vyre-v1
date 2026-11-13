// Nothing changes for everyone else (lane f-guest, 13 Nov 2026). The channel's chat and its reply threads now live in the channel for access. This matrix is what every NON-guest gets in a public channel and in an
// invite-only one, as read from a real daemon on rc.26 BEFORE that change: the same table must come back after it. A cell that differs is a regression. VYRE_MATRIX_OUT writes the table as it was read.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, seededDir } from "./memory-live-kit.ts";
import { api, join, ok, standIn } from "./member-key-kit.ts";

type Cell = Record<string, number | boolean>;

test("members, admins and the owner see the same table of reads, posts, reply threads and search as before", async () => {
  const dir = seededDir();
  const d = await boot(dir, standIn);
  try {
    const o = (cap: string, input: Record<string, unknown> = {}) => ok(d, d.token, cap, input);
    const agent = (await o("agents.create", { name: "Dex", role: "You help." })).agent.agentId as string;
    const maya = await join(d, "maya", "maya@example.com"),
      noah = await join(d, "noah", "noah@example.com"),
      ana = await join(d, "ana", "ana@example.com");
    const adm = await join(d, "adam", "adam@example.com", "Admin");
    const pub = (
      await o("channels.create", {
        name: "partners",
        visibility: "public",
        memberIds: [maya.personId],
        agentIds: [agent],
      })
    ).channel as { mainThreadId: string };
    const priv = (
      await o("channels.create", {
        name: "deal-room",
        visibility: "invite",
        memberIds: [noah.personId],
        agentIds: [agent],
      })
    ).channel as { mainThreadId: string };
    const first: Record<string, string> = {};
    for (const [k, c] of [
      ["pub", pub],
      ["priv", priv],
    ] as const) {
      const out = await o("chat.post", { threadId: c.mainThreadId, body: `zebramark ${k}` });
      first[k] = (out.messageId ?? out.message?.messageId ?? out.message?.id) as string;
    }
    // a reply thread the owner made in each, so "post in it" has one to find
    const reply: Record<string, string> = {};
    for (const [k, c] of [
      ["pub", pub],
      ["priv", priv],
    ] as const)
      reply[k] = (await o("chat.thread", { threadId: c.mainThreadId, messageId: first[k]! })).thread.threadId as string;

    const actors: Array<[string, string]> = [
      ["owner", d.token],
      ["maya(in pub)", maya.token],
      ["noah(in priv)", noah.token],
      ["ana(in neither)", ana.token],
      ["admin(in neither)", adm.token],
    ];
    const table: Record<string, Cell> = {};
    let n = 0;
    for (const [who, token] of actors)
      for (const k of ["pub", "priv"] as const) {
        const c = k === "pub" ? pub : priv;
        const call = (cap: string, input: Record<string, unknown>) =>
          api(d, token, cap, { idempotencyKey: `m-${who}-${k}-${n++}`, ...input });
        const cell: Cell = {};
        cell["read.get"] = (await call("threads.get", { threadId: c.mainThreadId })).status;
        cell["read.messages"] = (await call("chat.messages.list", { threadId: c.mainThreadId })).status;
        cell["post"] = (await call("chat.post", { threadId: c.mainThreadId, body: `from ${who}` })).status;
        cell["reply.open"] = (await call("chat.thread", { threadId: c.mainThreadId, messageId: first[k]! })).status;
        cell["reply.get"] = (await call("threads.get", { threadId: reply[k]! })).status;
        cell["reply.post"] = (await call("chat.post", { threadId: reply[k]!, body: `reply from ${who}` })).status;
        const found = await call("chat.history.search", { q: `zebramark ${k}` });
        cell["search.status"] = found.status;
        cell["search.finds"] = found.status === 200 && JSON.stringify(found.data).includes(`zebramark ${k}`);
        table[`${who} / ${k}`] = cell;
      }
    if (process.env["VYRE_MATRIX_OUT"])
      fs.writeFileSync(process.env["VYRE_MATRIX_OUT"], JSON.stringify(table, null, 1) + "\n");
    // rc.26's own answers, read from a real daemon before the change (the invite-only channel answers a member who is not in it 404 from the chat handler's mayEnterChannel; the kernel lets every member through)
    const expected = JSON.parse(fs.readFileSync(new URL("./guest.channel.matrix.rc26.json", import.meta.url), "utf8"));
    assert.deepEqual(table, expected, "the table differs from what rc.26 answered");
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
