// lib/hooks.ts redact: the one redactor for text that may be kept or shown. The shapes an exception text can carry (a link with a login, a secret in a query string, a JWT) are cut out too.
import test from "node:test";
import assert from "node:assert/strict";
import { redact } from "./hooks.ts";

test("a login in a link, a secret in a query string, a JWT, a webhook secret, an AWS key id and an Authorization header are cut out", () => {
  const cases: Array<[string, string]> = [
    ["connect ECONNREFUSED postgres://app:pa55word@db.internal:5432/vyre", "connect ECONNREFUSED postgres://[hidden]@db.internal:5432/vyre"],
    ["fetch failed https://api.example.com/v1/x?key=abc123def&page=2", "fetch failed https://api.example.com/v1/x?key=[hidden]&page=2"],
    ["GET /cb?code=1&access_token=zzzzzzzz9 failed", "GET /cb?code=1&access_token=[hidden] failed"],
    ["bad token eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.c2lnbmF0dXJl here", "bad token [hidden] here"],
    ["event whsec_MfKQ9r8GKYqrTwjZ failed", "event [hidden] failed"],
    ["role AKIAABCDEFGHIJKLMNOP denied", "role [hidden] denied"],
    ["Authorization: Token plainvalue123 rejected", "Authorization: [hidden] rejected"],
  ];
  for (const [from, to] of cases) assert.equal(redact(from, 1000), to);
  assert.equal(redact("nothing secret in page 2 of /files/report.pdf", 1000), "nothing secret in page 2 of /files/report.pdf");
});
