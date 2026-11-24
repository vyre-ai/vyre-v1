// Which values the server keeps as plain: the same table as the page's (apps/app/src/places/apps/shell/site/model.test.ts, SECRET_CASES), so the page and the server agree.
import assert from "node:assert/strict";
import { test } from "node:test";
import { entropy, looksSecret } from "../handlers/secrets.ts";

// Fake keys are built at run time from pieces, so no literal here looks like a real secret to the scanner.
const j = (...p: string[]): string => p.join("");
const FAKE_SK = j("sk", "_live_", "51Habcdefghijkl");
const FAKE_GH = j("gh", "p_", "abcdefghijklmnopqrstuvwxyz0123456789");
const FAKE_AWS = j("AK", "IA", "IOSFODNN7EXAMPLE");
const FAKE_JWT = j("ey", "JhbGciOiJIUzI1NiJ9.", "eyJzdWIiOiIxIn0.", "abc123");
const PEM_BEGIN = j("-----", "BEGIN PRIVATE", " KEY-----");

const CASES: readonly (readonly [string, string, boolean])[] = [
  ["API_KEY", "x", true],
  ["APIKEY", "x", true],
  ["STRIPE_SK", "x", true],
  ["SESSION_SECRET", "x", true],
  ["GITHUB_TOKEN", "x", true],
  ["DB_PASSWORD", "x", true],
  ["SENDGRID", "anything", true],
  ["JWT", "x", true],
  ["SLACK_URL", "https://hooks.slack.com/services/T000/B000/XXXX", true],
  ["DATABASE_URL", "postgres://app:pw@db:5432/app", true],
  ["DATABASE_URL", "postgres://db:5432/app?password=hunter22", true],
  ["ANY", FAKE_SK, true],
  ["ANY", FAKE_GH, true],
  ["ANY", FAKE_AWS, true],
  ["ANY", FAKE_JWT, true],
  ["CERT", PEM_BEGIN, true],
  ["BLOB", "q8Zr2LmN7xYp4VtC9sHd3GjK6wFa5BeU", true],
  ["NEXT_PUBLIC_API_URL", "https://api.example.com", false],
  ["NEXT_PUBLIC_KEY", "pk_live_abc", false],
  ["NEXT_PUBLIC_X", FAKE_SK, true],
  ["APP_MODE", "calm", false],
  ["NODE_ENV", "production", false],
  ["PUBLIC_URL", "https://a.example", false],
  ["FEATURE_AUTH", "true", false],
  ["PASS_RATE", "0.95", false],
  ["REGION", "us-east-1", false],
  ["LOG_LEVEL", "info", false],
  ["GREETING", "hello there friend", false],
];

test("what looks like a secret, by its name or by its value", () => {
  for (const [name, value, want] of CASES) assert.equal(looksSecret(name, value), want, `${name}=${value}`);
});

test("entropy: random keys are high, words and repeats are low", () => {
  assert.ok(entropy("q8Zr2LmN7xYp4VtC9sHd3GjK6wFa5BeU") > 3.9);
  assert.ok(entropy("aaaaaaaaaaaaaaaaaaaaaaaaaaaa") < 1);
  assert.ok(entropy("the quick brown fox jumps") < 4.2);
  assert.equal(entropy(""), 0);
});
