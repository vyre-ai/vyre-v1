// chat.rewind: the person goes back in a private chat with an agent. The engine does the folder and the hiding (engine.rewind.to); the chat leaves one line and refuses a chat with other people.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, INTAKE, MAYA, failure, harness } from "../fixtures/harness.ts";

type Fn = (ctx: any, input: any) => Promise<any>;
const h = handlers as unknown as Record<string, Fn>;
let n = 0;
const key = (): string => `rw-${++n}`;

async function world() {
  const engineCalls: Array<{ cap: string; input: any }> = [];
  const hn = harness({
    calls: {
      "agents.get": () => ({ agent: {} }),
      "engine.rewind.points": (i: any) => {
        engineCalls.push({ cap: "engine.rewind.points", input: i });
        return {
          available: true,
          points: [
            { pointId: `${INTAKE}.${"a".repeat(40)}`, at: Date.now(), files: 3, after: "Add the uploads folder" },
          ],
        };
      },
      "engine.rewind.to": (i: any) => {
        engineCalls.push({ cap: "engine.rewind.to", input: i });
        return { restored: 2, removed: 1, failed: 0, undid: false };
      },
    },
  });
  const t = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread
    .threadId as string;
  await h["chat.post"]!(hn.ctx, { threadId: t, body: "Add the uploads folder", idempotencyKey: key() });
  return { hn, t, engineCalls };
}
const lines = (hn: ReturnType<typeof harness>, t: string) =>
  hn.rows("SELECT body, blocks FROM chat_message WHERE thread = ? AND kind = 'system'", t);

test("going back asks the engine for the point, hides from before the person's message, and leaves one line that says what stays", async () => {
  const { hn, t, engineCalls } = await world();
  const pointId = `${INTAKE}.${"a".repeat(40)}`;
  const out = await h["chat.rewind"]!(hn.ctx, { threadId: t, pointId, idempotencyKey: key() });
  assert.equal(out.restored, 2);
  const to = engineCalls.find((c) => c.cap === "engine.rewind.to")!.input;
  assert.equal(to.pointId, pointId);
  assert.ok(to.afterSeq >= 0 && to.uptoSeq >= to.afterSeq);
  const [line] = lines(hn, t);
  assert.equal(line!["body"], 'Went back to before "Add the uploads folder"');
  assert.match(String(line!["blocks"]), /3 files put back\. Messages stay\. Anything already sent stays sent\./);
});

test("an agent cannot go back for the person; a chat with another person in it refuses; an unknown point is not found", async () => {
  const { hn, t } = await world();
  assert.equal(
    await failure(() =>
      h["chat.rewind"]!(hn.as({ kind: "agent", id: INTAKE }, DANA), {
        threadId: t,
        pointId: `${INTAKE}.${"a".repeat(40)}`,
        idempotencyKey: key(),
      }),
    ),
    "permission.role_lacks_permission",
  );
  assert.equal(
    await failure(() =>
      h["chat.rewind"]!(hn.ctx, { threadId: t, pointId: `${INTAKE}.${"b".repeat(40)}`, idempotencyKey: key() }),
    ),
    "validation.not_found",
  );
  await h["threads.members.add"]!(hn.ctx, { threadId: t, personId: MAYA });
  assert.equal(
    await failure(() =>
      h["chat.rewind"]!(hn.ctx, { threadId: t, pointId: `${INTAKE}.${"a".repeat(40)}`, idempotencyKey: key() }),
    ),
    "validation.precondition_failed",
  );
  assert.equal(lines(hn, t).length, 0, "no line when nothing went back");
});
