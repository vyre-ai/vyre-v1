// The Finish setup entry in the title bar: its count is the steps really done of this device's list, it is not there on a Space nobody has started setting up, and it goes when every step is done or put off.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ResumeChip, resumeInfo, startedSetup } from "./ResumeChip.tsx";
import { stepsOf } from "./flow.ts";
import { visibleSteps } from "./device.ts";
import type { Progress } from "./flow.ts";

const draw = (flow: "personal" | "team" | "member", progress: Progress, device: "mac" | "web" | "phone" = "web"): string =>
  renderToStaticMarkup(<ResumeChip flow={flow} progress={progress} device={device} compact={false} onOpen={() => undefined} />).replaceAll("<!-- -->", "");
const allDone = (flow: "personal" | "team" | "member", device: "mac" | "web" | "phone"): Progress => Object.fromEntries(visibleSteps(flow, device).map((s) => [s.key, "done" as const]));

test("a brand-new Space has no entry in the bar: nothing is done or put off, so no 0 of 9; setup opens by itself and the landing and the Console carry it", () => {
  assert.equal(draw("team", {}), "");
  assert.equal(startedSetup("team", {}, "web"), false);
  assert.equal(resumeInfo("team", {}, "web")?.total, 9, "the steps are still known, for the screens that show them in place");
});

test("once a step is done the entry says how many of the real steps are done; a step put off moves it on but never the number", () => {
  const one = draw("team", { org: "done" });
  assert.match(one, /Finish setup, 1 of 9/);
  const later = draw("team", { org: "done", space_ai: "later" });
  assert.match(later, /Finish setup, 1 of 9/);
  assert.equal(resumeInfo("team", { org: "done", space_ai: "later" }, "web")?.step, "workspace", "it opens at the first step still open");
});

test("the count follows this device's list: steps this device hides are not in the total, and a key that is no step of the flow counts for nothing", () => {
  const web = visibleSteps("personal", "web").length, mac = visibleSteps("personal", "mac").length;
  assert.ok(web < mac && mac === stepsOf("personal").length, "a browser has fewer steps than the desktop app");
  assert.match(draw("personal", { ai: "done" }, "web"), new RegExp(`Finish setup, 1 of ${web}`));
  assert.equal(resumeInfo("personal", { ai: "done", sessions: "done", stray: "done" }, "web")?.done, 1, "sessions is hidden in a browser, stray is no step");
});

test("the entry goes when every step is done, and when every step is done or put off", () => {
  assert.equal(draw("team", allDone("team", "web")), "");
  assert.equal(resumeInfo("team", allDone("team", "web"), "web"), null);
  const mixed: Progress = Object.fromEntries(stepsOf("team").map((s, i) => [s.key, i % 2 ? "later" : "done"]));
  assert.equal(draw("team", mixed), "");
});
