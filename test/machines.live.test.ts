// Machines (lane l-machines), on real daemons: a Team Space server and two members' computers (Olivia's, who is the admin, and Noah's), each linked with the member's own session.
//   Reports arrive over the links; history appears; the admin sees Noah's computer by name, online, capacity and Vyre's own work only; Noah sees all of it and no one else's.
//   Drain skips a machine with the reason, and so does the turn limit; both are listed under Recent moves and tell the placement caches (network.machine_changed).
//   A Fix pressed on the Space server runs on the host and its outcome shows on the machine page; Noah's computer runs a Fix when its owner presses it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Report } from "../lib/machines.ts";
import { NOAH, bootDevice, bootSpace, hostLog, makeAgent, replyAfter, send, startChat, waitFor } from "./support/runson.ts";

/** The machines these daemons run on are busy with the test itself: pin their load so the room each has is the same on every run. */
const calm = (r: Report): Report => ({ ...r, load: { ...r.load, cpu: 20, memUsedBytes: Math.round(r.specs.memBytes * 0.4), diskFreeBytes: Math.round(r.specs.diskBytes * 0.6) } });

interface M { serverId: string; name: string; kind: string; online: boolean; private: boolean; mine: boolean; cores?: number; os?: string; load?: unknown; vyre?: unknown; can: string[]; room: { n: number; why: string }; drain: boolean; runs: { turns: number } }
const OLIVIA = "srv_dev_oliviamac", NOAHS = "srv_dev_noahmac";

test("machines: reports, history, the admin's limited view, drain and the turn limit with their reasons, Recent moves, Fix", { timeout: 150_000 }, async () => {
  const s = await bootSpace({ machineReport: calm, commandsMs: 200 });
  const mac = await bootDevice({ reportMs: 500, slowMs: 2500, machineReport: calm });
  const noah = await bootDevice({ reportMs: 500, name: "Noah's Mac", machineReport: calm });
  try {
    const agentId = await makeAgent(s.d, "Placer");
    await mac.link(s);
    await noah.link(s, NOAH, { person: "usr_noah", device: "dev_noah_mac" });
    const list = async (token: string | null): Promise<M[]> => (((await s.as(token, "network.machines", {})).data.machines as M[] | undefined) ?? []);

    // reports over the links
    let seen = "";
    const rows = await waitFor(async () => { const m = await list(null); seen = JSON.stringify(m.map((x) => x.serverId)) + JSON.stringify(((await s.as(null, "network.servers", {})).data.servers as Array<{ serverId: string; role: string; state: string; owner?: string }>).map((x) => [x.serverId, x.role, x.state, x.owner])); return [OLIVIA, NOAHS, "srv_local"].every((id) => m.some((x) => x.serverId === id)) ? m : null; }, 30_000, () => seen);
    const olivia = rows.find((x) => x.serverId === OLIVIA)!;
    assert.equal(olivia.name, "Olivia's Mac");
    assert.ok(olivia.can.includes("claude_code") && olivia.os && olivia.load, "her own computer, in full");
    assert.equal(rows.find((x) => x.serverId === "srv_local")!.kind, "space");

    // history appears
    const page = await waitFor(async () => {
      const r = await s.as(null, "network.machine", { serverId: OLIVIA, range: "1h" });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      const g = r.data as { series: { points: Array<{ cpu: number | null; disk: number | null }> } };
      return g.series.points.some((p) => p.cpu !== null && p.disk !== null) ? g : null;
    }, 20_000);
    assert.equal(page.series.points.length, 60);

    // the admin's view of Noah's computer
    const theirs = (await list(null)).find((x) => x.serverId === NOAHS)!;
    assert.equal(theirs.private, true);
    assert.equal(theirs.name, "Noah's Mac");
    assert.equal(theirs.online, true);
    assert.ok((theirs.cores ?? 0) >= 1, "its capacity");
    assert.equal(theirs.load, undefined, "not his machine's load");
    assert.ok(theirs.vyre, "Vyre's own share");
    const pg = (await s.as(null, "network.machine", { serverId: NOAHS, range: "1h" })).data as { privacy: string; points?: unknown; series: { points: Array<{ disk: number | null; netIn: number | null }> } };
    assert.equal(pg.privacy, "vyre_only");
    assert.ok(pg.series.points.every((p) => p.disk === null && p.netIn === null));
    const noahsOwn = await list(NOAH);
    assert.deepEqual(noahsOwn.map((x) => x.serverId), [NOAHS], "a member sees only their own");
    assert.ok(noahsOwn[0]!.load && !noahsOwn[0]!.private);
    assert.notEqual((await s.as(NOAH, "network.machine", { serverId: OLIVIA })).status, 200);
    assert.notEqual((await s.as(NOAH, "network.machine_set", { serverId: OLIVIA, drain: true })).status, 200);
    assert.notEqual((await s.as(null, "network.machine_set", { serverId: NOAHS, nickname: "Mine" })).status, 200, "an admin does not rename a member's computer");

    // drain: the next turn goes elsewhere, and the line says why
    const threadId = await startChat(s, agentId, "mc-drain");
    assert.equal((await s.as(null, "engine.placement.decide", { threadId, agentId, kind: "message" })).data.placement, "device");
    assert.equal((await s.as(null, "network.machine_set", { serverId: OLIVIA, drain: true })).status, 200);
    const drained = (await s.as(null, "engine.placement.decide", { threadId, agentId, kind: "message" })).data;
    assert.equal(drained.reason, "space", JSON.stringify(drained));
    assert.match(`Moved from ${drained.moved.from} because ${drained.moved.why}`, /^Moved from Olivia's Mac because it is draining/);
    assert.equal(await replyAfter(s, threadId, await send(s, threadId, agentId, "whereami", "mc-1")), "ran-on=space handover=no", hostLog(s.d));
    assert.equal((await s.as(null, "network.machine_set", { serverId: OLIVIA, drain: false })).status, 200);

    // the turn limit: while her one turn runs, the next chat's turn goes to the Space
    assert.equal((await s.as(null, "network.machine_set", { serverId: OLIVIA, maxTurns: 1 })).status, 200);
    const chatA = await startChat(s, agentId, "mc-a"), chatB = await startChat(s, agentId, "mc-b");
    const beforeA = await send(s, chatA, agentId, "whereami", "mc-slow");
    await waitFor(async () => ((await list(null)).find((x) => x.serverId === OLIVIA)!.runs.turns >= 1 ? true : null), 15_000, () => hostLog(s.d));
    const busy = (await s.as(null, "engine.placement.decide", { threadId: chatB, agentId, kind: "message" })).data;
    assert.equal(busy.reason, "space", JSON.stringify(busy));
    assert.match(busy.moved.why, /1 of 1/);
    assert.equal(await replyAfter(s, chatB, await send(s, chatB, agentId, "whereami", "mc-b1")), "ran-on=space handover=no");
    assert.equal(await replyAfter(s, chatA, beforeA), "ran-on=device handover=no");

    // Recent moves, Space-wide
    let mv = "";
    const moves = await waitFor(async () => { const m = (await s.as(null, "network.machine_moves", {})).data.moves as Array<{ from: string; to: string; why: string }>; mv = JSON.stringify(m); return m.length >= 2 ? m : null; }, 10_000, () => mv);
    assert.ok(moves.every((m) => m.from === "Olivia's Mac" && m.to.length > 0));
    assert.ok(moves.some((m) => /draining/.test(m.why)) && moves.some((m) => /1 of 1/.test(m.why)));
    assert.equal(((await s.as(NOAH, "network.machine_moves", {})).data.moves as unknown[]).length, 0, "Noah sees only his own");

    // Fix: on the Space server (the host runs it) and on Noah's computer (its owner presses it, the Space asks over the link)
    const cache = path.join(s.dir, "cache"); fs.mkdirSync(cache, { recursive: true }); fs.writeFileSync(path.join(cache, "blob"), Buffer.alloc(200_000));
    const fx = (await s.as(null, "network.machine_fix", { serverId: "srv_local", fix: "clear_caches" })).data as { queued: boolean };
    assert.equal(fx.queued, true);
    const done = await waitFor(async () => { const m = (await s.as(null, "network.machine", { serverId: "srv_local" })).data as { lastFix?: { state: string; detail?: string } }; return m.lastFix?.state === "done" ? m.lastFix : null; }, 20_000, () => hostLog(s.d));
    assert.match(done.detail ?? "", /^Cleared \d+ MB/);
    assert.equal(fs.existsSync(path.join(cache, "blob")), false);
    assert.notEqual((await s.as(null, "network.machine_fix", { serverId: NOAHS, fix: "stop_idle" })).status, 200, "an admin does not fix a member's computer");
    assert.equal((await s.as(NOAH, "network.machine_fix", { serverId: NOAHS, fix: "stop_idle" })).status, 200);
    const nf = await waitFor(async () => { const m = (await s.as(NOAH, "network.machine", { serverId: NOAHS })).data as { lastFix?: { state: string; detail?: string } }; return m.lastFix?.state === "done" ? m.lastFix : null; }, 20_000, () => hostLog(s.d));
    assert.equal(nf.detail, "No engine runs on this machine.", JSON.stringify(nf));
  } finally { await noah.stop(); await mac.stop(); await s.stop(); }
});
