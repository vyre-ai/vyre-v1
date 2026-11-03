// @reads /modules/mounts/handlers/engine.ts
// mounts.engine_folders (owner ruling 3 Nov): the folders a person mounted from their own computers, with the path there, for that person's CLI engine. Only Vyre itself asks; a person, an agent or
// an outside actor is refused. A cloud mount and someone else's folder are never in the answer.
import test from "node:test";
import assert from "node:assert/strict";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { handlers } from "../impl.ts";
import { harness } from "../fixtures/world.ts";

type Row = Record<string, unknown>;
const call = (ctx: Ctx, cap: string, input: Row): Promise<Row> => (handlers as unknown as Record<string, (c: Ctx, i: unknown) => Promise<Row>>)[cap]!(ctx, input);

test("the engine's folders: the person's own local mounts, with their paths, for Vyre itself only", async () => {
  const w = harness();
  const mine = await call(w.ctx, "mounts.add", { into: "fld_into", source: { kind: "local", deviceId: "dev_mac", localPath: "/Users/maya/Contracts" } });
  const ravi = w.as({ kind: "person", id: "usr_ravi" });
  await call(ravi, "mounts.add", { into: "fld_into", source: { kind: "local", deviceId: "dev_pc", localPath: "/home/ravi/notes" } }).catch(() => undefined);
  const host = w.as({ kind: "service", id: "svc_host" });
  const out = await call(host, "mounts.engine_folders", { person: "usr_owner" });
  assert.deepEqual(out["folders"], [{ mountId: mine["mountId"], folderId: mine["folderId"], deviceId: "dev_mac", path: "/Users/maya/Contracts" }]);
  assert.deepEqual((await call(host, "mounts.engine_folders", { person: "usr_nobody" }))["folders"], []);
  for (const who of [w.ctx, w.as({ kind: "agent", id: "agt_1" }), w.as({ kind: "actor", id: "act_1" })]) {
    await assert.rejects(() => call(who, "mounts.engine_folders", { person: "usr_owner" }), /only Vyre itself reads where a person's folders are/);
  }
});
