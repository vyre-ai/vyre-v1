// F50: a published page (artifact), which needs the artifact host. (A calendar event cannot be reached through the capability door of a booted daemon at all today: calendar.get_event answers 404 permission.not_found for an event just made, on the integration line too; its guard is proved at handler level, modules/calendar/tests/events.test.ts.) On a booted daemon: a write that names what it read
// lands once; the same write on the old version is refused and changes nothing; two at the same moment on one version give one that lands.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, clock, seededDir } from "./memory-live-kit.ts";
import { api, ok, standIn } from "./member-key-kit.ts";
import { reachingFetch } from "../host/tests/artifact-host-kit.test.ts";

const HOST = "a.team.example.test";
let k = 0;
const key = (): string => `w3-${++k}`;

test(
  "a published page: a write on a version that moved on is refused and changes nothing",
  { timeout: 120_000 },
  async () => {
    process.env["VYRE_ARTIFACT_HOST"] = HOST;
    const dir = seededDir();
    let at = "";
    const d = await boot(dir, standIn, undefined, {
      vault: undefined,
      fetch: reachingFetch(HOST, () => at),
    } as unknown as NonNullable<Parameters<typeof boot>[3]>);
    at = d.url;
    clock.t += 120_000;
    try {
      const call = (cap: string, input: Record<string, unknown>) =>
        api(d, d.token, cap, { idempotencyKey: key(), ...input });
      // ---- a published page
      const made = await ok(d, d.token, "sites.artifact_publish", {
        title: "Numbers",
        html: "<p>1</p>",
        idempotencyKey: key(),
      });
      assert.equal(typeof made.updatedAt, "number");
      clock.t += 10;
      const ann = await call("sites.artifact_publish", {
        title: "Numbers",
        html: "<p>ANN</p>",
        artifactId: made.artifactId,
        expectedUpdatedAt: made.updatedAt,
      });
      assert.equal(ann.status, 200, JSON.stringify(ann.data).slice(0, 300));
      clock.t += 10;
      const bob = await call("sites.artifact_publish", {
        title: "Numbers",
        html: "<p>BOB</p>",
        artifactId: made.artifactId,
        expectedUpdatedAt: made.updatedAt,
      });
      assert.equal(bob.status, 409, JSON.stringify(bob.data).slice(0, 300));
      const site = (await ok(d, d.token, "sites.get", { siteId: made.artifactId })).site;
      assert.equal(site.updatedAt, ann.data.updatedAt, "the refused republish changed nothing");
      // two at once on one version
      const base = ann.data.updatedAt as number;
      clock.t += 10;
      const pair = await Promise.all(
        ["X", "Y"].map((t) =>
          call("sites.artifact_publish", {
            title: "Numbers",
            html: `<p>${t}</p>`,
            artifactId: made.artifactId,
            expectedUpdatedAt: base,
          }),
        ),
      );
      assert.deepEqual(pair.map((r) => r.status).sort(), [200, 409], "artifact pair");
      console.log("MEASURE artifact: 200 then 409; pair 200,409");
    } finally {
      await d.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
