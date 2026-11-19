// Sign Out revokes the token even when the session has not opened yet.
import test from "node:test";
import assert from "node:assert/strict";
import { revokeToken } from "./revoke-token.ts";

test("sends identity.sign_out with the stored token, kept alive past a reload", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const send = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response("{}");
  }) as unknown as typeof fetch;
  await revokeToken({ baseUrl: "https://northwind.example/", token: "tok_1" }, send);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.url, "https://northwind.example/v1/identity/sign_out");
  assert.equal(seen[0]!.init.method, "POST");
  assert.equal((seen[0]!.init.headers as Record<string, string>)["authorization"], "Bearer tok_1");
  assert.equal(seen[0]!.init.keepalive, true);
});

test("an unreachable Space is not an error at Sign Out", async () => {
  const send = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
  await assert.doesNotReject(revokeToken({ baseUrl: "https://x.example", token: "t" }, send));
});
