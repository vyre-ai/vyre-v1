// F77: erasing an agent removes its Space browser profile (cookies, saved sign-ins, downloads). A browser host that is bound and not available is not "nothing to remove": the step fails so the job tries again,
// and the retry marker stays until the profile is really gone.
import test from "node:test";
import assert from "node:assert/strict";
import { hostCalls } from "../impl.ts";
import { bindSpaceBrowser } from "../sbrowser/port.ts";
import type { SpaceBrowser } from "../sbrowser/port.ts";
import { DANA, harness } from "../fixtures/harness.ts";

const erase = hostCalls["computers.erase_agent"] as (ctx: unknown, i: unknown) => Promise<unknown>;

test("a browser host that is unavailable once fails the step and keeps the marker; the next try forgets the profile and clears it", async () => {
  const h = harness({ principal: { kind: "service", id: "svc_host" }, actingFor: DANA });
  let up = false;
  const forgotten: string[] = [];
  bindSpaceBrowser({
    available: async () => up,
    stop: async () => undefined,
    forget: async (p: string) => void forgotten.push(p),
  } as unknown as SpaceBrowser);
  try {
    h.db.run("INSERT INTO computers_browser_gone (profile_id, deleted_at) VALUES (?, ?)", "agt_desk", 1);
    await assert.rejects(erase(h.ctx, { agentId: "agt_desk", dry: false }), /not available/);
    assert.deepEqual(forgotten, []);
    assert.equal(h.rows("SELECT profile_id FROM computers_browser_gone").length, 1, "the retry marker stays");
    up = true;
    await erase(h.ctx, { agentId: "agt_desk", dry: false });
    assert.deepEqual(forgotten, ["agt_desk"]);
    assert.equal(h.rows("SELECT profile_id FROM computers_browser_gone").length, 0, "the marker goes once the profile is gone");
  } finally {
    bindSpaceBrowser(null);
  }
});
