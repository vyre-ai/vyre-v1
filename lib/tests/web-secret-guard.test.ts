// What chrome_search's query and chrome_read's address are checked with: the shared credential scanner (lib/secret-scrub.ts). The shapes of real secrets are found, ordinary questions and addresses are not,
// and a megabyte of near-misses costs time in proportion to its length.
import test from "node:test";
import assert from "node:assert/strict";
import { scan } from "../secret-scrub.ts";

test("the shapes of real secrets are found, and ordinary questions and addresses are not", () => {
  const secrets = [
    "why does sk-live-abcdef0123456789abcd fail",
    "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "xoxb-1234567890-abcdefghij",
    "AKIAABCDEFGHIJKLMNOP in the config",
    "Authorization: Bearer abcdefghijklmnop1234567890",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    "-----BEGIN RSA PRIVATE KEY-----",
  ];
  for (const text of secrets) assert.ok(scan(text).length > 0, text);
  for (const ok of [
    "how to authenticate API calls",
    "oauth2 client credentials flow",
    "https://docs.example.com/guide/a-long-readable-slug-for-a-page-about-tokens-and-auth?page=2",
  ])
    assert.deepEqual(scan(ok), [], ok);
});

test("a megabyte of near-misses is scanned in time in proportion to its length (the callers cut text to 4,000 characters first)", () => {
  const t0 = performance.now();
  for (const body of ["sk-".repeat(1500), "a".repeat(4000), "eyJ".repeat(1300), "-----BEGIN ".repeat(360)]) scan(body);
  assert.ok(performance.now() - t0 < 500, `${Math.round(performance.now() - t0)} ms`);
});
