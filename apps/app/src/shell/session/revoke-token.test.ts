// Sign Out revokes the token even when the session has not opened yet, and a revoke that did not get its answer is sent again at the next start. The queue holds a live token, so it is sealed.
import test from "node:test";
import assert from "node:assert/strict";
import { CapError } from "./caps.ts";
import type { CapCall } from "./caps.ts";
import { REVOKE_MAX_AGE_MS, createRevokeQueue } from "./revoke-queue.ts";
import type { Backing } from "./revoke-queue.ts";
import { retryPendingRevokes, revokeToken } from "./revoke-token.ts";

/** A store the way the browser's is: the key is made non-extractable and the sealed list is kept as it was handed over. */
function backing(): Backing & { held: { iv: Uint8Array; ct: ArrayBuffer } | null; keyMade: CryptoKey | null } {
  const b = {
    held: null as { iv: Uint8Array; ct: ArrayBuffer } | null,
    keyMade: null as CryptoKey | null,
    async key() {
      return (b.keyMade ??= await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
        "encrypt",
        "decrypt",
      ]));
    },
    async get() {
      return b.held;
    },
    async set(v: { iv: Uint8Array; ct: ArrayBuffer } | null) {
      b.held = v;
    },
  };
  return b;
}
const S = { baseUrl: "https://northwind.example", token: "tok_secret_value_1" };
const refused = (status: number): CapCall =>
  (async () => {
    throw new CapError({ code: "auth.refused", message: "refused", traceId: "t", status });
  }) as unknown as CapCall;
const ok = (seen: unknown[]): CapCall =>
  (async (cap: string, input: unknown) => {
    seen.push([cap, input]);
    return {};
  }) as unknown as CapCall;
const unreachable = (async () => Promise.reject(new TypeError("Failed to fetch"))) as unknown as CapCall;
const text = (b: { iv: Uint8Array; ct: ArrayBuffer }): string =>
  new TextDecoder("latin1").decode(b.ct) +
  new TextDecoder("latin1").decode(b.iv) +
  JSON.stringify([...new Uint8Array(b.ct)]);

test("sends identity.sign_out with the stored token and strikes it out when the Space answered", async () => {
  const bk = backing();
  const queue = createRevokeQueue(bk);
  const seen: unknown[] = [];
  const made: { baseUrl: string; token: string }[] = [];
  await revokeToken(S, { queue, make: (s) => (made.push(s), ok(seen)) });
  assert.deepEqual(made, [S]);
  assert.deepEqual(seen, [["identity.sign_out", {}]]);
  assert.deepEqual(await queue.list(), [], "nothing left to send");
  assert.equal(bk.held, null, "and nothing left stored");
});

test("it is written down as it is sent: a page left in the middle leaves it queued", async () => {
  const queue = createRevokeQueue(backing());
  let queuedWhileSending = -1;
  await revokeToken(S, {
    queue,
    make: () =>
      (async () => {
        queuedWhileSending = (await queue.list()).length;
        return {};
      }) as unknown as CapCall,
  });
  assert.equal(queuedWhileSending, 1);
});

test("the queue holds a live token, so what is stored is sealed: the token is not in it as text, the key cannot be exported", async () => {
  const bk = backing();
  const queue = createRevokeQueue(bk);
  await revokeToken(S, { queue, make: () => unreachable });
  assert.ok(bk.held, "queued");
  assert.ok(!text(bk.held!).includes("tok_secret"), "not readable as text");
  assert.ok(!text(bk.held!).includes("northwind"), "the address is sealed too");
  assert.equal(bk.keyMade!.extractable, false);
  assert.equal((await queue.list())[0]!.token, S.token, "it opens under the key");
  // another key opens nothing
  const other = createRevokeQueue({ ...backing(), get: async () => bk.held });
  assert.deepEqual(await other.list(), []);
});

test("the desktop app: an origin the Space refuses (403) or a Space that cannot be reached leaves the revoke queued, and the next start sends it", async () => {
  for (const failing of [refused(403), unreachable]) {
    const queue = createRevokeQueue(backing());
    await revokeToken(S, { queue, make: () => failing });
    assert.equal((await queue.list()).length, 1, "still queued");
    await retryPendingRevokes({ queue, make: () => failing });
    assert.equal((await queue.list()).length, 1, "still refused: still queued");
    const seen: unknown[] = [];
    await retryPendingRevokes({ queue, make: () => ok(seen) });
    assert.deepEqual(seen, [["identity.sign_out", {}]]);
    assert.equal((await queue.list()).length, 0, "sent at the next start, and gone");
  }
});

test("a token the Space says is already invalid (401) is struck out at once; an entry older than a day is dropped unsent", async () => {
  const queue = createRevokeQueue(backing());
  await revokeToken(S, { queue, make: () => refused(401) });
  assert.equal((await queue.list()).length, 0);
  let t = 1_000;
  const old = createRevokeQueue(backing(), () => t);
  await old.add({ ...S, at: t });
  t += REVOKE_MAX_AGE_MS + 1;
  const seen: unknown[] = [];
  await retryPendingRevokes({ queue: old, make: () => ok(seen) });
  assert.deepEqual(seen, [], "too old: not sent, not kept");
});

test("a browser with no store keeps nothing and Sign Out still sends the revoke once", async () => {
  const queue = createRevokeQueue(null);
  const seen: unknown[] = [];
  await revokeToken(S, { queue, make: () => ok(seen) });
  assert.equal(seen.length, 1);
  assert.deepEqual(await queue.list(), []);
});
