// A refused channels.update leaves every row as it was: the checks come before the first write (ruling 90, P-L11_32).
import test from "node:test";
import assert from "node:assert/strict";
import { channelsUpdate } from "../handlers/g24b.ts";
import { channelsCreate } from "../handlers/thread.ts";
import { INTAKE, MAYA, codeOf, harness } from "../fixtures/harness.ts";

const rowsOf = (hn: ReturnType<typeof harness>, id: string) => ({
  channel: hn.raw.all("SELECT name, nameKey, topic, visibility, updatedAt FROM chat_channel WHERE id = ?", id),
  thread: hn.raw.all("SELECT title, updated_at FROM chat_thread WHERE id = (SELECT mainThread FROM chat_channel WHERE id = ?)", id),
});

test("channels.update: a topic over 250 characters is refused and the new name is not kept", async () => {
  const hn = harness();
  hn.advance(1);
  const made = (await channelsCreate(hn.ctx, { name: "intake", visibility: "public", memberIds: [MAYA], agentIds: [INTAKE], idempotencyKey: "r1" } as any)).channel;
  const before = JSON.stringify(rowsOf(hn, made.channelId));
  hn.advance(1);
  hn.clear();
  let code = "none";
  try { await channelsUpdate(hn.ctx, { channelId: made.channelId, name: "Client intake", topic: "x".repeat(251) }); } catch (e) { code = codeOf(e); }
  assert.equal(code, "validation.bad_input");
  assert.equal(JSON.stringify(rowsOf(hn, made.channelId)), before, "no channel or thread row changed");
  assert.deepEqual(hn.emitted, [], "and no event was emitted");
});
