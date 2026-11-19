// Site logs: cleaning, levels, search words, the caps, and the follower that reads Docker's stamped lines (r42-sites-run, slice 4).
import test from "node:test";
import assert from "node:assert/strict";
import {
  LOG_CAPS,
  LogFollower,
  LogRing,
  cleanLines,
  leftOut,
  levelOf,
  limitOf,
  parseStamped,
  terms,
} from "../ops/logs.ts";

test("cleanLines drops colour codes, carriage returns and blank lines, and cuts a long line", () => {
  assert.deepEqual(cleanLines("\u001b[31mred\u001b[0m\r\n\n  \nok  "), ["red", "ok"]);
  const long = cleanLines("x".repeat(5000));
  assert.equal(long[0]?.length, LOG_CAPS.lineChars + 3);
  assert.ok(long[0]?.endsWith("..."));
});

test("levelOf reads the words", () => {
  assert.equal(levelOf("TypeError: x is not a function"), "error");
  assert.equal(levelOf("Error: connect ECONNREFUSED 10.0.0.1:5432"), "error");
  assert.equal(levelOf("Unhandled promise rejection"), "error");
  assert.equal(levelOf("DeprecationWarning: x"), "warn");
  assert.equal(levelOf("npm ERR! code ELIFECYCLE"), "error");
  assert.equal(levelOf("listening on 3000"), "info");
});

test("terms reads words, quoted phrases and exclusions", () => {
  assert.deepEqual(terms('timeout "db pool" -health'), [
    { text: "timeout", not: false },
    { text: "db pool", not: false },
    { text: "health", not: true },
  ]);
  assert.deepEqual(terms("   "), []);
  assert.deepEqual(terms(undefined), []);
});

test("search needs every word, ignores case, and honours exclusions, source, level and time", () => {
  const r = new LogRing();
  r.add("app", "svc", 1000, "GET /health ok\nDB pool timeout after 30s\nerror: db pool exhausted");
  r.add("requests", "svc", 2000, "GET /api 200 12ms");
  const all = r.read({}).lines;
  assert.equal(all.length, 4);
  assert.deepEqual(
    r.read({ q: "db POOL" }).lines.map((l) => l.text),
    ["DB pool timeout after 30s", "error: db pool exhausted"],
  );
  assert.deepEqual(
    r.read({ q: "pool -exhausted" }).lines.map((l) => l.text),
    ["DB pool timeout after 30s"],
  );
  assert.deepEqual(
    r.read({ source: "requests" }).lines.map((l) => l.text),
    ["GET /api 200 12ms"],
  );
  assert.deepEqual(
    r.read({ level: "error" }).lines.map((l) => l.text),
    ["error: db pool exhausted"],
  );
  assert.equal(r.read({ from: 1500 }).lines.length, 1);
  assert.equal(r.read({ to: 1500 }).lines.length, 3);
});

test("a follower's cursor returns only what came after", () => {
  const r = new LogRing();
  r.add("app", "a", 1, "one\ntwo");
  const first = r.read({});
  r.add("app", "a", 2, "three");
  const more = r.read({ after: first.lastSeq });
  assert.deepEqual(
    more.lines.map((l) => l.text),
    ["three"],
  );
  assert.equal(r.read({ after: more.lastSeq }).lines.length, 0);
});

test("a read returns the newest lines, at most 1000, oldest first", () => {
  const r = new LogRing({ ...LOG_CAPS, lines: 100_000, bytes: 1e9 });
  for (let i = 0; i < 1500; i++) r.add("app", "a", i, `line ${i}`);
  const out = r.read({ limit: 5000 }).lines;
  assert.equal(out.length, 1000);
  assert.equal(out[0]?.text, "line 500");
  assert.equal(out.at(-1)?.text, "line 1499");
  assert.equal(limitOf(undefined), 200);
  assert.equal(limitOf(0), 200);
  assert.equal(limitOf(-4), 1);
  assert.equal(limitOf(9999), 1000);
});

test("a scope keeps its newest lines and counts what fell off (the log volume cap)", () => {
  const r = new LogRing({ lineChars: 100, lines: 10, bytes: 1e9, scopes: 5 });
  for (let i = 0; i < 25; i++) r.add("app", "dep1", i, `n${i}`);
  const out = r.read({ scope: "dep1" });
  assert.equal(out.lines.length, 10);
  assert.equal(out.lines[0]?.text, "n15");
  assert.equal(out.dropped, 15);
  assert.equal(leftOut(out.dropped), "... 15 earlier lines left out");
  assert.equal(leftOut(1), "... 1 earlier line left out");
  assert.equal(leftOut(0), null);
});

test("the byte cap drops the oldest lines too, and one chatty scope cannot starve another", () => {
  const r = new LogRing({ lineChars: 100, lines: 1000, bytes: 100, scopes: 5 });
  for (let i = 0; i < 50; i++) r.add("app", "loud", i, "x".repeat(19)); // 20 bytes a line, 5 fit
  r.add("app", "quiet", 99, "still here");
  assert.equal(r.read({ scope: "loud" }).lines.length, 5);
  assert.equal(r.read({ scope: "quiet" }).lines.length, 1);
  const info = r.scopes().find((s) => s.scope === "loud");
  assert.equal(info?.dropped, 45);
  assert.ok((info?.bytes ?? 0) <= 100);
});

test("past the scope cap the scope that printed longest ago goes, never the one being written", () => {
  const r = new LogRing({ lineChars: 100, lines: 10, bytes: 1e9, scopes: 3 });
  r.add("build", "d1", 10, "a");
  r.add("build", "d2", 20, "b");
  r.add("app", "svc", 30, "c");
  r.add("build", "d3", 40, "d");
  const names = r
    .scopes()
    .map((s) => s.scope)
    .sort();
  assert.deepEqual(names, ["d2", "d3", "svc"]);
  r.add("build", "d1", 5, "again"); // an old scope coming back is allowed and evicts the oldest other
  assert.equal(r.scopes().length, 3);
  assert.ok(r.scopes().some((s) => s.scope === "d1"));
});

test("parseStamped reads Docker's timestamp and keeps the text whole", () => {
  const p = parseStamped("2026-11-19T10:00:05.123456789Z hello  world");
  assert.equal(p?.text, "hello  world");
  assert.equal(p?.at, Date.parse("2026-11-19T10:00:05.123Z"));
  assert.equal(p?.ns, "2026-11-19T10:00:05.123456789Z");
  assert.equal(parseStamped("2026-11-19T10:00:05Z x")?.ns, "2026-11-19T10:00:05.000000000Z");
  assert.equal(parseStamped("no stamp here"), null);
});

function follow(frames: string[][]): { f: LogFollower; got: string[]; seen: number[] } {
  const got: string[] = [];
  const seen: number[] = [];
  let i = 0;
  const f = new LogFollower({
    read: async (since) => {
      seen.push(since);
      return frames[Math.min(i++, frames.length - 1)] ?? [];
    },
    sink: (_at, text) => got.push(text),
  });
  return { f, got, seen };
}

test("a follower hands over each line once, even when Docker repeats the second it was asked from", async () => {
  const a = "2026-11-19T10:00:00.100000000Z a";
  const b = "2026-11-19T10:00:00.900000000Z b";
  const c = "2026-11-19T10:00:01.000000000Z c";
  const { f, got, seen } = follow([[a, b], [a, b, c], [a, b, c], [c]]);
  assert.equal(await f.poll(), 2);
  assert.equal(await f.poll(), 1);
  assert.equal(await f.poll(), 0);
  assert.equal(await f.poll(), 0);
  assert.deepEqual(got, ["a", "b", "c"]);
  assert.equal(seen[0], 0);
  assert.equal(seen[1], Date.parse("2026-11-19T10:00:00Z") / 1000);
});

test("a follower keeps two different lines that carry the same time, and drops a repeat of one", async () => {
  const t = "2026-11-19T10:00:00.500000000Z";
  const { f, got } = follow([
    [`${t} x`, `${t} y`],
    [`${t} x`, `${t} y`, `${t} z`],
  ]);
  await f.poll();
  await f.poll();
  assert.deepEqual(got, ["x", "y", "z"]);
});

test("a follower that fails changes nothing, and one restarted from a cursor does not repeat", async () => {
  let fail = true;
  const got: string[] = [];
  const lines = ["2026-11-19T10:00:00.000000000Z a", "2026-11-19T10:00:02.000000000Z b"];
  const mk = (cursor?: { ns: string }): LogFollower =>
    new LogFollower(
      {
        read: async () => {
          if (fail) throw new Error("engine down");
          return lines;
        },
        sink: (_a, t) => got.push(t),
      },
      cursor,
    );
  const f = mk();
  await assert.rejects(() => f.poll());
  assert.deepEqual(f.cursor, { ns: "" });
  fail = false;
  await f.poll();
  assert.deepEqual(got, ["a", "b"]);
  const again = mk(f.cursor); // the server restarted; the store kept the cursor
  await again.poll();
  assert.deepEqual(got, ["a", "b"]);
});
