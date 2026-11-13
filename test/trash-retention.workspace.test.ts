// Lead, 12 Nov: an agent moved to Trash keeps its workspace volumes (and its Space browser sign-ins, lane f-sbrowser) for as long as the Space keeps its Trash: agent.deleted starts the clock,
// agent.restored cancels it, the data goes after governance's trash retention. The terminal module cannot import governance, so it keeps a fallback for when governance cannot be read; this test holds
// that fallback to governance's own default. When lane f-sbrowser's test/trash-retention.test.ts lands it holds the Space browser's fallback the same way; the two can become one file then.
import test from "node:test";
import assert from "node:assert/strict";
import { retentionMs, TRASH_KEEP_MS } from "../modules/terminal/handlers/sessions.ts";
import governance from "../manifests/governance.ts";

test("the workspace volumes' fallback for how long Trash keeps an agent's things is governance's default trash retention, read the way governance writes it", () => {
  const trash = (governance as unknown as { retention: Array<{ key: string; default: string }> }).retention.find(
    (r) => r.key === "trash",
  );
  assert.ok(trash, "governance has a trash retention");
  assert.equal(TRASH_KEEP_MS, retentionMs(trash.default), `the workspaces' fallback is ${trash.default}`);
  assert.deepEqual(
    [retentionMs("7d"), retentionMs("2w"), retentionMs("forever"), retentionMs("soon")],
    [7 * 86_400_000, 14 * 86_400_000, null, undefined],
  );
});
