// Unit tests for the screenshot tooling helpers and the budget row (the browser parts run in .github/workflows/shots.yml).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-expect-error plain .mjs helper without types
import { parseArgs, protoHash, routeUrl, loadTargets, sideBySideHtml, countWrongFrames, budgetOf } from "./lib.mjs";

test("parseArgs reads values and flags", () => {
  assert.deepEqual(parseArgs(["--target", "sample", "--skip-export", "--out", "x"]), { target: "sample", "skip-export": true, out: "x" });
});

test("the prototype hash takes the skin and the route url carries skin and mode", () => {
  assert.equal(protoHash("home,{skin}", "graphite"), "home,graphite");
  assert.equal(routeUrl("http://h:1", "records", "paper"), "http://h:1/records?skin=paper");
  assert.equal(routeUrl("http://h:1", "/", "graphite", "dark"), "http://h:1/?skin=graphite&mode=dark");
});

test("targets load from targets.json and targets/*.json, and a duplicate id is refused", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "shots-"));
  fs.mkdirSync(path.join(d, "targets"));
  fs.writeFileSync(path.join(d, "targets.json"), JSON.stringify({ targets: [{ id: "a", route: "/", proto: "home,{skin}" }] }));
  fs.writeFileSync(path.join(d, "targets", "p1.json"), JSON.stringify({ targets: [{ id: "b", route: "/b", proto: "files,{skin}" }] }));
  assert.deepEqual(loadTargets(d).map((t: { id: string }) => t.id), ["a", "b"]);
  fs.writeFileSync(path.join(d, "targets", "p2.json"), JSON.stringify({ targets: [{ id: "a", route: "/", proto: "x" }] }));
  assert.throws(() => loadTargets(d), /duplicate target id a/);
  fs.writeFileSync(path.join(d, "targets", "p2.json"), JSON.stringify({ targets: [{ id: "c" }] }));
  assert.throws(() => loadTargets(d), /needs id, route and proto/);
});

test("the shipped targets.json is valid", () => {
  const t = loadTargets(path.dirname(new URL(import.meta.url).pathname));
  assert.ok(t.length >= 1);
  for (const x of t) assert.ok(x.proto.includes("{skin}"), `${x.id} prototype hash takes the skin`);
});

test("side-by-side page shows both images with captions", () => {
  const h = sideBySideHtml({ title: "t <x>", real: "r.png", proto: "p.png" });
  assert.match(h, /src="r\.png"/); assert.match(h, /src="p\.png"/); assert.match(h, /t &lt;x>/);
});

test("wrong frames are those off the expected color", () => {
  assert.equal(countWrongFrames(["a", "a", "b", "a"], "a"), 1);
  assert.equal(countWrongFrames([], "a"), 0);
});

test("budgets.json has the theme_flash row with its probe", () => {
  const b = JSON.parse(fs.readFileSync(new URL("../../budgets.json", import.meta.url), "utf8"));
  const row = budgetOf(b, "theme_flash");
  assert.equal(row.wrong_frames_max, 0);
  assert.ok(fs.existsSync(new URL("../../" + row.probe, import.meta.url)), "probe file exists");
  assert.throws(() => budgetOf(b, "nope"), /no row nope/);
});
