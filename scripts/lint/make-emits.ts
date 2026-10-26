// make-emits: a capability whose manifest has `make: [type, ...]` (registry resource.create) creates a resource, but the gateway registers a resource only from an emitted event whose registry subject
// is that type (host/src/gateway/resources.ts). A creating capability that declares no such event leaves its new object without a resource row: nobody can be authorised on it.
//   node scripts/lint/make-emits.ts [--enforce]      reads generated/registry.json; report mode (default) prints every finding and exits 0
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type Cap = { name: string; module?: string; emits?: string[]; resource: { create?: boolean; type?: string } };
type Ev = { name: string; subject?: { type: string; id: string } };
export type MakeFinding = { cap: string; type: string; emits: string[]; message: string };

/** Events that end an object never register one (the same rule as host/src/gateway/resources.ts). */
const ENDS = /(^|[._])(deleted|dropped|removed|purged|erased|destroyed|revoked|expired|archived|left|closed)$/;

export function checkMakeEmits(caps: readonly Cap[], events: readonly Ev[]): MakeFinding[] {
  const subjectOf = new Map<string, string>();
  for (const e of events) if (e.subject && e.subject.type !== "entity" && !ENDS.test(e.name)) subjectOf.set(e.name, e.subject.type);
  const out: MakeFinding[] = [];
  for (const c of caps) {
    if (c.resource?.create !== true || !c.resource.type) continue;
    const type = c.resource.type;
    const emits = c.emits ?? [];
    if (emits.some((n) => subjectOf.get(n) === type)) continue;
    out.push({ cap: c.name, type, emits, message: `${c.name} makes a ${type} but emits no event whose subject is a ${type}${emits.length ? ` (emits: ${emits.join(", ")})` : " (emits nothing)"}, so the gateway registers no resource` });
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const reg = JSON.parse(fs.readFileSync(path.join(repo, "generated/registry.json"), "utf8")) as { capabilities: Cap[]; events: Ev[] };
  const hits = checkMakeEmits(reg.capabilities, reg.events);
  const enforce = process.argv.includes("--enforce");
  for (const h of hits) console.log(`make-emits ${h.cap}: ${h.message}`);
  console.log(`make-emits: ${hits.length} of ${reg.capabilities.filter((c) => c.resource?.create === true).length} creating capabilities have no registering event${enforce ? "" : " (report mode, exit 0)"}`);
  if (enforce && hits.length) process.exit(1);
}
