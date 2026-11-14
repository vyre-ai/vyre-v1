// The Computer tab's browser picture pulls still frames (computers.browser.preview): in order, a repeated frame is not shown again, a failed read keeps the last frame and goes on, a hidden page asks for none, and stopping ends it.
import test from "node:test";
import assert from "node:assert/strict";
import { pullFrames } from "./PreviewImage.tsx";

test("frames are shown in order, a repeat is skipped, a failure keeps going, hidden asks for nothing, stop ends it", async () => {
  const answers: Array<() => unknown> = [
    () => ({ state: "live", png: "AAA" }),
    () => ({ state: "live", png: "AAA" }),
    () => {
      throw new Error("down");
    },
    () => ({ state: "asleep" }),
    () => ({ state: "live", png: "BBB" }),
  ];
  const asked: string[] = [];
  const shown: string[] = [];
  let tick = 0;
  let hidden = false;
  let stop: () => void = () => undefined;
  const wait = async (): Promise<void> => {
    tick++;
    if (tick === 5) hidden = true;
    if (tick === 7) stop();
    await Promise.resolve();
  };
  stop = pullFrames(
    async (cap, input) => {
      asked.push(`${cap} ${(input as { agentId: string }).agentId}`);
      const a = answers.shift();
      if (!a) return { state: "live", png: "CCC" };
      return a();
    },
    "agt_x",
    (u) => shown.push(u),
    { wait, hidden: () => hidden },
  );
  for (let i = 0; i < 40; i++) await Promise.resolve();
  assert.deepEqual(shown, ["data:image/png;base64,AAA", "data:image/png;base64,BBB"]);
  assert.ok(asked.every((x) => x === "computers.browser.preview agt_x"));
  assert.equal(asked.length, 5, "five reads, none while hidden (ticks 5 and 6)");
});
