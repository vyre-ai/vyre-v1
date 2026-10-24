// Credentials never enter the transcript, a summary or another engine's first message (ARCH 6.9). Every key below is assembled from pieces: this file holds no key.
import test from "node:test";
import assert from "node:assert/strict";
import { redact, scan, SEED_OPEN, withoutSeed, withoutVyre } from "../src/transcript/index.ts";

const j = (...p: string[]): string => p.join("");

const SHAPES: Array<[name: string, value: string, label: string]> = [
  ["anthropic", j("sk-", "ant-", "api03-", "A".repeat(24)), "Anthropic key"],
  ["openai", j("sk-", "proj-", "Zy9".repeat(10)), "API key"],
  ["stripe", j("sk", "_live_", "NorthwindBakery0000fake12"), "Stripe key"],
  ["github", j("gh", "p_", "a1B2".repeat(8)), "GitHub token"],
  ["aws", j("AK", "IA", "ABCDEFGHIJKLMNOP"), "AWS key id"],
  ["slack", j("xox", "b-", "1234567890-abcdefghij"), "Slack token"],
  ["google", j("AI", "za", "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6"), "Google key"],
  ["jwt", ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"].join("."), "JWT"],
  ["bearer", j("Bear", "er ", "q".repeat(30)), "bearer token"],
];

test("each vendor shape is replaced by a marker that keeps its kind and last four characters", () => {
  for (const [name, value, label] of SHAPES) {
    const r = redact(`please use ${value} for the call`);
    assert.ok(!r.text.includes(value), name);
    assert.equal(r.text, `please use [${label} redacted …${value.slice(-4)}] for the call`, name);
    assert.deepEqual(r.hits, [name], name);
  }
});

test("a private key block goes whole, including one whose end was clipped", () => {
  const begin = j("-----BEGIN ", "RSA PRIVATE ", "KEY-----");
  const end = j("-----END ", "RSA PRIVATE ", "KEY-----");
  const whole = redact(`here: ${begin}\nMIIEowIBAAKCAQEAxyz\nabc\n${end} done`);
  assert.ok(!whole.text.includes("MIIEow"));
  assert.equal(whole.text, "here: [private key redacted] done", "no part of a key is shown, not even its last four characters");
  const clipped = redact(`paste: ${begin}\nMIIEowIBAAKCAQEAxyz\nabc`);
  assert.ok(!clipped.text.includes("MIIEow"));
  assert.equal(clipped.text, "paste: [private key redacted]");
});

test("a secret found by its name or place keeps the name and loses the value", () => {
  const value = "zz9Q8w7e6r5t4y3u2i1o";
  assert.equal(redact(`API_KEY=${value}`).text, `API_KEY=[secret redacted …${value.slice(-4)}]`);
  assert.equal(redact(`{"clientSecret": "${value}"}`).text, `{"clientSecret": "[secret redacted …${value.slice(-4)}]"}`);
  assert.equal(redact("DATABASE_URL=postgres://app:hunter2secret@db.internal:5432/x").text, "DATABASE_URL=postgres://app:[url password redacted …cret]@db.internal:5432/x");
  assert.equal(redact("mysql -h db -u root -pMyS3cretPass").text, "mysql -h db -u root -p[password redacted …Pass]");
  assert.equal(redact("curl -u admin:s3cr3tvalue https://x.test").text, "curl -u admin:[password redacted …alue] https://x.test");
  assert.equal(redact("password: correct-horse-battery").text, "password: [password redacted …tery]");
});

test("names that merely contain a secret word, placeholders and code are left alone", () => {
  for (const text of [
    "cache_key=abcdefghijklmnop", "token_count: 123456789012", "NODE_ENV=production", "const key = process.env.API_KEY", "api_key=${API_KEY_VALUE_HERE}",
    "token=<your-token-here-xxxxxx>", "secret=changeme-changeme-changeme", "keychain=abcdefghijklmnopqrstuvwxyz", "apiKey = config.keys.primary.value", "public_key=ssh-ed25519AAAAC3NzaC1lZDI1NTE5AAAA",
  ]) {
    assert.equal(redact(text).text, text, text);
  }
});

test("redaction is idempotent and never throws", () => {
  const input = SHAPES.map(([, v]) => v).join("\n");
  const once = redact(input);
  assert.deepEqual(redact(once.text), { text: once.text, hits: [] });
  assert.equal(once.hits.length, SHAPES.length);
  for (const odd of [undefined, null, "", 0, 42, {}, [], Symbol.iterator.toString()]) assert.doesNotThrow(() => redact(odd));
  assert.deepEqual(redact(undefined), { text: "", hits: [] });
  assert.deepEqual(scan(`x ${SHAPES[0]?.[1] ?? ""}`), ["anthropic"]);
});

test("the seed helpers find where a Vyre block ends", () => {
  const seed = `${SEED_OPEN} carried over.\n  | quoted\n]\n\nthe person's words`;
  assert.equal(withoutSeed(seed), "the person's words");
  assert.equal(withoutSeed("no seed here"), "no seed here");
  assert.equal(withoutSeed(`${SEED_OPEN} cut off`), "", "a seed with no end has no words of its own");
  assert.equal(withoutVyre(`[Vyre note: away.\n]\n\n${seed}`), "the person's words", "blocks stack");
});
