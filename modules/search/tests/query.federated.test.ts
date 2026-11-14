// Notes in the top search (Cmd-K): notes never enter this index. search.query asks notes.search as the asker, so the notes module's own rule decides what comes back: a person's own
// notes and the notes shared with them, never anyone else's private note. Their hits follow the indexed ones on the first page; a provider that fails changes nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { query } from "../handlers/query.ts";
import { asPerson, contractErrors, harness, seed } from "../fixtures/harness.ts";

/** A stand-in for notes.search that applies the same rule the notes module does: the asker's own notes, and notes shared with them. */
const NOTES = [
  {
    noteId: "nte_mine",
    owner: "usr_dana",
    shared: [] as string[],
    title: "Weinberger intake call",
    body: "Send the Lawmatics field list by Wed",
  },
  {
    noteId: "nte_shared",
    owner: "usr_noah",
    shared: ["usr_dana"],
    title: "Lab 8 run of show",
    body: "Lawmatics demo at 6:30",
  },
  {
    noteId: "nte_noah",
    owner: "usr_noah",
    shared: [] as string[],
    title: "Noah private",
    body: "Lawmatics renewal price",
  },
];
const notesSearch = (asker: string) => (input: Record<string, unknown>) => ({
  notes: NOTES.filter(
    (n) =>
      (n.owner === asker || n.shared.includes(asker)) &&
      `${n.title} ${n.body}`.toLowerCase().includes(String(input["q"]).toLowerCase()),
  ).map((n) => ({ noteId: n.noteId, title: n.title, snippet: n.body, labels: [], owner: n.owner, updatedAt: 1 })),
});

test("a person finds their own notes and those shared with them in top search, and never someone else's private note", async () => {
  const dana = harness({ respond: { "notes.search": notesSearch("usr_dana") } });
  seed(dana, { id: "rec_lm", title: "Lawmatics", kind: "record" });
  const out = await query(dana.ctx, { q: "lawmatics" });
  assert.deepEqual(
    out.hits.map((h) => [h.kind, h.id]),
    [
      ["record", "rec_lm"],
      ["note", "nte_mine"],
      ["note", "nte_shared"],
    ],
  );
  assert.deepEqual(contractErrors("search.query", "out", out), []);
  assert.equal(out.hits.find((h) => h.id === "nte_mine")!.link, "vyre://note/nte_mine");
  assert.deepEqual(
    dana.calls("notes.search").map((c) => c.input),
    [{ q: "lawmatics", limit: 5 }],
    "asked once, as the asker",
  );
  const noah = asPerson(
    dana,
    { kind: "person", id: "usr_noah" },
    { respond: { "notes.search": notesSearch("usr_noah") } },
  );
  const theirs = (await query(noah.ctx, { q: "lawmatics" })).hits.filter((h) => h.kind === "note").map((h) => h.id);
  assert.deepEqual(theirs, ["nte_shared", "nte_noah"]);
  const andrey = asPerson(
    dana,
    { kind: "person", id: "usr_andrey" },
    { respond: { "notes.search": notesSearch("usr_andrey") } },
  );
  assert.deepEqual(
    (await query(andrey.ctx, { q: "lawmatics" })).hits.filter((h) => h.kind === "note"),
    [],
    "nobody else finds a private note",
  );
  assert.equal(dana.rows("SELECT id FROM search_docs WHERE kind = 'note'").length, 0, "no note is ever in the index");
});

test("a type filter without notes, a later page, a record-type filter or a failing provider leave the answer as the index gives it", async () => {
  const h = harness({
    respond: {
      "notes.search": () => {
        throw new Error("down");
      },
    },
  });
  seed(h, { id: "rec_lm", title: "Lawmatics", kind: "record" });
  assert.deepEqual(
    (await query(h.ctx, { q: "lawmatics" })).hits.map((x) => x.id),
    ["rec_lm"],
  );
  const ok = harness({ respond: { "notes.search": notesSearch("usr_dana") } });
  seed(ok, { id: "rec_lm", title: "Lawmatics", kind: "record" });
  for (const input of [
    { q: "lawmatics", types: ["record" as const] },
    { q: "lawmatics", cursor: "20" },
    { q: "lawmatics", recordType: "client" },
  ]) {
    assert.equal(
      (await query(ok.ctx, input)).hits.some((x) => x.kind === "note"),
      false,
      JSON.stringify(input),
    );
  }
  assert.deepEqual(
    (await query(ok.ctx, { q: "lawmatics", types: ["note"] })).hits.map((x) => x.id),
    ["nte_mine", "nte_shared"],
    "the Notes filter alone",
  );
});

test("F52: a private chat is found through chat.search as the asker, once per chat, and a public thread is left to the index", async () => {
  const { FEDERATED } = await import("../handlers/query.ts");
  const chat = FEDERATED.find((p) => p.cap === "chat.search")!;
  const hit = (threadId: string, kind: string, snippet: string) => ({
    threadId,
    snippet,
    at: 5,
    thread: { kind, title: `T ${threadId}` },
  });
  const out = chat.hits(
    {
      hits: [
        hit("thr_1", "chat", "a"),
        hit("thr_1", "chat", "b"),
        hit("thr_2", "channel", "c"),
        hit("thr_3", "ask", "d"),
      ],
    },
    "words",
  );
  assert.deepEqual(
    out.map((h) => [h.id, h.title, h.link]),
    [
      ["thr_1", "T thr_1", "vyre://thread/thr_1"],
      ["thr_3", "T thr_3", "vyre://thread/thr_3"],
    ],
  );
});

test("an agent the searcher can see is found by its words in name or role, once even if the index has it, and nothing else is", async () => {
  const { FEDERATED } = await import("../handlers/query.ts");
  const p = FEDERATED.find((x) => x.cap === "agents.list")!;
  const out = {
    agents: [
      { agentId: "agt_1", name: "Quillfeather", role: "Reads harbor leases" },
      { agentId: "agt_2", name: "Other", role: "x" },
    ],
  };
  assert.deepEqual(
    p.hits(out, "quill").map((h) => h.id),
    ["agt_1"],
  );
  assert.deepEqual(
    p.hits(out, "harbor leases").map((h) => h.id),
    ["agt_1"],
  );
  assert.deepEqual(p.hits(out, "zzz"), []);
  assert.deepEqual(p.hits(out, ""), []);
  assert.deepEqual(p.input!("quill"), { limit: 200 });
});
