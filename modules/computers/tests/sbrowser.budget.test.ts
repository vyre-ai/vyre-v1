// The Space browser's one memory budget (fourth look, 12 Nov): capacity.ts says how much memory the container gets, how many browsers that holds and its task cap; the container the adapter makes, the
// runner's bound and browserd's own count must all follow those same numbers, for any host.
import test from "node:test";
import assert from "node:assert/strict";
import { BROWSER_BASE_MB, BROWSER_BASE_TASKS, BROWSER_TASKS, browserService, HEADROOM_MB, LIMITS } from "../capacity.ts";
import { browserContainerConfig } from "../sbrowser/docker.ts";
import { sbrowserBounds } from "../../../host/src/sites-runner/computers-policy.ts";
import { PIDS_PER_BROWSER, slotsFor } from "../../../images/space-browser/browserd/profiles.ts";

const MB = 1024 * 1024;

test("the container, the runner's bound and browserd all follow capacity.ts's one browser budget", () => {
  assert.equal(PIDS_PER_BROWSER, BROWSER_TASKS, "browserd counts the same tasks a browser");
  for (const gb of [4, 8, 16, 32, 64]) {
    const hostMb = gb * 1024;
    const want = browserService(hostMb);
    assert.equal(want.memoryMb, Math.max(1024, hostMb - HEADROOM_MB));
    assert.equal(want.slots, Math.max(1, Math.floor((want.memoryMb - BROWSER_BASE_MB) / LIMITS.browser.reserveMb)));
    const c = browserContainerConfig({ host: { memoryMb: hostMb, cpus: 8 } });
    assert.equal(c.HostConfig.Memory, want.memoryMb * MB, `${gb} GB: the container's memory is the budget`);
    assert.equal(c.HostConfig.PidsLimit, want.pids, `${gb} GB: its task cap follows it`);
    assert.equal(slotsFor(want.memoryMb, undefined, want.pids), want.slots, `${gb} GB: browserd runs as many browsers as the budget says`);
    const bound = sbrowserBounds({ memoryBytes: hostMb * MB });
    assert.ok(bound.memory >= c.HostConfig.Memory, `${gb} GB: the runner allows the container the adapter makes`);
    assert.ok(bound.pids >= c.HostConfig.PidsLimit!, `${gb} GB: and its task cap`);
    if (want.memoryMb >= 8192) {
      assert.equal(bound.memory, want.memoryMb * MB, `${gb} GB: the runner's bound is the same budget, not more`);
      assert.equal(bound.pids, BROWSER_BASE_TASKS + BROWSER_TASKS * want.slots + 256, `${gb} GB: its task cap is the same, with its margin`);
    }
  }
});
