// Live Folders across layers (L3): the Dropbox mount kind, the capabilities the mount code calls in other modules, and the agent's file tools must agree. Each fact has a home in a different layer
// (the mounts manifest, the engine, the provider, the app's source list, the dropbox, google and microsoft manifests); this reads them together so one cannot drift from the others.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import dropbox from "../manifests/dropbox.ts";
import google from "../manifests/google.ts";
import microsoft from "../manifests/microsoft.ts";
import mounts from "../manifests/mounts.ts";
import { PROVIDER_LABEL, isCloud, providerOf } from "../modules/mounts/handlers/providers.ts";
import type { MountKind } from "../modules/mounts/handlers/providers.ts";
import { SOURCES } from "../apps/app/src/places/files/mounts/model.ts";

const read = (path: string): string => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
const names = (m: { capabilities?: { name: string }[] }): Set<string> => new Set((m.capabilities ?? []).map((c): string => c.name));
const everyCap = new Set([...names(dropbox), ...names(google), ...names(microsoft), ...names(mounts)]);

/** Every quoted capability name a source file calls through ctx.call for a module. */
const callsIn = (source: string, prefix: RegExp): string[] => [...new Set([...source.matchAll(/["'`]((?:google|ms|dropbox|mounts)\.[a-z_.]+)["'`]/g)].map((m) => m[1] as string).filter((n) => prefix.test(n)))];

test("the mount kinds are one list: the manifest's enum, the labels, the providers and the app's sources", () => {
  const input = (mounts.capabilities ?? []).find((c) => c.name === "mounts.add")!.input.properties!["source"]!.properties!["kind"]!.enum as string[];
  assert.ok(input.includes("dropbox"));
  assert.deepEqual(Object.keys(PROVIDER_LABEL).sort(), [...input].sort());
  for (const kind of input) assert.equal(providerOf(kind as MountKind).label.length > 0, true, kind);
  const browse = (mounts.capabilities ?? []).find((c) => c.name === "mounts.browse")!.input.properties!["kind"]!.enum as string[];
  assert.deepEqual([...browse].sort(), [...input].sort());
  // every kind the sheet can mount is a kind the engine takes, and every cloud kind is offered by the sheet
  const offered = new Set(SOURCES.flatMap((s) => s.kinds as readonly string[]));
  for (const k of offered) assert.ok(input.includes(k), `the sheet offers ${k}`);
  for (const k of input) if (isCloud(k as MountKind)) assert.ok(offered.has(k), `the sheet offers cloud kind ${k}`);
});

test("every capability the Dropbox provider and the native edits call exists, in the module that owns it", () => {
  const provider = callsIn(read("modules/mounts/handlers/dropbox-provider.ts"), /^dropbox\./);
  assert.ok(provider.length >= 6, "the provider calls the Dropbox file capabilities");
  const native = callsIn(read("modules/mounts/handlers/native.ts"), /^(google|ms|dropbox)\./);
  assert.ok(native.length >= 10);
  for (const cap of [...provider, ...native]) assert.ok(everyCap.has(cap), `${cap} is declared`);
});

test("the provider only calls Dropbox through capabilities that are on the agent's file tools or are mount plumbing, and writes ask the Gate", () => {
  const caps = new Map((dropbox.capabilities ?? []).map((c): [string, typeof c] => [c.name, c]));
  for (const c of caps.values()) {
    if (c.name.startsWith("dropbox.files.") && c.effects !== "read") assert.ok(c.gate, `${c.name} is a write and needs a Gate act`);
    if (c.name.startsWith("dropbox.files.") && c.surfaces.mcp) assert.equal(c.surfaces.mcp.toolset, "files", c.name);
  }
  // none of the sign-in or webhook capabilities is on an agent's tool list
  for (const n of ["dropbox.app.set", "dropbox.connect.start", "dropbox.connect.complete", "dropbox.receive_webhook", "dropbox.account.remove"]) assert.equal(caps.get(n)?.surfaces.mcp, undefined, n);
});

test("every native edit an agent can make writes through a capability behind the same Gate act, and a mounted file's edit needs Edit on the Vyre file", () => {
  const byName = new Map([...(google.capabilities ?? []), ...(microsoft.capabilities ?? []), ...(mounts.capabilities ?? [])].map((c): [string, typeof c] => [c.name, c]));
  const pairs: [string, string[]][] = [
    ["mounts.doc_replace_text", ["google.docs.replace_text"]], ["mounts.doc_insert_text", ["google.docs.insert_text"]],
    ["mounts.sheet_write", ["google.sheets.update_values", "ms.workbook.update_range"]], ["mounts.sheet_append", ["google.sheets.append_values", "ms.workbook.append_rows"]],
  ];
  for (const [wrapper, under] of pairs) {
    const w = byName.get(wrapper)!;
    assert.equal(w.level, "edit", wrapper);
    for (const u of under) assert.equal(byName.get(u)!.gate?.act, w.gate?.act, `${wrapper} and ${u} ask the Gate the same thing`);
  }
  for (const n of ["mounts.sheet_read"]) assert.equal(byName.get(n)!.effects, "read");
});

test("the dropbox module is registered the way every module is: a manifest, a host row, an owner lane", () => {
  const modules = (JSON.parse(read("host/modules.json")) as { modules: { id: string; owner: string; status: string }[] }).modules;
  const row = modules.find((m) => m.id === "dropbox");
  assert.deepEqual(row && { owner: row.owner, status: row.status }, { owner: dropbox.owner, status: "live" });
  const lanes = JSON.parse(read("scripts/lanes.json")) as { lanes: { id: string; modules: string[]; owns: string[] }[]; moduleOwners: Record<string, string> };
  assert.equal(lanes.moduleOwners["dropbox"], dropbox.owner);
  const lane = lanes.lanes.find((l) => l.id === dropbox.owner)!;
  assert.ok(lane.modules.includes("dropbox") && lane.owns.includes("modules/dropbox/"));
  assert.ok(read("manifests/index.ts").includes("m_dropbox"));
});

test("the dropbox module can reach Dropbox: ctx.http is limited to its connector's domains, so the connector entry must list every host the module calls", () => {
  const domains = (dropbox.connectors ?? []).flatMap((c) => c.domains);
  const src = read("modules/dropbox/projections.ts");
  const hosts = [...src.matchAll(/https:\/\/([a-z.]+\.dropboxapi\.com)/g)].map((m) => m[1] as string);
  assert.ok(hosts.length >= 2);
  for (const h of hosts) assert.ok(domains.some((d) => h === d || h.endsWith(`.${d}`)), `${h} is a declared domain`);
});
