// Scrub property (ARCH 6.11): a filled value never reaches the transcript or the model context, in any common spelling, however a stream is chunked.
// A fragment that survives is a vault.scrub_miss and the output is withheld.
import test from "node:test";
import assert from "node:assert/strict";
import { createScrubber, runWithVault, variantsOf, WITHHELD } from "../src/vault-use/index.ts";
import type { Lookup, Secret, ValueSource } from "../src/vault-use/index.ts";

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
}
const ALPHABETS = [
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  "abcdef0123456789",
  "ABCDEFGHJKLMNPQRSTUVWXYZ23456789-_",
  "abc +/=&?#%:;\"'\\<>{}[]!@$^*()~`|éüß",
];
function secretOf(r: () => number): string {
  const alpha = ALPHABETS[Math.floor(r() * ALPHABETS.length)] ?? ALPHABETS[0] ?? "";
  const len = 4 + Math.floor(r() * 60);
  let s = "";
  for (let i = 0; i < len; i++) s += alpha[Math.floor(r() * alpha.length)] ?? "x";
  return s;
}
function noise(r: () => number, n: number): string {
  const a = "abcdefghijklmnopqrstuvwxyz ./:\n";
  let s = "";
  for (let i = 0; i < n; i++) s += a[Math.floor(r() * a.length)] ?? " ";
  return s;
}
const secretRow = (value: string, n = 1): Secret => ({ handle: `#Item${n}.api_key`, itemId: `vit_${n}`, value });

/** The ways a value turns up in command output. */
function spellings(value: string, r: () => number): string[] {
  const buf = (s: string): Buffer => Buffer.from(s, "utf8");
  const pre = noise(r, Math.floor(r() * 6)), post = noise(r, Math.floor(r() * 6));
  const wrapped = buf(pre + value + post);
  const url = encodeURIComponent(value);
  return [
    value,
    JSON.stringify(value).slice(1, -1),
    url,
    url.replace(/%20/g, "+"),
    url.toLowerCase(),
    buf(value).toString("hex"),
    buf(value).toString("hex").toUpperCase(),
    wrapped.toString("base64"),
    wrapped.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    buf(value).toString("base64"),
  ];
}

test("property: 400 random values in every spelling and every base64 alignment never survive the scrubber", () => {
  const r = rng(20251025);
  let checked = 0;
  for (let i = 0; i < 400; i++) {
    const value = secretOf(r);
    const s = secretRow(value);
    const sc = createScrubber([s]);
    for (const spelled of spellings(value, r)) {
      const out = sc.scrub(`${noise(r, 5)}${spelled}${noise(r, 5)}`);
      for (const v of variantsOf(value)) assert.ok(!out.includes(v), `a spelling of the value survived: ${JSON.stringify(v.length)} chars`);
      assert.deepEqual(sc.residual(out), [], "no long fragment is left");
      checked++;
    }
  }
  assert.equal(checked, 4000);
});

test("property: streaming in chunks of 1 to 9 characters scrubs exactly what the whole text scrub does", async () => {
  const r = rng(77);
  for (let i = 0; i < 120; i++) {
    const value = secretOf(r);
    const sc = createScrubber([secretRow(value)]);
    const text = `${noise(r, 20)}${value}${noise(r, 7)}${Buffer.from(value).toString("base64")}${noise(r, 9)}${encodeURIComponent(value)}${noise(r, 12)}`;
    const size = 1 + Math.floor(r() * 9);
    const pieces: string[] = [];
    for (let at = 0; at < text.length; at += size) pieces.push(text.slice(at, at + size));
    let got = "";
    for await (const p of sc.stream((async function* () { yield* pieces; })())) got += p;
    assert.equal(got, sc.scrub(text), `chunk size ${size}`);
    assert.ok(!got.includes(value));
  }
});

test("two values at once, one inside the other's neighbourhood, both go; the marker names the handle, not the value", () => {
  const a = secretRow("sk_live_AAAA1111bbbb2222", 1);
  const b = { handle: "#Item2.token", itemId: "vit_2", value: "ghp_CCCC3333dddd4444eeee" };
  const sc = createScrubber([a, b]);
  const out = sc.scrub(`auth ${a.value}:${b.value} and ${Buffer.from(b.value).toString("base64")}`);
  assert.equal(out, "auth [#Item1.api_key]:[#Item2.token] and [#Item2.token]");
});

test("a value too short to scrub is refused before it is ever filled", () => {
  assert.throws(() => createScrubber([secretRow("abc")]), RangeError);
});

function source(rows: Record<string, Lookup>): ValueSource {
  return { lookup: async (h) => rows[h] ?? { kind: "unknown" } };
}
const lookupOf = (value: string, itemId = "vit_1"): Lookup => ({ kind: "value", itemId, value, spaceOnly: false, injectIntoDeployments: false });

test("a fragment that gets past the exact and encoded matches is a scrub_miss: reported by id and place, output withheld, value nowhere", async () => {
  const value = "sk_live_ABCDEFGH12345678";
  const misses: Array<{ itemId: string; place: string; traceId: string }> = [];
  const run = await runWithVault(
    { source: source({ "#Dana_Stripe.api_key": lookupOf(value) }), reportMiss: (m) => { misses.push(m); } },
    { tool: "terminal_run", args: { command: "curl -u #Dana_Stripe.api_key: https://api" }, traceId: "tr_1", agentId: "agt_1", asker: "usr_dana", where: "host" },
    async () => `ok sk_live_\u001b[0mABCDEFGH12345678 done`,   // an escape code splits the value: no exact match, but a long fragment remains
  );
  assert.equal(run.ok, true);
  if (!run.ok) return;
  assert.equal(run.scrubMiss, true);
  assert.equal(run.output, WITHHELD);
  assert.deepEqual(misses, [{ itemId: "vit_1", place: "terminal", traceId: "tr_1" }]);
  assert.ok(!JSON.stringify({ run, misses }).includes("ABCDEFGH"), "no part of the value is in what the model or the event sees");
});

test("a streamed miss replaces the rest of the stream and reports once", async () => {
  const value = "sk_live_ABCDEFGH12345678";
  let reports = 0;
  const run = await runWithVault(
    { source: source({ "#Dana_Stripe.api_key": lookupOf(value) }), reportMiss: () => { reports++; } },
    { tool: "terminal_run", args: { command: "tail -f log #Dana_Stripe.api_key" }, traceId: "tr_2", agentId: "agt_1", asker: "usr_dana", where: "host" },
    async () => (async function* () { yield "line one\n".padEnd(200, "."); yield "tok sk_live_\u001b[1m"; yield "ABCDEFGH12345678\n"; yield "line three\n"; })(),
  );
  assert.equal(run.ok, true);
  if (!run.ok || typeof run.output === "string") return assert.fail("expected a stream");
  let seen = "";
  for await (const p of run.output) seen += p;
  assert.ok(seen.includes("line one"));
  assert.ok(seen.includes(WITHHELD));
  assert.ok(!seen.includes("ABCDEFGH"));
  assert.ok(!seen.includes("line three"), "nothing after the miss is released");
  assert.equal(reports, 1);
});

test("value never reaches transcript or model context: arguments as written, scrubbed output, error echo scrubbed, in every spelling", async () => {
  const r = rng(5);
  for (let i = 0; i < 60; i++) {
    const value = secretOf(r);
    const echo = spellings(value, r).join(" | ");
    const run = await runWithVault(
      { source: source({ "#Dana_Key.api_key": lookupOf(value) }), reportMiss: () => { throw new Error("unexpected miss"); } },
      { tool: "terminal_run", args: { command: "run", env: { TOKEN: "#Dana_Key.api_key" } }, traceId: "tr", agentId: "agt_1", asker: "usr_dana", where: "host" },
      async (filled) => {
        assert.equal((filled as { env: { TOKEN: string } }).env.TOKEN, value, "the executor does get the value");
        return `used ${echo}`;
      },
    );
    assert.equal(run.ok, true);
    if (!run.ok) continue;
    assert.deepEqual(run.display, { command: "run", env: { TOKEN: "#Dana_Key.api_key" } });
    const transcript = JSON.stringify({ display: run.display, output: run.output, used: run.used });
    for (const v of variantsOf(value)) assert.ok(!transcript.includes(v));

    const failed = await runWithVault(
      { source: source({ "#Dana_Key.api_key": lookupOf(value) }), reportMiss: () => {} },
      { tool: "terminal_run", args: { command: "run #Dana_Key.api_key" }, traceId: "tr", agentId: "agt_1", asker: "usr_dana", where: "host" },
      async (filled) => { throw new Error(`exec failed: ${(filled as { command: string }).command}`); },
    );
    assert.equal(failed.ok, false);
    if (!failed.ok) for (const v of variantsOf(value)) assert.ok(!JSON.stringify(failed).includes(v));
  }
});
