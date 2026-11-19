// Sign Out revokes the token even when the session has not opened yet, and a revoke that did not get its answer is sent again at the next start.
import test from "node:test";
import assert from "node:assert/strict";
import { CapError } from "./caps.ts";
import type { CapCall } from "./caps.ts";
import { retryPendingRevokes, revokeToken } from "./revoke-token.ts";

const mem = () => {
  const d = new Map<string, string>();
  return { d, getItem: (k: string) => d.get(k) ?? null, setItem: (k: string, v: string) => void d.set(k, v) };
};
const S = { baseUrl: "https://northwind.example", token: "tok_1" };
const refused = (status: number): CapCall =>
  (async () => {
    throw new CapError({ code: "auth.refused", message: "refused", traceId: "t", status });
  }) as unknown as CapCall;
const ok = (seen: unknown[]): CapCall =>
  (async (cap: string, input: unknown) => {
    seen.push([cap, input]);
    return {};
  }) as unknown as CapCall;

test("sends identity.sign_out with the stored token and strikes it out when the Space answered", async () => {
  const ls = mem();
  const seen: unknown[] = [];
  const made: { baseUrl: string; token: string }[] = [];
  await revokeToken(S, {
    ls,
    make: (s) => (made.push(s), ok(seen)),
  });
  assert.deepEqual(made, [S]);
  assert.deepEqual(seen, [["identity.sign_out", {}]]);
  assert.equal(JSON.parse(ls.d.get("vyre.signout.pending.v1") ?? "[]").length, 0, "nothing left to send");
});

test("it is written down before it is sent: a page left in the middle leaves it queued", async () => {
  const ls = mem();
  let queuedWhileSending = 0;
  await revokeToken(S, {
    ls,
    make: () =>
      (async () => {
        queuedWhileSending = JSON.parse(ls.d.get("vyre.signout.pending.v1") ?? "[]").length;
        return {};
      }) as unknown as CapCall,
  });
  assert.equal(queuedWhileSending, 1);
});

test("the desktop app: an origin the Space refuses (403) or a Space that cannot be reached leaves the revoke queued, and the next start sends it", async () => {
  for (const failing of [
    refused(403),
    (async () => Promise.reject(new TypeError("Failed to fetch"))) as unknown as CapCall,
  ]) {
    const ls = mem();
    await revokeToken(S, { ls, make: () => failing });
    assert.equal(JSON.parse(ls.d.get("vyre.signout.pending.v1") ?? "[]").length, 1, "still queued");
    await retryPendingRevokes({ ls, make: () => failing });
    assert.equal(JSON.parse(ls.d.get("vyre.signout.pending.v1") ?? "[]").length, 1, "still refused: still queued");
    const seen: unknown[] = [];
    await retryPendingRevokes({ ls, make: () => ok(seen) });
    assert.deepEqual(seen, [["identity.sign_out", {}]]);
    assert.equal(JSON.parse(ls.d.get("vyre.signout.pending.v1") ?? "[]").length, 0, "sent at the next start");
  }
});

test("a token the Space says is already invalid (401) is struck out; a queued revoke older than a week is dropped", async () => {
  const ls = mem();
  await revokeToken(S, { ls, make: () => refused(401) });
  assert.equal(JSON.parse(ls.d.get("vyre.signout.pending.v1") ?? "[]").length, 0);
  ls.d.set("vyre.signout.pending.v1", JSON.stringify([{ ...S, at: 1 }]));
  const seen: unknown[] = [];
  await retryPendingRevokes({ ls, make: () => ok(seen), now: () => 30 * 24 * 3_600_000 });
  assert.deepEqual(seen, [], "too old: not sent, not kept");
});
