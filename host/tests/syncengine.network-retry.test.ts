// A page of a pull that fails with a network error is read again, not the whole pass lost (20 Nov 2026: matter_person, a list the app cannot filter by change, is read whole every pass: 533 pages; one dropped
// connection on one page ended the pass with "The app could not be reached" and the next whole read started from page one).
import test from "node:test";
import assert from "node:assert/strict";
import { remoteStore } from "../src/daemon/syncengine.ts";

const net = (code: string) => ({ error: { code, message: "The app could not be reached: The connector request failed." } });
const store = (fail: (n: number) => string | undefined, slept: number[]) => {
  let n = 0;
  const ctx = {
    call: async (_cap: string, _input: unknown) => {
      n++;
      const code = fail(n);
      if (code) throw net(code);
      return { output: { rows: [{ id: "1", data: { name: "a" } }] } };
    },
  };
  const s = remoteStore(ctx as never, { connector: "c", connectionId: "con_1", remote: "things" }, undefined, {
    sleep: async (ms) => void slept.push(ms),
  });
  return { s, calls: () => n };
};

test("a page that fails with a network error twice is read again and the pass goes on", async () => {
  const slept: number[] = [];
  const { s, calls } = store((n) => (n <= 2 ? "provider.network" : undefined), slept);
  const page = await s.page();
  assert.equal(page.rows.length, 1);
  assert.equal(calls(), 3);
  assert.equal(slept.length, 2, "it waited between the tries");
});

test("a service that answers unavailable is waited for the same way", async () => {
  const slept: number[] = [];
  const { s } = store((n) => (n === 1 ? "provider.unavailable" : undefined), slept);
  assert.equal((await s.page()).rows.length, 1);
});

test("a page that keeps failing gives up after a few tries and says why; a refusal of the key is not tried again", async () => {
  const slept: number[] = [];
  const { s, calls } = store(() => "provider.network", slept);
  await assert.rejects(s.page(), (e: any) => e.error?.code === "provider.network");
  assert.ok(calls() <= 6, `tried ${calls()} times`);
  const { s: s2, calls: c2 } = store(() => "provider.auth_failed", []);
  await assert.rejects(s2.page(), (e: any) => e.error?.code === "provider.auth_failed");
  assert.equal(c2(), 1);
});
