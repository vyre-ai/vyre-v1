// Machines (lane l-machines), on real daemons: a Team Space server and two members' computers (Olivia's, who is the admin, and Noah's), each linked with the member's own session.
//   The Space server reads itself and each computer reports over its link: a row and a series appear.
//   Privacy: Olivia, as admin, sees Noah's computer by name, online, capacity and Vyre's own work only; Noah sees all of it; a member does not see the Space server.
//   Placement: draining Olivia's computer sends her next turn to the Space with the line "Moved from Olivia's Mac because it was draining"; a computer at its turn limit is skipped the same way.
import test from "node:test";
import assert from "node:assert/strict";
import type { Report } from "../host/src/machines/report.ts";
import { NOAH, bootDevice, bootSpace, hostLog, makeAgent, replyAfter, send, startChat, waitFor } from "./support/runson.ts";

/** The machines these daemons run on are busy with the test itself: pin their load so the room each has is the same on every run. */
const calm = (r: Report): Report => ({ ...r, load: { ...r.load, cpuPct: 20, memUsedBytes: Math.round(r.specs.memBytes * 0.4), diskFreeBytes: Math.round(r.specs.diskBytes * 0.6) } });

type Machine = { machineId: string; kind: string; name: string; online: boolean; restricted: boolean; ownerId?: string; load?: unknown; os?: string; vyreLoad?: unknown; cores?: number; can: string[]; room: { score: number; tightest: string }; draining: boolean; runs: { turns: number }; limits: { maxTurns: number } };

test("machines: reports over the links, the admin's limited view of a member's computer, drain and the turn limit skip a machine with the reason", { timeout: 120_000 }, async () => {
  const s = await bootSpace({ machineReport: calm });
  const mac = await bootDevice({ reportMs: 500, slowMs: 2500, machineReport: calm });
  const noah = await bootDevice({ reportMs: 500, name: "Noah's Mac", machineReport: calm });
  try {
    const agentId = await makeAgent(s.d, "Placer");
    await mac.link(s);
    await noah.link(s, NOAH, { person: "usr_noah", device: "dev_noah_mac" });

    // the Space server reads itself; each computer reports over its link
    const list = async (token: string | null) => ((await s.as(token, "machines.list", {})).data.machines as Machine[] | undefined) ?? [];
    const rows = await waitFor(async () => { const m = await list(null); return m.some((x) => x.machineId === "space") && m.some((x) => x.machineId === "device:dev_olivia_mac") && m.some((x) => x.machineId === "device:dev_noah_mac") ? m : null; }, 20_000, () => hostLog(s.d));
    const space = rows.find((x) => x.machineId === "space")!;
    assert.equal(space.kind, "space");
    assert.ok((space.cores ?? 0) >= 1 && space.online);
    const olivia = rows.find((x) => x.machineId === "device:dev_olivia_mac")!;
    assert.equal(olivia.name, "Olivia's Mac");
    assert.equal(olivia.kind, "computer");
    assert.equal(olivia.ownerId, "usr_olivia");
    assert.ok(olivia.can.includes("claude_code"), "it says what it can run");
    assert.equal(olivia.restricted, false, "her own computer, in full");
    assert.ok(olivia.load && olivia.os, "its load and system");

    // a series appears, and grows with the reports
    const got = await waitFor(async () => {
      const g = (await s.as(null, "machines.get", { machineId: "device:dev_olivia_mac" })).data as { series: Record<string, Array<{ cpuPct?: number; diskFreePct?: number }>> };
      return g.series["1h"].some((p) => p.cpuPct !== undefined && p.diskFreePct !== undefined) ? g : null;
    }, 20_000);
    assert.deepEqual(Object.keys(got.series), ["1h", "24h", "7d", "30d"]);
    assert.equal(got.series["1h"].length, 60);

    // privacy: the admin sees Noah's computer by name, online, capacity and Vyre's own work; Noah sees all of it
    const asAdmin = (await list(null)).find((x) => x.machineId === "device:dev_noah_mac")!;
    assert.equal(asAdmin.restricted, true);
    assert.equal(asAdmin.name, "Noah's Mac");
    assert.equal(asAdmin.online, true);
    assert.ok((asAdmin.cores ?? 0) >= 1);
    assert.equal(asAdmin.load, undefined, "the admin does not see his machine's load");
    assert.equal(asAdmin.os, undefined, "or his system");
    assert.ok(asAdmin.vyreLoad, "but Vyre's own share of it");
    const gAdmin = (await s.as(null, "machines.get", { machineId: "device:dev_noah_mac" })).data as { series: Record<string, Array<Record<string, unknown>>> };
    for (const p of gAdmin.series["1h"]) for (const k of ["cpuPct", "memPct", "diskFreePct", "netInBps", "netOutBps"]) assert.equal(k in p, false, `${k} in the admin's series of his computer`);
    const asNoah = await list(NOAH);
    assert.deepEqual(asNoah.map((x) => x.machineId), ["device:dev_noah_mac"], "a member sees only their own machines");
    assert.equal(asNoah[0]!.restricted, false);
    assert.ok(asNoah[0]!.load && asNoah[0]!.os);
    assert.equal((await s.as(NOAH, "machines.get", { machineId: "space" })).status, 404, "the Space server is not a member's to read");
    assert.equal((await s.as(NOAH, "machines.set", { machineId: "device:dev_olivia_mac", drain: true })).status, 404, "nor is another member's computer to change");

    // placement: her computer is where her turn goes; draining it sends the next turn to the Space, with the reason
    const threadId = await startChat(s, agentId, "mc-drain");
    const first = (await s.as(null, "engine.placement.decide", { threadId, agentId, kind: "message" })).data;
    assert.equal(first.placement, "device", `${JSON.stringify(first)} ${JSON.stringify((await s.as(null, "machines.rooms", { ids: ["device:dev_olivia_mac", "space"] })).data)}`);
    assert.equal((await s.as(null, "machines.set", { machineId: "device:dev_olivia_mac", drain: true })).status, 200);
    const drained = (await s.as(null, "engine.placement.decide", { threadId, agentId, kind: "message" })).data;
    assert.equal(drained.placement, "host", JSON.stringify(drained));
    assert.equal(drained.reason, "space");
    assert.equal(drained.movedLine, "Moved from Olivia's Mac because it was draining");
    const before = await send(s, threadId, agentId, "whereami", "mc-1");
    assert.equal(await replyAfter(s, threadId, before), "ran-on=space handover=no", hostLog(s.d));
    const turns = (await s.as(null, "engine.turns.list", { threadId })).data.turns as Array<{ turnId: string }>;
    const turn = (await s.as(null, "engine.turn.get", { turnId: turns[0]!.turnId })).data.what.turn as { movedFrom?: string };
    assert.equal(turn.movedFrom, "Moved from Olivia's Mac because it was draining", "the turn keeps the line");
    assert.equal((await s.as(null, "machines.set", { machineId: "device:dev_olivia_mac", drain: false })).status, 200);
    const again = (await s.as(null, "engine.placement.decide", { threadId, agentId, kind: "message" })).data;
    assert.equal(again.placement, "device", `undrained, her computer takes the turn again: ${JSON.stringify(again)} ${JSON.stringify((await s.as(null, "machines.rooms", { ids: ["device:dev_olivia_mac"] })).data)}`);

    // the turn limit: one turn at a time on her computer; while it runs, the next chat's turn goes to the Space, "1 of 1 turns"
    assert.equal((await s.as(null, "machines.set", { machineId: "device:dev_olivia_mac", maxTurns: 1 })).status, 200);
    const chatA = await startChat(s, agentId, "mc-a"), chatB = await startChat(s, agentId, "mc-b");
    const beforeA = await send(s, chatA, agentId, "whereami", "mc-slow");
    const full = await waitFor(async () => {
      const m = (await list(null)).find((x) => x.machineId === "device:dev_olivia_mac")!;
      return m.runs.turns >= 1 ? m : null;
    }, 15_000, () => hostLog(s.d));
    assert.equal(full.room.score, 0);
    assert.equal(full.room.tightest, "turns");
    const busy = (await s.as(null, "engine.placement.decide", { threadId: chatB, agentId, kind: "message" })).data;
    assert.equal(busy.reason, "space", JSON.stringify(busy));
    assert.equal(busy.movedLine, "Moved from Olivia's Mac because it was busy: 1 of 1 turns");
    assert.equal(await replyAfter(s, chatA, beforeA), "ran-on=device handover=no");
  } finally { await noah.stop(); await mac.stop(); await s.stop(); }
});
