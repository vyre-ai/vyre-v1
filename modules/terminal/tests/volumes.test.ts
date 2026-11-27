// Server health says how much disk the agents' volumes use and which are over the soft cap (rc.44; audit: nothing bounded it). Nothing is stopped or removed: the owner is told.
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SOFT_CAP_MB, volumeFinding, volumesOf } from "../volumes.ts";

const GB = 1073741824;

test("only Vyre's volumes are counted, biggest first, from Docker's own sizes", () => {
  const rows = volumesOf({
    Volumes: [
      { Name: "vyre-ws-agt_a-home", UsageData: { Size: 2 * GB } },
      { Name: "someone-elses-db", UsageData: { Size: 90 * GB } },
      { Name: "vyre-sbrowser-data", UsageData: { Size: 6 * GB } },
      { Name: "vyre-wsproj-prj_1", UsageData: { Size: -1 } },
      { Name: "vyre-ws-agt_b-files", UsageData: {} },
    ],
  });
  assert.deepEqual(rows, [
    { name: "vyre-sbrowser-data", bytes: 6 * GB },
    { name: "vyre-ws-agt_a-home", bytes: 2 * GB },
  ]);
  assert.deepEqual(volumesOf(null), []);
});

test("under the cap it is healthy and says the total; over it names the volumes, says nothing was removed, and tells the owner what to do", () => {
  const ok = volumeFinding([{ name: "vyre-ws-agt_a-home", bytes: 2 * GB }], DEFAULT_SOFT_CAP_MB, "No action needed.");
  assert.equal(ok.state, "healthy");
  assert.match(ok.detail, /2\.0 GB on this server across 1 volumes/);
  const bad = volumeFinding(
    [
      { name: "vyre-sbrowser-data", bytes: 6 * GB },
      { name: "vyre-ws-agt_a-home", bytes: 2 * GB },
    ],
    DEFAULT_SOFT_CAP_MB,
    "No action needed.",
  );
  assert.equal(bad.state, "degraded");
  assert.equal(bad.key, "host.agent_volumes");
  assert.match(bad.detail, /1 is over 5\.0 GB: vyre-sbrowser-data \(6\.0 GB\)/);
  assert.match(bad.next, /Nothing was stopped or removed/);
});
