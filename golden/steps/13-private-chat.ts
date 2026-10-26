// Golden flow 13: a private chat the server cannot read (spec 4.14; ARCH 5 b7). Two members open a private chat; the message body reaches the other and is stored as ciphertext: the server's
// tables hold no plaintext. Through the gateway with two real device sessions.
import assert from "node:assert/strict";
import { bootTolerant, expectStatus, short, Trail } from "./02-space.ts";
import type { Gap } from "./02-space.ts";
import type { Observed } from "../harness/index.ts";

export const LIVE_FOR_PRIVATE = ["chat", "identity", "vault", "devices", "access", "spaces"];
export const GAPS: Gap[] = [
  { packet: "chat live (no open PR)", lane: "L2", what: "chat has no handlers; with it dropped, chat.post answers 404 because no thread resource exists" },
];
const SECRET_TEXT = "the quarterly numbers are worse than we said";

export async function runPrivate(live: readonly string[]): Promise<{ events: Observed[]; trail: Trail }> {
  const trail = new Trail();
  const { s } = await bootTolerant(trail, live);
  if (!s) return { events: [], trail };
  try {
    const noah = s.signedIn("usr_noah"), sana = s.signedIn("usr_sana");
    const thread = await trail.step("Noah opens a private chat with Sana", async () =>
      expectStatus(await s.call("chat.start", noah, { idempotencyKey: "golden-13-chat", kind: "chat", agentIds: [], personId: "usr_sana" }), 200, "chat.start").thread.threadId as string);
    await trail.step("he sends a message", async () => {
      expectStatus(await s.call("chat.post", noah, { idempotencyKey: "golden-13-msg", threadId: thread!, body: SECRET_TEXT }), 200, "chat.post");
    }, ["Noah opens a private chat with Sana"]);
    await trail.step("Sana's device receives it", async () => {
      const msgs = expectStatus(await s.call("chat.messages.list", sana, { threadId: thread! }), 200, "chat.messages.list").messages as { body?: string }[];
      assert.ok(msgs.length >= 1, `Sana sees ${short(msgs)}`);
    }, ["he sends a message"]);
    await trail.step("the server's tables hold no plaintext of it", async () => {
      const tables = (s.d.db!.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'chat\\_%' ESCAPE '\\'") as { name: string }[]).map((t) => t.name);
      assert.ok(tables.length > 0, "the chat module has tables");
      for (const t of tables) {
        const rows = s.d.db!.all(`SELECT * FROM "${t}"`);
        const hit = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(SECRET_TEXT.slice(0, 20)));
        assert.equal(hit.length, 0, `${t} holds the plaintext`);
      }
    }, ["he sends a message"]);
    return { events: await s.events(), trail };
  } finally { await s.stop(); }
}

export default async function steps(): Promise<Observed[]> {
  const { events, trail } = await runPrivate([]);
  if (trail.failures.length) throw new Error(`flow 13 failed:\n${trail.report()}`);
  return events;
}
