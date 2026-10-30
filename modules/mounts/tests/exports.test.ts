// The host finds a module's async projections in its `projections` export. Mounts' local-change projection was only listed as a consumer, which the host reads as a hook and skips,
// so an edit made in Vyre never marked its mounted item as waiting or as a conflict.
import assert from "node:assert/strict";
import test from "node:test";
import { collectProjections } from "../../../host/src/daemon/projections.ts";
import * as impl from "../impl.ts";

test("the host runs the mounts local-change projection over the Space log", () => {
  const found = collectProjections(impl as unknown as Record<string, unknown>);
  assert.deepEqual(found.map((p) => p.name), ["mounts.local_changes"]);
  for (const ev of ["file.created", "file.version_added", "file.deleted", "folder.created", "folder.deleted"]) assert.ok(ev in found[0]!.on, `it listens to ${ev}`);
});
