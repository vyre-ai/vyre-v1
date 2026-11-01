// A card reads its object on the Space's live tick: never by a timer, never while it has nothing to wait for, and one read at a time however fast the ticks come.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { flush, installDom, mount } from "../../../../../../ui/src/testing/dom.ts";
import { useFollow } from "./use-follow.ts";
import type { Changes } from "./use-follow.ts";
import { KeyRequestCard } from "./keyrequest.tsx";
import { AccessRequestCard } from "./accessrequest.tsx";
import { CrewResultCard } from "./crew-card.tsx";
import { AgentFileProposal, decidedOf } from "./proposal.tsx";

installDom();

function stream() {
  const ears = new Set<() => void>();
  const changes: Changes = { subscribe: (l) => { ears.add(l); return () => { ears.delete(l); }; } };
  return { changes, tick: () => { for (const l of [...ears]) l(); }, listening: () => ears.size };
}
function Probe({ changes, load, active }: { changes: Changes | undefined; load: () => Promise<unknown>; active: boolean }) { useFollow(changes, load, active); return null; }

test("ticks read again; a tick during a read runs one read after it; an idle card does not listen", async () => {
  const s = stream();
  let reads = 0;
  let release: () => void = () => undefined;
  const load = () => { reads += 1; return new Promise<void>((r) => { release = r; }); };
  await mount(createRoot, <Probe changes={s.changes} load={load} active />);
  s.tick(); await flush();
  assert.equal(reads, 1);
  s.tick(); s.tick(); s.tick(); await flush();
  assert.equal(reads, 1, "one read at a time");
  release(); await flush();
  assert.equal(reads, 2, "one more read for everything that came during the first");
  release(); await flush();
  assert.equal(reads, 2);
  const idle = stream();
  await mount(createRoot, <Probe changes={idle.changes} load={load} active={false} />);
  assert.equal(idle.listening(), 0);
  await mount(createRoot, <Probe changes={undefined} load={load} active />);
});

test("a key request decided elsewhere flips on the tick", async () => {
  const s = stream();
  let state = "waiting";
  const data = { changes: s.changes, call: async (cap: string) => (cap === "vault.requests.get" ? { request: { id: "vrq_1", name: "Fathom", fields: ["value"], reason: "To read.", state } } : { requests: [] }) } as never;
  const root = await mount(createRoot, <KeyRequestCard requestId="vrq_1" agent="Ops" agentId="agt_1" data={data} />);
  state = "declined";
  s.tick(); await flush();
  assert.match(JSON.stringify(root.toJSON()), /Declined · Fathom key/);
  assert.equal(s.listening(), 0);
});

test("an access request decided elsewhere flips on the tick", async () => {
  const s = stream();
  let state = "waiting";
  const data = { changes: s.changes, nameOf: () => "Maya", call: async () => ({ requests: [{ id: "arq_1", state }] }) } as never;
  const root = await mount(createRoot, <AccessRequestCard block={{ requestId: "arq_1", requester: "usr_1", resourceTitle: "Rivera", level: "view" }} data={data} />);
  state = "granted";
  s.tick(); await flush();
  assert.match(JSON.stringify(root.toJSON()), /Approved/);
  assert.equal(s.listening(), 0);
});

test("a crew card follows the job, and stops once nothing more can happen to it", async () => {
  const s = stream();
  let job: Record<string, unknown> = { jobId: "job_1", state: "done" };
  const data = { changes: s.changes, nav: { openThread: () => undefined }, call: async () => ({ jobs: [job] }) } as never;
  const block = { id: "blk_1", type: "crew_result", data: { jobId: "job_1", threadId: "thr_2", name: "Ada", title: "the fix", branch: "crew/fix", state: "done" } } as never;
  const root = await mount(createRoot, <CrewResultCard block={block} leadThreadId="thr_1" data={data} />);
  assert.match(JSON.stringify(root.toJSON()), /finished/);
  job = { jobId: "job_1", state: "merged", result: { pushed: true } };
  s.tick(); await flush();
  assert.match(JSON.stringify(root.toJSON()), /Merged/);
  assert.equal(s.listening(), 0);
});

test("a proposal accepted in the diff tab closes on the tick", async () => {
  assert.equal(decidedOf({ changeset: { state: "approved" } }), "accepted");
  assert.equal(decidedOf({ changeset: { state: "discarded" } }), "rejected");
  assert.equal(decidedOf({ changeset: { state: "open" } }), null);
  assert.equal(decidedOf(undefined), null);
  const s = stream();
  let state = "open";
  const host = { invoke: async () => ({ changeset: { state } }), open: () => undefined } as never;
  const block = { id: "blk_1", type: "changeset", v: 1, data: { changesetId: "chs_1", file: "AGENT.md", agent: "Ops", why: "Clearer", hunks: [{ sec: "a", del: "x", add: "y" }] } } as never;
  const root = await mount(createRoot, <AgentFileProposal block={block} host={host} changes={s.changes} />);
  state = "approved";
  s.tick(); await flush();
  assert.match(JSON.stringify(root.toJSON()), /The change to AGENT\.md was accepted\./);
});
