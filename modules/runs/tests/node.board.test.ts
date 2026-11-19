// The board and the messages of a tree (r42-runtime slice 5): evidence is required, disagreement is kept and asked about, a message is delivered once, in order, to a node that still lives, and the people who only watch see none of it.
import test from "node:test";
import assert from "node:assert/strict";
import { codeOf, harness, hold, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, engine } from "../fixtures/seed.ts";

const THREAD = `thr_${"a".repeat(32)}`;
const CALDER = `agt_${"c".repeat(32)}`;
const PINE = `agt_${"d".repeat(32)}`;
const calder = { id: CALDER, kind: "agent" as const, depth: 0 };
const pine = { id: PINE, kind: "agent" as const, depth: 0 };
const owner = { ...alice, depth: 0 };
const chatMember = (who: { id: string }, action: { level: string }, res: { type: string }): boolean =>
  who.id === "usr_bob" && action.level === "view" && res.type === "thread";

async function tree(h: Harness) {
  const root = (await h.call("runs.node.start", { kind: "turn", owner: alice.id, threadId: THREAD }, engine)).node;
  const mk = async (who: string, name: string) => {
    h.advance(1);
    const n = (
      await h.call(
        "runs.node.start",
        {
          kind: "helper",
          owner: alice.id,
          parentRun: root.id,
          name: `${name} task as the model wrote it`,
          whoName: name,
          whoKind: "agent",
          whoId: who,
        },
        engine,
      )
    ).node;
    await h.call("runs.node.claim", { runId: n.id, holder: "host:a" }, engine);
    return n;
  };
  return { root, a: await mk(CALDER, "Calder"), b: await mk(PINE, "Pine") };
}
const put = (h: Harness, who: Parameters<Harness["call"]>[2], runId: string, over: Record<string, unknown>) =>
  h.call("runs.board.put", { runId, kind: "fact", text: "x", evidence: ["vyre://file/f1"], ...over }, who);

test("a fact or a decision needs what it stands on; a question needs nothing; a node writes only as itself", async () => {
  const h = harness();
  const { a, b } = await tree(h);
  const bad = await put(h, calder, a.id, { evidence: [] }).catch((e) => e);
  assert.equal(reasonOf(bad), "no_evidence");
  const ok = await put(h, calder, a.id, { text: "Calder bid is 3,400", topic: "calder price" });
  assert.deepEqual(ok.entry.evidence, ["vyre://file/f1"]);
  assert.equal(ok.entry.byRun, a.id);
  const q = await put(h, calder, a.id, { kind: "question", text: "Is delivery included?", evidence: [] });
  assert.equal(q.entry.kind, "question");
  assert.equal(
    codeOf(await put(h, pine, a.id, {}).catch((e) => e)),
    "permission.not_found",
    "Pine cannot write as Calder",
  );
  assert.equal(codeOf(await put(h, calder, b.id, {}).catch((e) => e)), "permission.not_found");
  const w = await put(h, owner, a.id, { text: "The owner may write for the node" });
  assert.ok(w.entry.id);
});

test("the same node saying a topic again replaces its earlier word; two nodes that disagree both stay and one question is raised, once", async () => {
  const h = harness();
  const { root, a, b } = await tree(h);
  await put(h, calder, a.id, { text: "Calder 3,400", topic: "price" });
  h.advance(1);
  await put(h, calder, a.id, { text: "Calder 3,350", topic: "price" });
  let list = (await h.call("runs.board.list", { runId: root.id }, owner)).entries;
  assert.deepEqual(
    list.map((e: any) => e.text),
    ["Calder 3,350"],
  ); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(
    (await h.call("runs.board.list", { runId: root.id, all: true }, owner)).entries.length,
    2,
    "the earlier word is kept and points at the new one",
  );
  h.advance(1);
  const clash = await put(h, pine, b.id, { text: "Pine says 3,820", topic: "price" });
  assert.ok(clash.conflict);
  h.advance(1);
  await put(h, pine, b.id, { text: "Pine says 3,900", topic: "price" });
  list = (await h.call("runs.board.list", { runId: root.id }, owner)).entries;
  assert.equal(list.filter((e: any) => e.kind === "question").length, 1, "one question however often they disagree"); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(list.filter((e: any) => e.kind === "fact").length, 2); // eslint-disable-line @typescript-eslint/no-explicit-any
});

test("a question is answered by the parent's agent, the owner or the server, never by the node that asked, and the first answer stands", async () => {
  const h = harness();
  const { root, a } = await tree(h);
  const q = (await put(h, calder, a.id, { kind: "question", text: "Include delivery?", evidence: [] })).entry;
  assert.equal(
    codeOf(await h.call("runs.board.answer", { runId: a.id, entryId: q.id, text: "yes" }, calder).catch((e) => e)),
    "permission.not_found",
  );
  const done = await h.call("runs.board.answer", { runId: a.id, entryId: q.id, text: "Yes, include it" }, owner);
  assert.equal(done.entry.answer.text, "Yes, include it");
  const again = await h.call("runs.board.answer", { runId: a.id, entryId: q.id, text: "No" }, owner);
  assert.equal(again.entry.answer.text, "Yes, include it");
  const notQ = (await put(h, calder, a.id, { text: "A fact" })).entry;
  assert.equal(
    reasonOf(await h.call("runs.board.answer", { runId: a.id, entryId: notQ.id, text: "x" }, owner).catch((e) => e)),
    "no_question",
  );
  void root;
});

test("a message goes to a sibling or the parent, once, in order, and is told when it was delivered and seen", async () => {
  const h = harness();
  const { root, a, b } = await tree(h);
  const m1 = await h.call(
    "runs.message.send",
    { runId: a.id, to: b.id, body: "Pine's price changed to 3,820", key: "k1" },
    calder,
  );
  h.advance(1);
  await h.call("runs.message.send", { runId: a.id, to: b.id, body: "And delivery is included" }, calder);
  const dup = await h.call(
    "runs.message.send",
    { runId: a.id, to: b.id, body: "Pine's price changed to 3,820", key: "k1" },
    calder,
  );
  assert.equal(dup.duplicate, true);
  assert.equal(dup.message.id, m1.message.id);
  const up = await h.call("runs.message.send", { runId: a.id, to: "parent", body: "Done with Calder" }, calder);
  assert.equal(up.message.toRun, root.id);
  const first = await h.call("runs.message.take", { runId: b.id }, engine);
  assert.deepEqual(
    first.messages.map((m: any) => m.body),
    ["Pine's price changed to 3,820", "And delivery is included"],
  ); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(
    first.messages.map((m: any) => m.fromName),
    ["Calder", "Calder"],
    "each says who it is from, in words",
  ); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal((await h.call("runs.message.take", { runId: b.id }, engine)).messages.length, 0, "delivered once");
  assert.equal((await h.call("runs.message.seen", { messageIds: [m1.message.id] }, engine)).marked, 1);
  const list = (await h.call("runs.message.list", { runId: a.id }, owner)).messages;
  const got = list.find((m: any) => m.id === m1.message.id); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.ok(got.deliveredAt && got.seenAt);
  assert.equal((await h.call("runs.message.list", { runId: root.id, tree: true }, owner)).messages.length, 3);
});

test("two nodes writing to one receiver at once are two messages in order; a message to a finished node or to another tree is refused", async () => {
  const h = harness();
  const { root, a, b } = await tree(h);
  const other = (await h.call("runs.node.start", { kind: "turn", owner: alice.id }, engine)).node;
  await Promise.all([
    h.call("runs.message.send", { runId: a.id, to: root.id, body: "from Calder" }, calder),
    h.call("runs.message.send", { runId: b.id, to: root.id, body: "from Pine" }, pine),
  ]);
  assert.equal((await h.call("runs.message.take", { runId: root.id }, engine)).messages.length, 2);
  assert.equal(
    reasonOf(await h.call("runs.message.send", { runId: a.id, to: other.id, body: "x" }, calder).catch((e) => e)),
    "not_in_tree",
  );
  await h.call("runs.node.move", { ...hold(h, b.id), runId: b.id, to: "stopped", why: "stopped" }, engine);
  assert.equal(
    reasonOf(await h.call("runs.message.send", { runId: a.id, to: b.id, body: "x" }, calder).catch((e) => e)),
    "receiver_finished",
  );
  assert.equal(
    codeOf(await h.call("runs.message.take", { runId: root.id }, owner).catch((e) => e)),
    "permission.no_grant",
  );
});

test("people who only watch the chat see no board and no messages; the log of the tree records both for the owner", async () => {
  const h = harness({ authorize: chatMember });
  const { root, a, b } = await tree(h);
  await put(h, calder, a.id, { text: "Calder 3,400" });
  await h.call("runs.message.send", { runId: a.id, to: b.id, body: "secret" }, calder);
  const bob = { id: "usr_bob", kind: "person" as const, depth: 0 };
  assert.deepEqual((await h.call("runs.board.list", { runId: root.id }, bob)).entries, []);
  assert.equal(
    codeOf(await h.call("runs.message.list", { runId: root.id, tree: true }, bob).catch((e) => e)),
    "permission.not_found",
  );
  const types = (await h.call("runs.events.list", { runId: root.id }, owner)).events.map((e: any) => e.type); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.ok(types.includes("board") && types.includes("message"));
  const seen = (await h.call("runs.events.list", { runId: root.id }, bob)).events;
  assert.equal(JSON.stringify(seen).includes("secret"), false);
});

test("only a node of the tree writes to its board: an agent whose node is in another tree is refused, on the board and by message", async () => {
  const h = harness();
  const { root, a } = await tree(h);
  const other = (
    await h.call("runs.node.start", { kind: "helper", owner: alice.id, whoKind: "agent", whoId: PINE }, engine)
  ).node;
  assert.equal(
    codeOf(await put(h, pine, a.id, {}).catch((e) => e)),
    "permission.not_found",
    "pine's node is elsewhere; it cannot use calder's",
  );
  assert.equal(codeOf(await put(h, pine, root.id, {}).catch((e) => e)), "permission.not_found");
  const ok = await put(h, pine, other.id, { text: "Pine writes to its own tree" });
  assert.equal(ok.entry.rootRun, other.id, "and it lands on its own board, not on the other tree's");
  assert.equal(
    (await h.call("runs.board.list", { runId: root.id }, owner)).entries.some((e: any) => e.byRun === other.id),
    false,
  ); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(
    reasonOf(await h.call("runs.message.send", { runId: other.id, to: a.id, body: "hello" }, pine).catch((e) => e)),
    "not_in_tree",
  );
});

test("a question of another tree cannot be answered from this one: the same id is not found, whoever may answer here", async () => {
  const h = harness({ authorize: (who, action) => who.id === "usr_admin" && action.perm === "runs.manage" });
  const one = await tree(h);
  const two = await tree(h);
  const q = (await put(h, calder, two.a.id, { kind: "question", text: "Include delivery?", evidence: [] })).entry;
  const admin = { id: "usr_admin", kind: "person" as const, depth: 0 };
  const e = await h
    .call("runs.board.answer", { runId: one.root.id, entryId: q.id, text: "Injected answer" }, admin)
    .catch((x) => x);
  assert.equal(codeOf(e), "permission.not_found");
  assert.equal(
    (await h.call("runs.board.list", { runId: two.root.id }, admin)).entries.find((x: any) => x.id === q.id).answer,
    undefined,
  ); // eslint-disable-line @typescript-eslint/no-explicit-any
  const fine = await h.call("runs.board.answer", { runId: two.root.id, entryId: q.id, text: "Yes" }, admin);
  assert.equal(fine.entry.answer.text, "Yes");
});

test("a note is signed with the real name of who works, never the label a model gave its task", async () => {
  const h = harness();
  const { a, b } = await tree(h);
  await h.call("runs.message.send", { runId: a.id, to: b.id, body: "Price changed" }, calder);
  const got = (await h.call("runs.message.take", { runId: b.id }, engine)).messages[0];
  assert.equal(got.fromName, "Calder");
  assert.match(
    (await h.call("runs.node.get", { runId: a.id }, owner)).node.name,
    /task as the model wrote it/,
    "the label stays on the node",
  );
  assert.notEqual(got.fromName, "Calder task as the model wrote it");
});
