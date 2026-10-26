// P-CC_43: a capability that creates an object declares an event whose subject is that object's type, so the pipeline registers it as a resource (host/src/gateway/resources.ts). This runs the real
// registrar over the real registry for the creating capabilities the make-emits lint found: each emits what the handlers emit, and the new object lands under its container with the right type.
// @reads /generated/registry.json
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createResourceRegistrar } from "../src/gateway/resources.ts";
import { HostError } from "../src/invoke.ts";
import { createTestSpace } from "../../testkit/src/index.ts";

type Cap = { name: string; level?: string; permission?: string | null; examples?: Array<{ input: unknown }>; emits?: string[]; resource: { type: string; create?: boolean; parent?: string; id?: string } };
type Ev = { name: string; subject?: { type: string; id: string } };
const reg = JSON.parse(readFileSync(new URL("../../generated/registry.json", import.meta.url), "utf8")) as { capabilities: Cap[]; events: Ev[] };
const cap = (name: string): Cap => reg.capabilities.find((c) => c.name === name)!;
const registrar = (exists: (id: string) => boolean = () => false) =>
  createResourceRegistrar({ events: reg.events.filter((e): e is Ev & { subject: { type: string; id: string } } => e.subject !== undefined).map((e) => ({ name: e.name, subject: e.subject })), exists });
const SPACE = "spc_test";

/** Run the capability's declared events through the registrar with the payloads the handlers send. */
function registered(name: string, input: unknown, payloads: Record<string, unknown>, known: readonly string[] = []) {
  const c = cap(name);
  const events = (c.emits ?? []).filter((n) => n in payloads).map((n) => ({ type: n, payload: payloads[n] }));
  return registrar((id) => known.includes(id)).register({ cap: { name: c.name, resource: c.resource as never }, input, space: SPACE, owner: "usr_dana", events: events as never });
}

test("connections.create registers the connection under its connector", () => {
  const rows = registered("connections.create", { connector: "gmail" }, { "connection.created": { connectionId: "con_abc1" } }, ["gmail"]);
  assert.deepEqual(rows.map((r) => [r.id, r.type, r.parent_id, r.owner_id]), [["con_abc1", "connection", "gmail", "usr_dana"]]);
  assert.equal(cap("connections.create").resource.type, "connection");
});

test("documents.fill, sheets.create and files.copy register the new file under the folder it went into", () => {
  const cases: Array<[string, unknown]> = [
    ["documents.fill", { intoFolderId: "fld_a1" }],
    ["sheets.create", { folderId: "fld_a1" }],
    ["files.copy", { toFolderId: "fld_a1" }],
  ];
  for (const [name, input] of cases) {
    const rows = registered(name, input, { "file.created": { fileId: "fil_new1" }, "document.filled": { fileId: "fil_new1" } }, ["fld_a1"]);
    assert.deepEqual(rows.map((r) => [r.id, r.type, r.parent_id]), [["fil_new1", "file", "fld_a1"]], name);
    assert.equal(cap(name).resource.type, "file", `${name} makes a file`);
  }
});

test("projects.create registers the project and its record, and the record goes under its record type", () => {
  const rows = registered("projects.create", { type: "project" }, { "project.created": { projectId: "prj_abc1" }, "record.created": { recordId: "rec_abc1" } }, ["project"]);
  assert.deepEqual(rows.map((r) => [r.id, r.type]).sort(), [["prj_abc1", "project"], ["rec_abc1", "record"]]);
  assert.equal(rows.find((r) => r.id === "rec_abc1")!.parent_id, "project");
  assert.equal(cap("projects.create").resource.type, "record");
});

test("capabilities that create no resource of their own are no longer bound as creators of one", () => {
  for (const name of ["sources.create", "journeys.create", "email_builder.create", "kits.builder_open", "templates.save"]) {
    assert.notEqual(cap(name).resource.create, true, `${name} creates something that is not a resource type (or whose resource is registered by the capability it calls)`);
  }
  assert.deepEqual([cap("sites.table_create").resource.type, cap("sites.table_create").resource.id], ["site", "/siteId"]);
  assert.deepEqual([cap("portal.file_link").resource.type, cap("portal.file_link").resource.id], ["file", "/fileId"]);
});

test("dropping make did not open them up: each still names its permission and an edit level on the Space", () => {
  const perms: Record<string, string> = { "sources.create": "connectors.manage", "journeys.create": "journeys.manage", "kits.builder_open": "kits.publish", "templates.save": "kits.publish" };
  for (const [name, perm] of Object.entries(perms)) {
    const c = cap(name);
    assert.equal(c.permission, perm, `${name} needs ${perm}`);
    assert.equal(c.level, "edit", `${name} keeps the edit level`);
    assert.equal(c.resource.type, "space", `${name} is checked on the Space`);
  }
});

test("a member without the permission is refused before the handler runs", async () => {
  const s = await createTestSpace({ seed: "small" });
  try {
    for (const name of ["sources.create", "journeys.create", "kits.builder_open", "templates.save"]) {
      const c = cap(name);
      const input = c.examples?.[0]?.input ?? {};
      await assert.rejects(s.api("usr_ana").call(name, input as never), (e: unknown) => e instanceof HostError && e.error.code === "permission.role_lacks_permission", `${name}: a member is refused`);
    }
  } finally { await s.close(); }
});
