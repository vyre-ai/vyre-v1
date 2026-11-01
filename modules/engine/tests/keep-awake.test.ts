// While a turn runs a Mac stays awake, once, and lets go when the last one ends (hole 12).
import test from "node:test";
import assert from "node:assert/strict";
import { createKeepAwake } from "../keep-awake.ts";

const fake = () => { const calls: string[][] = []; let live = 0; return { calls, live: () => live, run: (cmd: string, args: readonly string[]) => { calls.push([cmd, ...args]); live += 1; return { kill: () => { live -= 1; }, on: () => undefined }; } }; };

test("one assertion however many turns run, released with the last one, tied to this process", () => {
  const f = fake();
  const k = createKeepAwake({ platform: "darwin", pid: 42, run: f.run });
  k.up(); k.up();
  assert.deepEqual(f.calls, [["caffeinate", "-i", "-w", "42"]]);
  k.down();
  assert.equal(f.live(), 1, "one still runs");
  k.down();
  assert.equal(f.live(), 0);
  k.down();
  k.up();
  assert.equal(f.calls.length, 2, "a turn after the count hit zero holds again, and an extra end changes nothing");
  k.stop();
  assert.equal(f.live(), 0);
});

test("a server does nothing, and a Mac without the command just carries on", () => {
  const f = fake();
  const k = createKeepAwake({ platform: "linux", run: f.run });
  k.up();
  assert.equal(f.calls.length, 0);
  const broken = createKeepAwake({ platform: "darwin", run: () => { throw new Error("no such command"); } });
  assert.doesNotThrow(() => { broken.up(); broken.down(); });
});
