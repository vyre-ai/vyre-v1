// Lead, 12 Nov: an agent moved to Trash keeps what it holds outside the agents module (its Space browser sign-ins, its workspace volumes) for as long as the Space keeps its Trash, and both lanes use one rule:
// agent.deleted starts the clock, agent.restored cancels it, the data goes after governance's trash retention. The modules cannot import each other, so each keeps a fallback constant for when governance cannot
// be read; this test holds every fallback to governance's own default. (Lane f-term adds its constant here.)
import test from "node:test";
import assert from "node:assert/strict";
import { retentionMs, TRASH_KEEP_MS } from "../modules/computers/sbrowser/forget.ts";
import governance from "../manifests/governance.ts";

test("every module's fallback for how long Trash keeps an agent's things is governance's default trash retention", () => {
  const trash = (governance as unknown as { retention: Array<{ key: string; default: string }> }).retention.find((r) => r.key === "trash");
  assert.ok(trash, "governance has a trash retention");
  assert.equal(TRASH_KEEP_MS, retentionMs(trash.default), `the Space browser's fallback is ${trash.default}`);
});
