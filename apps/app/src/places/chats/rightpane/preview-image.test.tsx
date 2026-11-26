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
  const warmed: string[] = [];
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
      if (cap === "computers.browser.warm") {
        warmed.push((input as { agentId: string }).agentId);
        return { state: "skipped" };
      }
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
  assert.deepEqual(warmed, [], "looking at the pane never asks the browser to start: asleep is the default (rc.44)");
});

test("a pane that is seen or hidden never asks the browser to start: frames still come, and nothing is asked while hidden", async () => {
  const shown: string[] = [];
  const warmedHidden: string[] = [];
  const stopA = pullFrames(
    async (cap) => {
      if (cap === "computers.browser.warm") throw new Error("refused");
      return { state: "live", png: "ZZZ" };
    },
    "agt_y",
    (u) => shown.push(u),
    { wait: () => new Promise<void>(() => undefined) },
  );
  for (let i = 0; i < 20; i++) await Promise.resolve();
  stopA();
  assert.deepEqual(shown, ["data:image/png;base64,ZZZ"]);
  const stopB = pullFrames(
    async (cap) => {
      if (cap === "computers.browser.warm") warmedHidden.push(cap);
      return { state: "asleep" };
    },
    "agt_z",
    () => undefined,
    { hidden: () => true, wait: () => new Promise<void>(() => undefined) },
  );
  for (let i = 0; i < 10; i++) await Promise.resolve();
  stopB();
  assert.deepEqual(warmedHidden, []);
});
