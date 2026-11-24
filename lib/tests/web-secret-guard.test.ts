// What chrome_search's query and chrome_read's address are checked with: the shared credential scanner (lib/secret-scrub.ts). The shapes of real secrets are found, ordinary questions and addresses are not,
// and a megabyte of near-misses costs time in proportion to its length.
import test from "node:test";
import assert from "node:assert/strict";
import { redact, scan } from "../secret-scrub.ts";

test("the shapes of real secrets are found, and ordinary questions and addresses are not", () => {
  const secrets = [
    "why does sk-live-abcdef0123456789abcd fail",
    "gh" + "p_abcdefghijklmnopqrstuvwxyz0123456789",
    "xo" + "xb-1234567890-abcdefghij",
    "AK" + "IAABCDEFGHIJKLMNOP in the config",
    "Authorization: Bearer abcdefghijklmnop1234567890",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    "-----BEG" + "IN RSA PRIVATE KEY-----",
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

test("a long bare token typed with no name or prefix is found; a hash, a slug of words, an address and prose are not", () => {
  const tokens = [
    "why does abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN0123 fail",
    "Zm9vYmFyLXNlY3JldC12YWx1ZS0xMjM0NTY3ODkwLWFiY2RlZg",
    "k3J9xQ2mVb7LpRt5YwNc8ZhD1sGfA4uE6oIy0TqPzXe",
  ];
  for (const t of tokens) assert.ok(scan(t, { bare: true }).includes("long-token"), t);
  for (const ok of [
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", // a sha256 digest
    "da39a3ee5e6b4b0d3255bfef95601890afd80709", // a git sha
    "how-to-authenticate-api-calls-with-a-long-readable-title-2026-edition",
    "https://docs.example.com/2026/11/19/how-to-authenticate-api-calls-with-a-long-readable-title",
    "oauth2 client credentials flow for server to server integrations",
  ])
    assert.ok(!scan(ok, { bare: true }).includes("long-token"), ok);
});

test("the long bare token rule is for text typed to be sent outward only: a transcript keeps a long base64 chunk, an opaque id and a long file name exactly as they are", () => {
  const kept = [
    "image data: Zm9vYmFyLXNlY3JldC12YWx1ZS0xMjM0NTY3ODkwLWFiY2RlZg and more",
    "signed id k3J9xQ2mVb7LpRt5YwNc8ZhD1sGfA4uE6oIy0TqPzXe in the URL",
    "file Quarterly_report_FY2026_Q3_final_v2_reviewed_signed_scan001 attached",
  ];
  for (const text of kept) {
    assert.equal(redact(text).text, text, text);
    assert.deepEqual(scan(text), [], "an ordinary scan does not call it a secret");
  }
  assert.ok(scan(kept[1]!, { bare: true }).includes("long-token"), "asked for, the same text is flagged");
});
