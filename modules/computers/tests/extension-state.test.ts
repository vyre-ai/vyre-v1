// rc.22 bug 7: "workers: 0" for Vyre for Chrome in an agent computer. Measured on the real image (vyre/agent-computer:1, 11 Nov 2026): an installed extension's service worker reads 1 for the first
// seconds, then 0 for a minute while it is idle, then 1 again when it wakes. Idle is not absent: the status says "asleep" for that, and "missing" only when the extension is not in the image.
import test from "node:test";
import assert from "node:assert/strict";
import { extensionStatus } from "../../../images/agent-computer/agentd/extension-state.ts";

test("an installed extension with no worker right now is asleep, not missing; running with a worker; missing only when it is not installed", () => {
  assert.deepEqual(extensionStatus(true, 1), { configured: true, workers: 1, state: "running" });
  assert.deepEqual(extensionStatus(true, 0), { configured: true, workers: 0, state: "asleep" });
  assert.deepEqual(extensionStatus(false, 0), { configured: false, workers: 0, state: "missing" });
  assert.equal(extensionStatus(false, 2).state, "missing", "a worker with no extension folder is still not ours");
});
