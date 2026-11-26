// A field dropped from a type rewrites its rows without a record event, so the memory graph follows the schema change: a record node whose title came from the dropped field, and the [[links]] written in it, leave the graph.
import test from "node:test";
import assert from "node:assert/strict";
import { consumers } from "../impl.ts";
import { indexGraph } from "../handlers/graph.ts";
import { harness } from "../fixtures/harness.ts";

test("a record node titled by a dropped field is read again without it, and the links written in that field are gone", async () => {
  const state = { dropped: false };
  const h = harness({
    respond: {
      "records.get": (i) => ({
        record: {
          id: i["recordId"],
          type: "matter",
          createdAt: 1,
          fields: state.dropped ? { note: "kept" } : { subject: "zqsubject text [[ZqPage]]", note: "kept" },
        },
      }),
      "records.query": () => ({ rows: [{ id: "rec_1" }] }),
    },
  });
  await indexGraph(h.ctx, { entity: "record:matter", id: "rec_1", seq: 1 });
  assert.equal(
    String(h.rows("SELECT title FROM memory_graph_nodes WHERE node_id = 'record:rec_1'")[0]!["title"]),
    "zqsubject text [[ZqPage]]",
  );
  assert.equal(
    h.rows("SELECT 1 FROM memory_mentions WHERE source_ref = 'rec_1'").length > 0,
    true,
    "control: the link in the field is a mention",
  );
  state.dropped = true;
  await consumers["memory.graph_schema"].run(h.ctx, {
    type: "schema.changed",
    seq: 2,
    payload: { type: "matter", types: ["matter"], ops: [{ op: "field.drop", type: "matter", field: "subject" }] },
  });
  assert.equal(
    String(h.rows("SELECT title FROM memory_graph_nodes WHERE node_id = 'record:rec_1'")[0]!["title"]),
    "rec_1",
  );
  assert.equal(h.rows("SELECT 1 FROM memory_mentions WHERE source_ref = 'rec_1'").length, 0);
});

test("a schema change that drops no field reads nothing again", async () => {
  const h = harness({ respond: { "records.query": () => ({ rows: [] }) } });
  await consumers["memory.graph_schema"].run(h.ctx, {
    type: "schema.changed",
    seq: 1,
    payload: { type: "matter", ops: [{ op: "field.add", type: "matter", field: "x" }] },
  });
  assert.equal(h.calls("records.query").length, 0);
});
