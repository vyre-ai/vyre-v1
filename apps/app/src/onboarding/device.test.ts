import test from "node:test";
import assert from "node:assert/strict";
import { countsOn, detectDevice, nextOn, resumeOn, stateOn, visibleSteps } from "./device.ts";
import { stepsOf } from "./flow.ts";

test("a browser has no sessions or folders; a phone also has no Chrome step; the desktop apps have all of them (journey table D)", () => {
  const keys = (d: Parameters<typeof visibleSteps>[1]): string[] => visibleSteps("personal", d).map((s) => s.key);
  assert.equal(keys("mac").length, 8);
  assert.deepEqual(keys("win"), keys("mac"));
  assert.ok(!keys("web").includes("sessions") && !keys("web").includes("folders") && keys("web").includes("chrome"));
  assert.ok(!keys("phone").includes("chrome") && !keys("phone").includes("sessions"));
  assert.equal(keys("web").length, 6);
  assert.equal(keys("phone").length, 5);
  assert.equal(visibleSteps("team", "phone").length, 9, "team steps do not depend on the device");
});

test("on a phone, Your phone is already done, and the counts, resume and next follow the visible steps", () => {
  const phone = stepsOf("personal").find((s) => s.card === "phone")!;
  assert.equal(stateOn({}, phone, "phone"), "done");
  assert.equal(stateOn({}, phone, "mac"), "open");
  assert.deepEqual(countsOn("personal", {}, "phone"), { done: 1, later: 0, total: 5 });
  assert.equal(resumeOn("personal", {}, "phone"), "ai");
  assert.equal(nextOn("personal", { ai: "done" }, "ai", "phone"), "interview");
  assert.equal(nextOn("personal", { ai: "done", interview: "done" }, "interview", "phone"), "win", "the hidden steps and the done phone step are passed over");
  assert.equal(nextOn("personal", { ai: "done", interview: "done", win: "done", team: "done" }, "team", "phone"), null);
});

test("the device is a phone by width, the desktop app by its Tauri bridge (Mac or Windows by platform), and otherwise the web", () => {
  assert.equal(detectDevice(390), "phone");
  assert.equal(detectDevice(1440), "web");
  const g = globalThis as { __TAURI__?: unknown; navigator?: unknown };
  const nav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  try {
    g.__TAURI__ = {};
    Object.defineProperty(globalThis, "navigator", { value: { platform: "MacIntel" }, configurable: true });
    assert.equal(detectDevice(1440), "mac");
    Object.defineProperty(globalThis, "navigator", { value: { platform: "Win32" }, configurable: true });
    assert.equal(detectDevice(1440), "win");
  } finally {
    delete g.__TAURI__;
    if (nav) Object.defineProperty(globalThis, "navigator", nav); else delete (globalThis as { navigator?: unknown }).navigator;
  }
});

test("the Home checklist rows follow the device: a browser has no sessions or folders, a phone no Chrome and its phone step is done", async () => {
  const { setupRows } = await import("./setup-rows.ts");
  const keys = (d: "mac" | "web" | "phone"): string[] => setupRows("personal", {}, d).map((r) => r.key);
  assert.ok(keys("mac").includes("sessions") && keys("mac").includes("folders") && keys("mac").includes("chrome"));
  assert.ok(!keys("web").includes("sessions") && !keys("web").includes("folders") && keys("web").includes("chrome"));
  assert.ok(!keys("phone").includes("chrome") && !keys("phone").includes("sessions"));
  assert.equal(setupRows("personal", {}, "phone").find((r) => r.key === "phone")?.state, "done");
});
