// The memory graph (spec 2.15, 3.5; ARCH 6.10): the consumer that indexes notes, records and chats, and the reads built per viewer through access checks, with clusters named after
// their hub, a time slider, saved positions, the admin "everything" view that is logged, and an export that leaves personal layers out. Data is shaped for sigma.js and graphology.
import test from "node:test";
import assert from "node:assert/strict";
import { classify, graph, graphEverything, graphExport, indexGraph, layoutGet, layoutSave } from "../handlers/graph.ts";
import { pointer, readNote } from "../handlers/facts.ts";
import { asPerson, assertEventsConform, codeOf, contractErrors, DAY, harness, NOW, seedFact } from "../fixtures/harness.ts";
import type { Harness, Responder } from "../fixtures/harness.ts";

interface F { folder: string; name: string; text: string; owner?: string; created?: number; deleted?: boolean }
const FOLDERS: Record<string, string> = {
  fld_notes: "Agents/Intake/memory/notes", fld_harlow: "Projects/Harlow/memory", fld_space: "Knowledge/Memory", fld_priv: "People/Dana/memory/Intake", fld_docs: "Documents",
};

function setup(files: Record<string, F>, extra: Record<string, Responder> = {}) {
  const respond: Record<string, Responder> = {
    "files.get": (i) => {
      const f = files[String(i["fileId"])];
      if (!f) throw new Error("no such file");
      return { file: { fileId: i["fileId"], folderId: f.folder, name: f.name, ownerId: f.owner ?? "usr_dana", createdAt: f.created ?? NOW - DAY, updatedAt: NOW, kind: "markdown", ...(f.deleted ? { deletedAt: NOW } : {}) } };
    },
    "files.folder.get": (i) => ({ folder: { path: FOLDERS[String(i["folderId"])] ?? "Elsewhere" } }),
    "files.read": (i) => ({ text: files[String(i["fileId"])]?.text ?? "" }),
    "agents.list": () => ({ agents: [{ agentId: "agt_intake", name: "Intake" }] }),
    "agents.get": () => ({ agent: { folderId: "fld_intake", ownerId: "usr_boss" } }),
    "projects.list": () => ({ projects: [{ projectId: "prj_harlow", title: "Harlow" }] }),
    "projects.get": () => ({ project: { folderId: "fld_harlow_proj", lead: "usr_lead" } }),
    "records.get": (i) => {
      const id = String(i["recordId"]);
      if (id === "rec_acme") return { record: { id, type: "client", fields: { name: "Acme", owner: "rec_dana" }, createdAt: NOW - 2 * DAY } };
      if (id === "rec_dana") return { record: { id, type: "person", fields: { name: "Dana" }, createdAt: NOW - 2 * DAY } };
      throw new Error("no such record");
    },
    "threads.get": () => ({ thread: { title: "Kickoff", createdAt: NOW - 3 * DAY } }),
    ...extra,
  };
  return harness({ respond });
}

const FILES: Record<string, F> = {
  fil_clients: { folder: "fld_notes", name: "Clients.md", text: "# Clients\nSee [[Escalation]] and [[Harlow]]." },
  fil_esc: { folder: "fld_notes", name: "Escalation.md", text: "# Escalation\nBack to [[Clients]]." },
  fil_harlow: { folder: "fld_harlow", name: "Harlow.md", text: "---\ntitle: Harlow\n---\nTeal and copper." },
  fil_space: { folder: "fld_space", name: "Handbook.md", text: "# Handbook\nStart at [[Clients]]." },
  fil_lonely: { folder: "fld_notes", name: "Lonely.md", text: "# Lonely\nNothing links here.", created: NOW + DAY },
  fil_priv: { folder: "fld_priv", name: "Travel.md", text: "# Travel plans\nLisbon in May." },
  fil_other: { folder: "fld_docs", name: "Budget.md", text: "# Budget" },
};

async function indexAll(h: Harness): Promise<void> {
  let seq = 1;
  for (const id of ["fil_clients", "fil_esc", "fil_harlow", "fil_space", "fil_lonely", "fil_priv", "fil_other"]) await indexGraph(h.ctx, { entity: "file", id, seq: seq++ });
  await indexGraph(h.ctx, { entity: "record:client", id: "rec_acme", seq: 1 });
  await indexGraph(h.ctx, { entity: "record:person", id: "rec_dana", seq: 1 });
  await indexGraph(h.ctx, { entity: "chat", id: "thr_one", seq: 1 });
  seedFact(h, { id: "fct_cf", layer: "agent", agentId: "agt_intake", noteId: "not_clients", text: "Acme is our oldest client", sourceKind: "record", sourceRef: "rec_acme" });
}

const ids = (g: { nodes: Array<{ nodeId: string }> }): string[] => g.nodes.map((n) => n.nodeId).sort();

test("a file's folder tells which layer its note is in, and personal and non-memory files are not memory graph material", () => {
  assert.deepEqual(classify("Agents/Intake/memory/notes/Clients.md"), { layer: "agent", area: "notes", agentName: "Intake", projectName: null, personFolder: null });
  assert.equal(classify("Agents/Intake/memory/proposed/x.md")?.area, "proposed");
  assert.equal(classify("Agents/Intake/memory/MAP.md")?.area, "notes");
  assert.equal(classify("Projects/Harlow/memory/Plan.md")?.layer, "project");
  assert.equal(classify("Knowledge/Memory/Handbook.md")?.layer, "space");
  assert.equal(classify("People/Dana/memory/Intake/Travel.md")?.layer, "person");
  assert.equal(classify("Documents/Budget.md"), null);
  assert.equal(classify("Agents/Intake/other/x.md"), null);
});

test("indexing builds nodes and resolves [[links]] in either order", async () => {
  const h = setup(FILES);
  assert.deepEqual(await indexGraph(h.ctx, { entity: "file", id: "fil_clients", seq: 1 }), { nodes: 1, edges: 0 });
  assert.deepEqual(await indexGraph(h.ctx, { entity: "file", id: "fil_esc", seq: 1 }), { nodes: 1, edges: 2 });
  assert.deepEqual(await indexGraph(h.ctx, { entity: "file", id: "fil_harlow", seq: 1 }), { nodes: 1, edges: 1 });
  assert.deepEqual(await indexGraph(h.ctx, { entity: "file", id: "fil_space", seq: 1 }), { nodes: 1, edges: 1 });
  assert.deepEqual(await indexGraph(h.ctx, { entity: "file", id: "fil_lonely", seq: 1 }), { nodes: 1, edges: 0 });
  const edges = h.rows("SELECT from_id, to_id, kind FROM memory_graph_edges ORDER BY from_id, to_id").map((r) => `${r["from_id"]}>${r["to_id"]}:${r["kind"]}`);
  assert.deepEqual(edges, [
    "note:fil_clients>note:fil_esc:link", "note:fil_clients>note:fil_harlow:link", "note:fil_esc>note:fil_clients:link", "note:fil_space>note:fil_clients:link",
  ]);
  const note = h.rows("SELECT layer, owner_ref, agent_id, project_id, title, area FROM memory_notes WHERE file_id = 'fil_harlow'")[0]!;
  assert.deepEqual([note["layer"], note["owner_ref"], note["project_id"], note["title"], note["area"]], ["project", "prj_harlow", "prj_harlow", "Harlow", "notes"]);
  assert.equal(h.rows("SELECT agent_id FROM memory_notes WHERE file_id = 'fil_clients'")[0]?.["agent_id"], "agt_intake");
});

test("the same or an older sequence number does nothing and asks nothing", async () => {
  const h = setup(FILES);
  await indexGraph(h.ctx, { entity: "file", id: "fil_clients", seq: 5 });
  const asked = h.called.length;
  assert.deepEqual(await indexGraph(h.ctx, { entity: "file", id: "fil_clients", seq: 5 }), { nodes: 0, edges: 0 });
  assert.deepEqual(await indexGraph(h.ctx, { entity: "file", id: "fil_clients", seq: 4 }), { nodes: 0, edges: 0 });
  assert.equal(h.called.length, asked);
  assert.deepEqual(await indexGraph(h.ctx, { entity: "file", id: "fil_clients", seq: 6 }), { nodes: 1, edges: 0 });
});

test("a personal note is indexed for its owner but never becomes a node, and a note moved there leaves the graph", async () => {
  const files = { ...FILES };
  const h = setup(files);
  assert.deepEqual(await indexGraph(h.ctx, { entity: "file", id: "fil_priv", seq: 1 }), { nodes: 0, edges: 0 });
  assert.equal(h.rows("SELECT node_id FROM memory_graph_nodes").length, 0);
  const row = h.rows("SELECT title, sealed_title, body, layer FROM memory_notes WHERE file_id = 'fil_priv'")[0]!;
  assert.equal(row["layer"], "person");
  assert.equal(row["title"], "");
  assert.equal(row["body"], "");
  assert.ok(!String(row["sealed_title"]).includes("Travel"));
  await indexGraph(h.ctx, { entity: "file", id: "fil_clients", seq: 1 });
  assert.equal(h.rows("SELECT node_id FROM memory_graph_nodes").length, 1);
  files["fil_clients"] = { ...FILES["fil_clients"]!, folder: "fld_priv" };
  assert.deepEqual(await indexGraph(h.ctx, { entity: "file", id: "fil_clients", seq: 2 }), { nodes: 0, edges: 0 });
  assert.equal(h.rows("SELECT node_id FROM memory_graph_nodes").length, 0);
});

test("a deleted file, a missing file and a file outside memory leave no node", async () => {
  const files = { ...FILES, fil_gone: { folder: "fld_notes", name: "Gone.md", text: "# Gone", deleted: true } };
  const h = setup(files);
  assert.deepEqual(await indexGraph(h.ctx, { entity: "file", id: "fil_gone", seq: 1 }), { nodes: 0, edges: 0 });
  assert.deepEqual(await indexGraph(h.ctx, { entity: "file", id: "fil_missing", seq: 1 }), { nodes: 0, edges: 0 });
  assert.deepEqual(await indexGraph(h.ctx, { entity: "file", id: "fil_other", seq: 1 }), { nodes: 0, edges: 0 });
  assert.equal(h.rows("SELECT node_id FROM memory_graph_nodes").length, 0);
  await assert.rejects(() => indexGraph(h.ctx, { entity: "email", id: "x", seq: 1 }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(() => indexGraph(h.ctx, { entity: "record", id: "rec_acme", seq: 1 }), (e) => codeOf(e) === "validation.bad_input");
});

test("records and chats become nodes, record relations become edges, and the kind follows the record type", async () => {
  const h = setup(FILES);
  assert.deepEqual(await indexGraph(h.ctx, { entity: "record:client", id: "rec_acme", seq: 1 }), { nodes: 1, edges: 1 });
  assert.deepEqual(await indexGraph(h.ctx, { entity: "record:person", id: "rec_dana", seq: 1 }), { nodes: 1, edges: 0 });
  assert.deepEqual(await indexGraph(h.ctx, { entity: "thread", id: "thr_one", seq: 1 }), { nodes: 1, edges: 0 });
  const kinds = Object.fromEntries(h.rows("SELECT node_id, kind, title, res_type FROM memory_graph_nodes").map((r) => [r["node_id"], `${r["kind"]}:${r["title"]}:${r["res_type"]}`]));
  assert.deepEqual(kinds, { "record:rec_acme": "client:Acme:record", "record:rec_dana": "person:Dana:record", "chat:thr_one": "chat:Kickoff:thread" });
  assert.deepEqual(await indexGraph(h.ctx, { entity: "record:client", id: "rec_gone", seq: 1 }), { nodes: 0, edges: 0 });
});

test("an agent's graph holds its notes, the project and Space notes, and what they touch; clusters are named after their hub", async () => {
  const h = setup(FILES);
  await indexAll(h);
  const g = await graph(h.ctx, { scope: "agent", agentId: "agt_intake" });
  assert.deepEqual(ids(g), ["note:fil_clients", "note:fil_esc", "note:fil_harlow", "note:fil_lonely", "note:fil_space", "record:rec_acme"]);
  assert.deepEqual(contractErrors("memory.graph", "out", g), []);
  assert.deepEqual(g.clusters, [{ name: "Clients", hub: "note:fil_clients", size: 5 }]);
  const byId = Object.fromEntries(g.nodes.map((n) => [n.nodeId, n]));
  assert.equal(byId["note:fil_clients"]?.cluster, "Clients");
  assert.equal(byId["note:fil_lonely"]?.cluster, undefined);
  assert.equal(byId["record:rec_acme"]?.kind, "client");
  assert.equal(byId["note:fil_clients"]?.layer, "agent");
  assert.equal(byId["note:fil_clients"]?.link, "/files/fil_clients");
  for (const n of g.nodes) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), "every node has a position");
  assert.equal(new Set(g.nodes.map((n) => `${n.x},${n.y}`)).size, g.nodes.length, "no two nodes share a position");
  const kinds = g.edges.map((e) => e.kind);
  assert.ok(kinds.includes("link") && kinds.includes("came_from"));
  assert.ok(g.edges.some((e) => e.from === "note:fil_clients" && e.to === "record:rec_acme" && e.kind === "came_from"));
  // Personal memory is nowhere.
  assert.ok(!JSON.stringify(g).includes("Travel"));
  // The same input gives the same picture.
  assert.deepEqual(await graph(h.ctx, { scope: "agent", agentId: "agt_intake" }), g);
  await assert.rejects(() => graph(h.ctx, { scope: "agent" }), (e) => codeOf(e) === "validation.bad_input");
});

test("the Space graph adds everything, records and chats included", async () => {
  const h = setup(FILES);
  await indexAll(h);
  const g = await graph(h.ctx, { scope: "space" });
  assert.deepEqual(ids(g), ["chat:thr_one", "note:fil_clients", "note:fil_esc", "note:fil_harlow", "note:fil_lonely", "note:fil_space", "record:rec_acme", "record:rec_dana"]);
  assert.deepEqual(g.clusters, [{ name: "Clients", hub: "note:fil_clients", size: 6 }]);
  assert.equal(g.nodes.find((n) => n.nodeId === "chat:thr_one")?.cluster, undefined);
});

test("each viewer gets only the nodes they may see, and edges to hidden nodes go too", async () => {
  const h = setup(FILES);
  await indexAll(h);
  h.deny("file:fil_harlow");
  h.deny("record:rec_acme");
  const g = await graph(h.ctx, { scope: "space" });
  assert.ok(!ids(g).includes("note:fil_harlow") && !ids(g).includes("record:rec_acme"));
  assert.ok(g.edges.every((e) => ids(g).includes(e.from) && ids(g).includes(e.to)));
  assert.deepEqual(g.clusters, [{ name: "Clients", hub: "note:fil_clients", size: 3 }]);
  const omar = asPerson(h, { kind: "person", id: "usr_omar" });
  assert.equal(ids(await graph(omar.ctx, { scope: "space" })).length, 8, "Omar is not denied anything in this test");
});

test("the time slider shows the graph as it was, and a kind filter narrows it", async () => {
  const h = setup(FILES);
  await indexAll(h);
  const early = await graph(h.ctx, { scope: "space", asOf: NOW - 2.5 * DAY });
  assert.deepEqual(ids(early), ["chat:thr_one"]);
  const now = await graph(h.ctx, { scope: "space", asOf: NOW });
  assert.ok(!ids(now).includes("note:fil_lonely"), "created tomorrow");
  assert.equal(ids(now).length, 7);
  const notes = await graph(h.ctx, { scope: "space", kinds: ["note"] });
  assert.ok(notes.nodes.every((n) => n.kind === "note"));
  assert.ok(notes.edges.every((e) => e.kind === "link"));
});

test("saved positions replace the computed ones, per person", async () => {
  const h = setup(FILES);
  await indexAll(h);
  assert.deepEqual(await layoutGet(h.ctx, { scope: "agent", agentId: "agt_intake" }), { positions: {} });
  assert.deepEqual(await layoutSave(h.ctx, { scope: "agent", agentId: "agt_intake", positions: { "note:fil_clients": { x: 11.5, y: -3 }, "note:fil_esc": { x: 0, y: 40 } } }), { ok: true });
  assert.deepEqual((await layoutGet(h.ctx, { scope: "agent", agentId: "agt_intake" })).positions["note:fil_clients"], { x: 11.5, y: -3 });
  const g = await graph(h.ctx, { scope: "agent", agentId: "agt_intake" });
  const c = g.nodes.find((n) => n.nodeId === "note:fil_clients")!;
  assert.deepEqual([c.x, c.y], [11.5, -3]);
  const omar = asPerson(h, { kind: "person", id: "usr_omar" });
  assert.deepEqual(await layoutGet(omar.ctx, { scope: "agent", agentId: "agt_intake" }), { positions: {} });
  const og = await graph(omar.ctx, { scope: "agent", agentId: "agt_intake" });
  assert.notDeepEqual([og.nodes.find((n) => n.nodeId === "note:fil_clients")?.x], [11.5]);
  // Saving again replaces the set; another scope is separate.
  await layoutSave(h.ctx, { scope: "agent", agentId: "agt_intake", positions: { "note:fil_esc": { x: 1, y: 2 } } });
  assert.deepEqual(Object.keys((await layoutGet(h.ctx, { scope: "agent", agentId: "agt_intake" })).positions), ["note:fil_esc"]);
  assert.deepEqual(await layoutGet(h.ctx, { scope: "space" }), { positions: {} });
  await assert.rejects(() => layoutSave(h.ctx, { scope: "space", positions: { "note:fil_esc": { x: Number.NaN, y: 2 } } }), (e) => codeOf(e) === "validation.bad_input");
  assert.deepEqual(contractErrors("memory.layout.get", "out", await layoutGet(h.ctx, { scope: "space" })), []);
});

test("the everything view logs every open, ignores viewer access, and still leaves personal layers out", async () => {
  const h = setup(FILES);
  await indexAll(h);
  h.deny("file:fil_harlow");
  const g = await graphEverything(h.ctx, {});
  assert.ok(ids(g).includes("note:fil_harlow"));
  assert.ok(!JSON.stringify(g).includes("Travel"));
  assert.deepEqual(contractErrors("memory.graph_everything", "out", g), []);
  await graphEverything(h.ctx, { asOf: NOW });
  assert.deepEqual(h.named("memory.everything_viewed").map((e) => e.payload), [{ by: "usr_dana" }, { by: "usr_dana" }]);
  assert.deepEqual(assertEventsConform(h), []);
});

test("export writes the viewer's graph as a file in the agent's folder or the Space root, personal layers left out", async () => {
  const seen: { created?: Record<string, unknown> } = {};
  const h = setup(FILES, {
    "files.create": (i) => { seen.created = i; return { file: { fileId: "fil_export" } }; },
    "files.tree": () => ({ roots: [{ key: "recent", kind: "virtual", title: "Recent" }, { key: "space", kind: "folder", title: "Space", folderId: "fld_root" }] }),
  });
  await indexAll(h);
  const a = await graphExport(h.ctx, { scope: "agent", agentId: "agt_intake" });
  assert.deepEqual(a, { fileId: "fil_export" });
  assert.deepEqual(contractErrors("memory.graph_export", "out", a), []);
  assert.equal(seen.created?.["folderId"], "fld_intake");
  assert.match(String(seen.created?.["name"]), /^memory-graph-agent-2025-\d\d-\d\d\.json$/);
  const body = JSON.parse(String((seen.created?.["content"] as { text: string }).text)) as { nodes: Array<{ nodeId: string }> };
  assert.ok(body.nodes.length > 0);
  assert.ok(!JSON.stringify(body).includes("Travel"));
  await graphExport(h.ctx, { scope: "space" });
  assert.equal(seen.created?.["folderId"], "fld_root");
});

test("pointer paths resolve: a fact's note is a note you can read, and its node opens the same file", async () => {
  const h = setup(FILES);
  await indexAll(h);
  const g = await graph(h.ctx, { scope: "agent", agentId: "agt_intake" });
  const node = g.nodes.find((n) => n.nodeId === "note:fil_clients")!;
  const out = await pointer(h.ctx, { threadId: "thr_p", agentId: "agt_intake", text: "Which client is our oldest?" });
  assert.equal(out.lines[0]?.fact, "Acme is our oldest client");
  assert.equal(out.lines[0]?.path, "Agents/Intake/memory/notes/Clients.md");
  const read = await readNote(h.ctx, { noteId: "not_clients" });
  assert.equal(read.note.path, out.lines[0]?.path);
  assert.equal(node.link, `/files/${String(h.calls("files.read").at(-1)?.input["fileId"])}`);
});
