// Services beyond static: every transition of a service, the crash-loop backoff, readiness, and recovery after a restart (r42-sites-run, slice 5).
import test from "node:test";
import assert from "node:assert/strict";
import { BACKOFF_BASE_MS, BACKOFF_MAX_MS, LOOP_MAX, LOOP_WINDOW_MS, READY_AFTER_MS, STABLE_MS, advance, backoffMs, fresh, ready, reconcile } from "../ops/workers.ts";
import type { Service, ServiceEvent, ServiceState } from "../ops/workers.ts";

const svc = (state: ServiceState, o: Partial<Service> = {}): Service => ({ ...fresh("v1", "s1", "queue", "worker"), state, ...o });
const T = 1_000_000;

// state x event: the expected state and action
type Want = [ServiceState, string];
const TABLE: Record<ServiceState, Record<string, Want>> = {
  stopped: { want: ["starting", "start"], spawned: ["stopped", "none"], exited: ["stopped", "none"], tick: ["stopped", "none"], stop: ["stopped", "none"], restart: ["starting", "start"] },
  starting: { want: ["starting", "none"], spawned: ["starting", "none"], exited: ["backoff", "none"], tick: ["starting", "none"], stop: ["stopped", "kill"], restart: ["starting", "restart"] },
  running: { want: ["running", "none"], spawned: ["running", "none"], exited: ["backoff", "none"], tick: ["running", "none"], stop: ["stopped", "kill"], restart: ["starting", "restart"] },
  backoff: { want: ["backoff", "none"], spawned: ["backoff", "none"], exited: ["backoff", "none"], tick: ["backoff", "none"], stop: ["stopped", "none"], restart: ["starting", "start"] },
  failed: { want: ["failed", "none"], spawned: ["failed", "none"], exited: ["failed", "none"], tick: ["failed", "none"], stop: ["stopped", "none"], restart: ["starting", "start"] },
};
const EV = (e: string): ServiceEvent =>
  e === "exited" ? { t: "exited", at: T, code: 1 } : ({ t: e, at: T } as ServiceEvent);

for (const [from, row] of Object.entries(TABLE) as [ServiceState, Record<string, Want>][])
  for (const [e, [to, act]] of Object.entries(row))
    test(`service ${from} + ${e} gives ${to} and ${act}`, () => {
      const s = svc(from, { startedAt: T - 1, restartAt: T + 5000 });
      const out = advance(s, EV(e));
      assert.equal(out.service.state, to);
      assert.equal(out.act, act);
    });

test("a container that stays up becomes ready after the ready time, and a worker needs no port", () => {
  let s = advance(fresh("v1", "s1", "queue", "worker"), { t: "want", at: T }).service;
  s = advance(s, { t: "spawned", at: T }).service;
  assert.equal(ready(s, false), false);
  assert.equal(advance(s, { t: "tick", at: T + READY_AFTER_MS - 1 }).service.state, "starting");
  s = advance(s, { t: "tick", at: T + READY_AFTER_MS }).service;
  assert.equal(s.state, "running");
  assert.equal(ready(s, false), true); // a worker
  assert.equal(ready({ ...s, kind: "web" }, false), false); // a web process must also answer
  assert.equal(ready({ ...s, kind: "web" }, true), true);
});

test("backoff doubles from two seconds and stops growing at five minutes", () => {
  assert.equal(backoffMs(1), BACKOFF_BASE_MS);
  assert.equal(backoffMs(2), BACKOFF_BASE_MS * 2);
  assert.equal(backoffMs(3), BACKOFF_BASE_MS * 4);
  assert.equal(backoffMs(30), BACKOFF_MAX_MS);
  assert.equal(backoffMs(0), BACKOFF_BASE_MS);
});

test("a crash loop: each crash waits longer, then the eighth in ten minutes stops it for good", () => {
  let s = advance(fresh("v1", "s1", "queue", "worker"), { t: "want", at: T }).service;
  let now = T;
  const waits: number[] = [];
  for (let i = 1; i < LOOP_MAX; i++) {
    s = advance(s, { t: "spawned", at: now }).service;
    s = advance(s, { t: "exited", at: now + 1000, code: 1 }).service; // it dies after a second, every time
    assert.equal(s.state, "backoff");
    const due = s.restartAt as number;
    waits.push(due - (now + 1000));
    // a tick before the time starts nothing; at the time it starts
    assert.equal(advance(s, { t: "tick", at: due - 1 }).act, "none");
    const go = advance(s, { t: "tick", at: due });
    assert.equal(go.act, "start");
    s = go.service;
    now = due;
  }
  assert.deepEqual(waits.slice(0, 4), [2000, 4000, 8000, 16000]);
  s = advance(s, { t: "spawned", at: now }).service;
  const last = advance(s, { t: "exited", at: now + 500, code: 1 });
  assert.equal(last.service.state, "failed");
  assert.equal(last.act, "none");
  assert.match(last.service.note ?? "", /not restarting by itself/);
  // nothing restarts a failed service but a person
  assert.equal(advance(last.service, { t: "tick", at: now + 10 * 60 * 60_000 }).service.state, "failed");
  const back = advance(last.service, { t: "restart", at: now + 1 });
  assert.equal(back.service.state, "starting");
  assert.equal(back.service.streak, 0);
  assert.deepEqual(back.service.crashes, []);
});

test("crashes spread over more than the window never make a loop", () => {
  let s = advance(fresh("v1", "s1", "queue", "worker"), { t: "want", at: T }).service;
  let now = T;
  for (let i = 0; i < LOOP_MAX * 2; i++) {
    s = advance(s, { t: "spawned", at: now }).service;
    now += LOOP_WINDOW_MS; // one crash per window
    s = advance(s, { t: "exited", at: now, code: 1 }).service;
    assert.equal(s.state, "backoff");
    s = advance(s, { t: "tick", at: s.restartAt as number }).service;
  }
});

test("a container that stayed up a minute starts the count again", () => {
  let s = advance(fresh("v1", "s1", "queue", "worker"), { t: "want", at: T }).service;
  s = { ...s, streak: 5 };
  s = advance(s, { t: "spawned", at: T }).service;
  s = advance(s, { t: "tick", at: T + READY_AFTER_MS }).service;
  s = advance(s, { t: "tick", at: T + STABLE_MS }).service;
  assert.equal(s.streak, 0);
  // and a crash after a long run is the first of a new streak, with the short wait
  const out = advance({ ...s, streak: 5, startedAt: T }, { t: "exited", at: T + STABLE_MS + 1, code: 1 });
  assert.equal(out.service.streak, 1);
  assert.equal((out.service.restartAt as number) - (T + STABLE_MS + 1), BACKOFF_BASE_MS);
});

test("the note says what happened in plain words, and out of memory is named", () => {
  const s = advance(svc("running", { startedAt: T }), { t: "exited", at: T + 5, code: 137, oom: true }).service;
  assert.match(s.note ?? "", /ran out of memory/);
  assert.equal(s.lastExit?.oom, true);
  const done = advance(svc("running", { startedAt: T }), { t: "exited", at: T + 5, code: 0 }).service;
  assert.match(done.note ?? "", /finished and exited/);
});

test("stopping a service ignores the exit it causes", () => {
  const stopped = advance(svc("running", { startedAt: T }), { t: "stop", at: T + 1 });
  assert.equal(stopped.act, "kill");
  const late = advance(stopped.service, { t: "exited", at: T + 2, code: 137 });
  assert.equal(late.service.state, "stopped");
  assert.deepEqual(late.service.crashes, []);
});

test("restart mid-run: after the server restarts, a service with no container crashes into backoff, a stopped one with a container is stopped", () => {
  const a = svc("running", { id: "a" });
  const b = svc("starting", { id: "b" });
  const c = svc("stopped", { id: "c" });
  const d = svc("running", { id: "d" });
  const out = reconcile([a, b, c, d], new Set(["c", "d"]), T);
  assert.deepEqual(out, [
    { id: "a", ev: { t: "exited", at: T, code: 255 } },
    { id: "b", ev: { t: "exited", at: T, code: 255 } },
    { id: "c", ev: { t: "stop", at: T } },
  ]);
});
