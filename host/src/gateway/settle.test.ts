// A call that names an object another call is still registering waits for that commit, and for nothing else: not for a clock, and not for an object nobody is making.
import test from "node:test";
import assert from "node:assert/strict";
import { settleRegistration } from "./settle.ts";
import type { Settle } from "./settle.ts";

const rig = (o: Partial<Settle> & { commits?: Array<Promise<unknown>> } = {}) => {
  let known = false;
  const waits: string[] = [];
  const s: Settle = {
    known: () => known,
    rowExists: () => true,
    inFlight: () => o.commits ?? [],
    writing: () => false,
    yieldOnce: async () => {
      waits.push("yield");
    },
    ...o,
  };
  return { s, waits, learn: () => (known = true) };
};

test("a thread whose row is there and whose commit is in flight is waited for, then known", async () => {
  let finish!: () => void;
  const rg = rig();
  const commit = new Promise<void>((r) => {
    finish = () => {
      rg.learn();
      r();
    };
  });
  const r2 = rig({ commits: [commit], known: () => rg.s.known() });
  const pending = settleRegistration(r2.s);
  let done = false;
  void pending.then(() => (done = true));
  await new Promise((r) => setImmediate(r));
  assert.equal(done, false, "it has not answered while the commit is still being written");
  finish();
  assert.equal(await pending, true, "known the moment that commit is");
});

test("an object that is known is answered at once; one with no row, or nothing in progress, is not waited for", async () => {
  const known = rig();
  known.learn();
  assert.equal(await settleRegistration(known.s), true);
  assert.equal(
    await settleRegistration(rig({ rowExists: () => false, commits: [new Promise(() => undefined)] }).s),
    false,
  );
  assert.equal(
    await settleRegistration(rig().s),
    false,
    "a row nobody is registering stays unknown, with no wait at all",
  );
});

test("a handler that is still writing is given the turn it needs to start its commit, and is then waited for", async () => {
  const rg = rig();
  let writing = true;
  const commits: Array<Promise<unknown>> = [];
  const s: Settle = {
    ...rg.s,
    writing: () => writing,
    inFlight: () => commits,
    yieldOnce: async () => {
      writing = false;
      commits.push(
        new Promise<void>((r) => {
          setImmediate(() => {
            rg.learn();
            r();
          });
        }),
      );
    },
    known: () => rg.s.known(),
  };
  assert.equal(await settleRegistration(s), true);
});

test("a commit that fails does not hold the call: it is asked again and answered as unknown if still unknown", async () => {
  const rg = rig({ commits: [Promise.reject(new Error("write failed"))] });
  assert.equal(await settleRegistration(rg.s, 2), false);
});

test("it is bounded: work that keeps arriving cannot hold a call for ever", async () => {
  let n = 0;
  const rg = rig({ inFlight: () => [Promise.resolve(++n)] });
  assert.equal(await settleRegistration(rg.s, 5), false);
  assert.equal(n, 5);
});
