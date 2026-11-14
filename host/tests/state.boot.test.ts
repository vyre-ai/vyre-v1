// The state module on a booted server (P2 step 0): its migration made the tables, the six public capabilities answer through the gateway as the seeded owner, the host's own calls refuse a
// person, and a kind nobody registered is a plain refusal. Nothing calls state yet; this proves the module loads, migrates and is reachable the way a screen will reach it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { boot, post, seededDirFrom } from "./daemon-boot-rig.ts";

const seededDir = seededDirFrom(bootCore);
const THING = { type: "conversation", id: "cnv_nobody" };
const NO_KIND = { type: "no_such_kind", id: "x_nobody" };

test("the state module migrates at boot and answers its public calls through the gateway", async () => {
  const dir = seededDir();
  const d = await boot(dir);
  try {
    const tables = (
      d.db!.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'state_%' ORDER BY name") as {
        name: string;
      }[]
    ).map((r) => r.name);
    assert.deepEqual(tables, ["state_count", "state_layout", "state_person", "state_thing"]);

    const counts = await post(d, "/v1/state/counts", {});
    assert.equal(counts.status, 200);
    assert.deepEqual(await counts.json(), { data: { counts: [] } });

    const asked = await post(d, "/v1/state/counts", { scopes: ["chats"] });
    assert.deepEqual(await asked.json(), { data: { counts: [{ scope: "chats", things: 0, entries: 0 }] } });

    // a kind nobody registered is a plain refusal, never a crash; a conversation that is not there is not found (the Inbox registers its kind at boot)
    const set = await post(d, "/v1/state/set", { thing: NO_KIND, star: true });
    assert.equal(set.status, 404);
    assert.equal(((await set.json()) as { error: { code: string } }).error.code, "validation.not_found");
    const read = await post(d, "/v1/state/read", { thing: THING, upto: 1 });
    assert.equal(read.status, 404);
    assert.equal(((await read.json()) as { error: { code: string } }).error.code, "validation.not_found");

    // the host's own calls are the host's: the seeded owner is refused
    for (const [path, body] of [
      ["/v1/state/verify", {}],
      ["/v1/state/arrive", { thing: THING, pos: 1, by: null, at: 1 }],
      ["/v1/state/forget", { thing: THING }],
    ] as const) {
      const r = await post(d, path, body);
      assert.equal(r.status, 403, path);
      assert.equal(((await r.json()) as { error: { code: string } }).error.code, "permission.no_grant");
    }
    assert.equal(d.db!.all("SELECT 1 FROM state_person").length, 0, "nothing was written");
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
