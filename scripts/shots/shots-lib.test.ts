// Unit tests for the screenshot tooling helpers and the budget row (the browser parts run in .github/workflows/shots.yml).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
// @ts-expect-error plain .mjs helper without types
import { parseArgs, protoHash, routeUrl, loadTargets, shardTargets, shardIndexName, mergeShotIndexes, sideBySideHtml, countWrongFrames, budgetOf } from "./lib.mjs";

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

test("twelve screenshot shards cover every target once without overlap", () => {
  const targets = loadTargets(path.dirname(new URL(import.meta.url).pathname));
  const shards = Array.from({ length: 12 }, (_, index) => shardTargets(targets, index, 12));
  const ids = shards.flat().map((t: { id: string }) => t.id);
  assert.equal(ids.length, targets.length);
  assert.equal(new Set(ids).size, targets.length);
  assert.deepEqual([...ids].sort(), targets.map((t: { id: string }) => t.id).sort());
  assert.ok(Math.max(...shards.map((s) => s.length)) - Math.min(...shards.map((s) => s.length)) <= 1);
});

test("screenshot shard selection is deterministic and rejects invalid coordinates", () => {
  const targets = Array.from({ length: 8 }, (_, id) => ({ id }));
  assert.deepEqual(shardTargets(targets, 1, 3).map((t: { id: number }) => t.id), [1, 4, 7]);
  assert.deepEqual(shardTargets(targets, 1, 3), shardTargets(targets, 1, 3));
  assert.throws(() => shardTargets(targets, -1, 3), /shard index/);
  assert.throws(() => shardTargets(targets, 3, 3), /shard index/);
  assert.throws(() => shardTargets(targets, 0, 0), /shard total/);
});

test("shard indexes merge into one canonical screenshot index", () => {
  assert.equal(shardIndexName(0, 1), "index.md");
  assert.equal(shardIndexName(2, 12), "index-shard-02-of-12.md");
  const first = "# Side-by-side screenshots\n\nExport: 1.0 s\n\n| target | skin | size | file |\n|---|---|---|---|\n| b | paper | phone | b.png |\n";
  const second = "# Side-by-side screenshots\n\nExport: 2.0 s\n\n| target | skin | size | file |\n|---|---|---|---|\n| a | graphite | desktop | a.png |\n";
  const merged = mergeShotIndexes([
    { name: "index-shard-00-of-2.md", text: first },
    { name: "index-shard-01-of-2.md", text: second },
  ], 2);
  assert.match(merged, /^# Side-by-side screenshots/m);
  assert.match(merged, /2 shards/);
  assert.ok(merged.indexOf("| a |") < merged.indexOf("| b |"), "canonical rows are stable");
  assert.throws(() => mergeShotIndexes([{ name: "index-shard-00-of-2.md", text: first }], 2), /expected shard indexes/);
  assert.throws(() => mergeShotIndexes([
    { name: "index-shard-00-of-3.md", text: first },
    { name: "index-shard-01-of-3.md", text: second },
  ], 2), /expected shard indexes/);
  assert.throws(() => mergeShotIndexes([
    { name: "index-shard-00-of-2.md", text: first },
    { name: "index-shard-00-of-2.md", text: second },
  ], 2), /expected shard indexes/);
});

test("a packet without visual targets emits an empty uploadable index", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "shots-empty-"));
  execFileSync(process.execPath, [new URL("./shots.mjs", import.meta.url).pathname, "--target", "P-NO_VISUAL_TARGETS", "--out", out, "--skip-export", "--no-probes", "--shard-index", "0", "--shard-total", "1"]);
  assert.ok(fs.existsSync(path.join(out, "index.md")));
  assert.match(fs.readFileSync(path.join(out, "index.md"), "utf8"), /0 side-by-side images/);
});

test("P-UI_14 emits an empty uploadable index after its startup-only path", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "shots-ui14-"));
  execFileSync(process.execPath, [new URL("./shots.mjs", import.meta.url).pathname, "--target", "P-UI_14", "--out", out, "--skip-startup", "--skip-export", "--no-probes", "--shard-index", "0", "--shard-total", "1"]);
  assert.ok(fs.existsSync(path.join(out, "index.md")));
  assert.match(fs.readFileSync(path.join(out, "index.md"), "utf8"), /0 side-by-side images/);
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
