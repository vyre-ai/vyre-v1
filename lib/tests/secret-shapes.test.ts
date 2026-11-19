import test from "node:test";
import assert from "node:assert/strict";
import { secretShape } from "../secret-shapes.ts";

test("the shapes of real secrets are named, and ordinary questions and addresses are not", () => {
  const secrets: [string, string][] = [
    ["why does sk-live-abcdef0123456789abcd fail", "an API key (sk- or pk-)"],
    ["ghp_abcdefghijklmnopqrstuvwxyz0123456789", "a GitHub token"],
    ["xoxb-1234567890-abcdefghij", "a Slack token"],
    ["AKIAABCDEFGHIJKLMNOP in the config", "an AWS key"],
    ["Authorization: Bearer abcdefghijklmnop1234", "a bearer token"],
    [
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      "a JSON web token",
    ],
    ["-----BEGIN RSA PRIVATE KEY-----", "a private key"],
    ["d41d8cd98f00b204e9800998ecf8427e", "a long hex value"],
  ];
  for (const [text, kind] of secrets) assert.equal(secretShape(text), kind, text);
  for (const ok of [
    "how to authenticate API calls",
    "oauth2 client credentials flow",
    "https://docs.example.com/guide/a-long-readable-slug-for-a-page-about-tokens-and-auth?page=2",
  ])
    assert.equal(secretShape(ok), null, ok);
  assert.equal(
    secretShape("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN0123", { free: true }),
    "a long token",
    "a long run in a typed question",
  );
  assert.equal(secretShape("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN0123"), null, "not in an address");
});

test("a megabyte of near-misses costs time in proportion to its length", () => {
  const t0 = performance.now();
  for (const body of [
    "sk-".repeat(500_000),
    "a".repeat(1_000_000),
    "eyJ".repeat(333_000),
    "-----BEGIN ".repeat(90_000),
  ])
    secretShape(body, { free: true });
  assert.ok(performance.now() - t0 < 500, `${Math.round(performance.now() - t0)} ms`);
});
