// Captures of the visible tab are taken in turn, spaced under Chrome's two-a-second limit, and a refused one is tried once more.
// Found 15 Nov 2026: Save to Notes lost its picture about half the time, because the side panel had just taken one (tests/ext-panel.e2e.test.ts in a real Chromium).
import test from "node:test";
import assert from "node:assert/strict";
import { CAPTURE_GAP_MS, captureSpaced } from "../src/worker/shot.js";

const QUOTA = "This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.";

/** A Chrome that refuses a capture made less than `gap` ms after the last one it allowed, like the real quota. */
function chrome(gap: number) {
  let last = -Infinity;
  const at: number[] = [];
  return {
    at,
    tabs: {
      async captureVisibleTab(): Promise<string> {
        const now = Date.now();
        if (now - last < gap) throw new Error(QUOTA);
        last = now;
        at.push(now);
        return `data:image/png;base64,shot${at.length}`;
      },
    },
  };
}

test("three captures asked for at once all succeed: the ones Chrome refuses wait and are tried again", async () => {
  const c = chrome(CAPTURE_GAP_MS - 50);
  const got = await Promise.all([captureSpaced(c, 1), captureSpaced(c, 1), captureSpaced(c, 1)]);
  assert.deepEqual([...got].sort(), [
    "data:image/png;base64,shot1",
    "data:image/png;base64,shot2",
    "data:image/png;base64,shot3",
  ]);
  assert.equal(c.at.length, 3, "three pictures were taken");
});

test("a capture Chrome allows is not delayed", async () => {
  const c = chrome(0);
  const t0 = Date.now();
  await captureSpaced(c, 1);
  await captureSpaced(c, 1);
  assert.ok(Date.now() - t0 < 200, "no gap is added when nothing is refused");
});

test("a capture is tried three times; a third refusal is an error the caller sees", async () => {
  let calls = 0;
  const twice = {
    tabs: {
      async captureVisibleTab(): Promise<string> {
        calls += 1;
        if (calls < 3) throw new Error(QUOTA);
        return "data:image/png;base64,ok";
      },
    },
  };
  assert.equal(await captureSpaced(twice, 1, async () => undefined), "data:image/png;base64,ok");
  assert.equal(calls, 3);
  let tries = 0;
  const never = {
    tabs: {
      async captureVisibleTab(): Promise<string> {
        tries += 1;
        throw new Error(QUOTA);
      },
    },
  };
  await assert.rejects(
    captureSpaced(never, 1, async () => undefined),
    /quota/,
  );
  assert.equal(tries, 3);
});
