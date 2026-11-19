// The agent's last action as the desk's cursor reads it (pointer.ts): counted, with the chosen element's box only when the press is at its centre, nothing carried from one action to the next.
import test from "node:test";
import assert from "node:assert/strict";
import { createPointerNote } from "./pointer.ts";

test("nothing before the first action; each press counts once, with the tool that ran", () => {
  let t = 1000;
  const p = createPointerNote(() => ++t);
  assert.equal(p.get(), null);
  p.during("chrome_click");
  p.at(40, 50);
  assert.deepEqual(p.get(), { seq: 1, tool: "chrome_click", x: 40, y: 50, at: 1001 });
  p.during("chrome_type");
  p.at(41, 51);
  assert.equal(p.get()?.seq, 2);
  assert.equal(p.get()?.tool, "chrome_type");
});

test("a chosen element's box and name ride along when the press is at its centre, and never leak to the next action", () => {
  const p = createPointerNote(() => 5);
  p.during("chrome_act");
  p.chose({ x: 100, y: 200, w: 80, h: 40, label: "Send request" });
  p.at(140, 220);
  assert.deepEqual(p.get(), {
    seq: 1,
    tool: "chrome_act",
    x: 140,
    y: 220,
    at: 5,
    box: { x: 100, y: 200, w: 80, h: 40 },
    label: "Send request",
  });
  p.at(140, 220);
  assert.equal(p.get()?.box, undefined, "the box belonged to the first action only");
  assert.equal(p.get()?.label, undefined);
});

test("a coordinate press away from the chosen element does not borrow its box; a long name is cut to 60 characters", () => {
  const p = createPointerNote(() => 5);
  p.chose({ x: 0, y: 0, w: 10, h: 10, label: "x" });
  p.at(300, 300);
  assert.equal(p.get()?.box, undefined);
  p.chose({ x: 0, y: 0, w: 10, h: 10, label: "n".repeat(200) });
  p.at(5, 5);
  assert.equal(p.get()?.label?.length, 60);
});
