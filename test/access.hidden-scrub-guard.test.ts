// The guard for field-level privacy (24 Nov 2026: records.as_of, update, restore_version, update_many and view handed a member the fields their grant hides, because the scrub set was a list somebody kept by hand).
// This walks the generated registry: every capability whose answer can carry a record row (an object with id, type, version and fields) must be in the scrub set (host/src/daemon/record-access.ts SCRUBBED), or be named in
// ALLOWED here with its reason; every capability of the records module must be classified (scrubbed, or a reason it carries no field values that the sweep probes); and a capability that is new fails here until it is.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SCRUBBED } from "../host/src/daemon/record-access.ts";

interface Cap {
  name: string;
  module: string;
  output?: unknown;
}
const reg = JSON.parse(readFileSync(new URL("../generated/registry.json", import.meta.url), "utf8")) as {
  $defs: Record<string, unknown>;
  capabilities: Cap[];
};

/** Whether a schema holds a record row somewhere: an object with the properties id, type, version and fields. */
function carriesRecordRow(schema: unknown, seen: ReadonlySet<string> = new Set()): boolean {
  if (schema === null || typeof schema !== "object") return false;
  if (Array.isArray(schema)) return schema.some((s) => carriesRecordRow(s, seen));
  const o = schema as Record<string, unknown>;
  if (typeof o["$ref"] === "string") {
    const key = o["$ref"].split("/").pop()!;
    return seen.has(key) ? false : carriesRecordRow(reg.$defs[key], new Set([...seen, key]));
  }
  const p = o["properties"] as Record<string, unknown> | undefined;
  if (p && "fields" in p && "id" in p && "type" in p && "version" in p) return true;
  return Object.values(o).some((v) => carriesRecordRow(v, seen));
}

/** Answers that carry a record row and are not projected through the reader's grant, with why that is right. */
const ALLOWED: Record<string, string> = {
  "records.create":
    "the record the caller has just made: it is theirs, no grant of anyone else's hides a field of it yet",
};

/** Every capability of the records module: scrubbed, or why its answer holds no field value (and the sweep probes it, so the reason is tested, not only written). */
const NO_FIELD_VALUES: Record<string, string> = {
  "records.bulk_upsert": "counts and refusals only",
  "records.changes": "the change feed: ids and kinds (probed)",
  "records.comments.add": "a comment's own text",
  "records.comments.delete": "no record",
  "records.comments.edit": "a comment's own text",
  "records.comments.list": "comments (probed)",
  "records.comments.resolve": "a comment's own state",
  "records.completeness": "which fields are empty (probed)",
  "records.counts": "a count (probed, also with a filter on a hidden field)",
  "records.create": "ALLOWED above",
  "records.delete": "no record",
  "records.export":
    "the file is filtered row by row and column by column by the caller's grant in the handler (probed with an exporter role: no hidden value in the file bytes)",
  "records.gap_check": "which fields are empty, for a person who may edit",
  "records.hold": "no record",
  "records.page_prefs.get": "the person's own preferences",
  "records.page_prefs.set": "the person's own preferences",
  "records.purge": "a count, needs policy.manage",
  "records.purge_trashed": "a count, needs policy.manage",
  "records.release_hold": "no record",
  "records.relations_map": "related ids and types (probed)",
  "records.release_hold ": "",
  "records.reveal": "needs records.reveal and the Vault (probed: refused)",
  "records.value_source": "where a value came from (probed)",
  "records.values.pending": "proposals (probed)",
  "records.versions": "version numbers, who and when (probed)",
};
delete NO_FIELD_VALUES["records.release_hold "];

const sweep = readFileSync(new URL("./access.hidden-sweep.live.test.ts", import.meta.url), "utf8");

test("every capability whose answer carries a record row is projected through the reader's grant, or named and reasoned in ALLOWED", () => {
  const carrying = reg.capabilities
    .filter((c) => c.output !== undefined && carriesRecordRow(c.output))
    .map((c) => c.name);
  assert.ok(carrying.length >= 12, `the registry walk finds the record-row answers (${carrying.length})`);
  const loose = carrying.filter((name) => !SCRUBBED.has(name) && !(name in ALLOWED));
  assert.deepEqual(
    loose,
    [],
    `a capability that answers with a record row is not in SCRUBBED (host/src/daemon/record-access.ts and host/src/invoke.ts SCOPED_RECORD_READS) nor in ALLOWED: ${loose.join(", ")}`,
  );
});

test("every capability of the records module is classified, and what the guard says is scrubbed is", () => {
  const records = reg.capabilities.filter((c) => c.module === "records").map((c) => c.name);
  const unclassified = records.filter((name) => !SCRUBBED.has(name) && !(name in NO_FIELD_VALUES));
  assert.deepEqual(
    unclassified,
    [],
    `a records capability is neither scrubbed nor classified in NO_FIELD_VALUES (decide it, and probe it in test/access.hidden-sweep.live.test.ts): ${unclassified.join(", ")}`,
  );
  const names = new Set(reg.capabilities.map((c) => c.name));
  for (const name of [...SCRUBBED, ...Object.keys(NO_FIELD_VALUES), ...Object.keys(ALLOWED)])
    assert.ok(names.has(name), `${name} is a capability`);
  // the reasons are tested: every classified capability that is not trivially empty is probed by the sweep
  const probed = [
    "records.changes",
    "records.completeness",
    "records.comments.list",
    "records.counts",
    "records.export",
    "records.relations_map",
    "records.reveal",
    "records.value_source",
    "records.values.pending",
    "records.versions",
  ];
  for (const name of probed) assert.ok(sweep.includes(`"${name}"`), `${name} is probed by the sweep`);
});

test("the set the host scrubs and the set the pipeline routes are the same", () => {
  const invoke = readFileSync(new URL("../host/src/invoke.ts", import.meta.url), "utf8");
  const block = /const SCOPED_RECORD_READS = new Set\(\[([\s\S]*?)\]\);/.exec(invoke)?.[1] ?? "";
  const routed = [...block.matchAll(/"(records\.[a-z_.]+)"/g)].map((m) => m[1]!).sort();
  assert.deepEqual(routed, [...SCRUBBED].sort());
});

/** Whether a schema has a property of this name somewhere (events carry their values in `payload`). */
function hasProperty(schema: unknown, name: string, seen: ReadonlySet<string> = new Set()): boolean {
  if (schema === null || typeof schema !== "object") return false;
  if (Array.isArray(schema)) return schema.some((s) => hasProperty(s, name, seen));
  const o = schema as Record<string, unknown>;
  if (typeof o["$ref"] === "string") {
    const key = o["$ref"].split("/").pop()!;
    return seen.has(key) ? false : hasProperty(reg.$defs[key], name, new Set([...seen, key]));
  }
  const p = o["properties"] as Record<string, unknown> | undefined;
  if (p && name in p) return true;
  return Object.values(o).some((v) => hasProperty(v, name, seen));
}

/** The events module's answers that carry an event: the row a reader is shown is cut to the fields they may see (host/src/seams/events-ports.ts forReader, through the same gate records.get uses: gateOf). */
const EVENT_READERS = new Set(["events.get", "events.list", "events.since"]);
/** Answers with a `payload` property that carry no event values, and why. */
const EVENT_ALLOWED: Record<string, string> = {
  "events.types": "the event types and the shape of their payloads, not any event",
};

test("every capability that answers with an event row is cut to the reader's fields (events.get, list, since), through the shared gate", () => {
  const withPayload = reg.capabilities
    .filter((c) => c.module === "events" && c.output !== undefined && hasProperty(c.output, "payload"))
    .map((c) => c.name);
  assert.ok(withPayload.length >= 3, `the walk finds the event answers (${withPayload.join(", ")})`);
  const loose = withPayload.filter((n) => !EVENT_READERS.has(n) && !(n in EVENT_ALLOWED));
  assert.deepEqual(
    loose,
    [],
    `an events capability that answers with a payload is neither an event reader nor allowed: ${loose.join(", ")}`,
  );
  const ports = readFileSync(new URL("../host/src/seams/events-ports.ts", import.meta.url), "utf8");
  assert.ok(
    ports.includes("forReader") && ports.includes("fieldGate") && ports.includes("RECORD_VALUE_EVENTS"),
    "the events port cuts a record event's fields to the reader's (forReader, through fieldGate)",
  );
  for (const name of EVENT_READERS)
    assert.ok(
      reg.capabilities.some((c) => c.name === name),
      `${name} is a capability`,
    );
  const access = readFileSync(new URL("../host/src/daemon/record-access.ts", import.meta.url), "utf8");
  assert.ok(access.includes("function gateOf"), "the one field rule (gateOf) lives in record-access.ts");
});
