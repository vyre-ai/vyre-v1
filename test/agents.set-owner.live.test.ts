// Handing an agent over moves every record of who owns it (lead 12 Nov). Before: agents.set_owner changed the agents table, but the access engine still named the previous owner as the agent's
// person, so a turn's fallback (task-baton askerOf reads the access principal) acted for someone who gave the agent away. On a booted daemon with the real agents, access and engine modules:
// the access engine names the new owner, the previous owner can no longer change the agent and the new owner can, the previous owner's Routines and Watchers on it pause, and an Assistant
// never changes hands.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, seededDir } from "./memory-live-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const PEOPLE = ["usr_olivia", "usr_adam", "usr_mia", "usr_noah", "usr_sana", "usr_tess"];
let n = 0;
async function as(d: Daemon, who: string, cap: string, input: Record<string, unknown>): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify({ idempotencyKey: `so-${++n}`, ...input }) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}
async function ok(d: Daemon, who: string, cap: string, input: Record<string, unknown>): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await as(d, who, cap, input);
  assert.equal(r.status, 200, `${who} ${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
}

test("set_owner: the access engine names the new owner, the previous owner loses the owner's rights and the new owner has them, the previous owner's Routines pause, an Assistant stays", async () => {
  const d = await boot(seededDir(), undefined, undefined, {
    session: (h: Record<string, string | undefined>) => { const id = String(h["authorization"] ?? "").replace(/^Bearer /, ""); return PEOPLE.includes(id) ? { space: "spc_core", principal: { kind: "person", id }, device: "mac" } : null; },
  } as never);
  try {
    // Noah (a member) makes an agent and sets a Routine and a Watcher on it
    const agentId = String((await ok(d, "usr_noah", "agents.create", { name: "Noah Helper", role: "You help Noah." })).agent.agentId);
    const routine = String((await ok(d, "usr_noah", "agents.routine.save", { agentId, title: "Morning", cron: "0 9 * * 1-5", prompt: "Sum up the day.", enabled: true })).routine.routineId);
    // handing it on is the owner's act (Can manage): Sana, another member, may not, yet
    assert.notEqual((await as(d, "usr_sana", "agents.set_owner", { agentId, ownerId: "usr_mia" })).status, 200, "Sana may not hand it on, yet");

    // Noah hands it to Sana
    await ok(d, "usr_noah", "agents.set_owner", { agentId, ownerId: "usr_sana" });

    const principal = (await ok(d, "usr_olivia", "access.principals.get", { principal: { kind: "agent", id: agentId } })).principal as { owner?: string };
    assert.equal(principal.owner, "usr_sana", "the access engine names the new owner (what a turn's fallback reads)");
    assert.equal(((await ok(d, "usr_olivia", "agents.get", { agentId })).agent as { ownerId: string }).ownerId, "usr_sana");
    const noah = await as(d, "usr_noah", "agents.set_owner", { agentId, ownerId: "usr_noah" });
    assert.notEqual(noah.status, 200, `the previous owner keeps no owner's rights: he cannot take it back: ${JSON.stringify(noah.data)}`);
    assert.notEqual((await as(d, "usr_noah", "agents.set_owner", { agentId, ownerId: "usr_mia" })).status, 200, "nor hand it on");

    // the Routine Noah set ran as Noah: it is off now, and nothing of it runs as Sana
    const row = d.db!.all(`SELECT "enabled", "ownerId" FROM agents_routine WHERE "id" = ?`, routine)[0] as { enabled: number; ownerId: string };
    assert.deepEqual({ ...row }, { enabled: 0, ownerId: "usr_noah" }, "the previous owner's Routine pauses and stays his");

    // the new owner has them: Sana hands it on, and the access engine follows again
    await ok(d, "usr_sana", "agents.set_owner", { agentId, ownerId: "usr_mia" });
    assert.equal(((await ok(d, "usr_olivia", "access.principals.get", { principal: { kind: "agent", id: agentId } })).principal as { owner?: string }).owner, "usr_mia");

    // an Assistant never changes hands
    const asst = String((await ok(d, "usr_mia", "agents.create", { name: "Mia Assistant", role: "You help Mia." })).agent.agentId);
    { const { DatabaseSync } = await import("node:sqlite"); const mdb = new DatabaseSync(d.paths.modules); mdb.prepare(`UPDATE agents_agent SET "kind" = 'assistant' WHERE "id" = ?`).run(asst); mdb.close(); }
    const kept = await as(d, "usr_mia", "agents.set_owner", { agentId: asst, ownerId: "usr_sana" });
    assert.equal(kept.status, 422, JSON.stringify(kept.data));
    assert.match(JSON.stringify(kept.data), /An Assistant stays with its person/);
  } finally { await d.stop(); }
});
