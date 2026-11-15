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
        return { restored: 2, removed: 1, failed: 0, failedPaths: [], undid: false, during: false, at: Date.now() };
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
  assert.deepEqual(Object.keys(to).sort(), ["pointId", "threadId"], "the range is the engine's to derive: the chat sends none");
  const [line] = lines(hn, t);
  assert.equal(line!["body"], 'Went back to before "Add the uploads folder"');
  assert.match(String(line!["blocks"]), /2 files put back, 1 file removed\. Messages stay\. Nothing already sent, no record and no task changes\./);
});

test("an agent cannot go back for the person; an unknown point is not found", async () => {
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
  assert.equal(lines(hn, t).length, 0, "no line when nothing went back");
});

test("in a chat with other people the line names who went back (the rule about whose message is the engine's, tested in modules/engine/tests/rewind.test.ts)", async () => {
  const { hn, t } = await world();
  await h["threads.members.add"]!(hn.ctx, { threadId: t, personId: MAYA });
  const out = await h["chat.rewind"]!(hn.ctx, { threadId: t, pointId: `${INTAKE}.${"a".repeat(40)}`, idempotencyKey: key() });
  assert.equal(out.restored, 2);
  const [line] = lines(hn, t);
  assert.match(String(line!["blocks"]), /"by":"usr_/, "the line names who went back");
});

test("a point finished after the agent began is said as during; a path that could not be put back is named in the line", async () => {
  const hn = harness({
    calls: {
      "agents.get": () => ({ agent: {} }),
      "engine.rewind.points": () => ({
        available: true,
        points: [{ pointId: `${INTAKE}.${"c".repeat(40)}`, at: 1, files: 1, after: "x", during: true }],
      }),
      "engine.rewind.to": () => ({ restored: 1, removed: 0, failed: 2, failedPaths: ["a.txt", "b/c.txt"], undid: false, during: true, at: 1 }),
    },
  });
  const t = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
  await h["chat.rewind"]!(hn.ctx, { threadId: t, pointId: `${INTAKE}.${"c".repeat(40)}`, idempotencyKey: key() });
  const [line] = lines(hn, t);
  assert.equal(line!["body"], 'Went back to during "x"');
  assert.match(String(line!["blocks"]), /2 could not be put back: a\.txt, b\/c\.txt/);
});
