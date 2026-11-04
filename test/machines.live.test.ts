// Machines (lane l-machines), on real daemons: a Team Space server and two members' computers (Olivia's, who is the admin, and Noah's), each linked with the member's own session.
//   Reports arrive over the links; history appears; the admin sees Noah's computer by name, online, capacity and Vyre's own work only; Noah sees all of it and no one else's.
//   Drain skips a machine with the reason, and so does the turn limit; both are listed under Recent moves. An agent pinned to the Space server runs there; draining it moves the agent on.
//   A Fix pressed on the Space server runs on the host and shows as the machine's last fix; Noah's computer runs a Fix when its owner presses it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NOAH, bootDevice, bootSpace, calm, hostLog, makeAgent, messages, replyAfter, send, startChat, waitFor } from "./support/runson.ts";


interface M { machineId: string; name: string; kind: string; online: boolean; restricted: boolean; mine: boolean; cores?: number; os?: string; load?: unknown; vyreLoad?: unknown; can: string[]; room: { score: number; tightest: string }; draining: boolean; runs: { turns: number } }
const OLIVIA = "device:dev_olivia_mac", NOAHS = "device:dev_noah_mac";

test("machines: reports, history, the admin's limited view, drain and the turn limit with their reasons, an agent's pin, Recent moves, Fix", { timeout: 150_000 }, async () => {
  const s = await bootSpace({ machineReport: calm });
  const mac = await bootDevice({ reportMs: 500, slowMs: 5000, machineReport: calm });
  const noah = await bootDevice({ reportMs: 500, name: "Noah's Mac", machineReport: calm });
  try {
    const agentId = await makeAgent(s.d, "Placer");
    await mac.link(s);
    await noah.link(s, NOAH, { person: "usr_noah", device: "dev_noah_mac" });
    const list = async (token: string | null): Promise<M[]> => (((await s.as(token, "machines.list", {})).data.machines as M[] | undefined) ?? []);
    const get = async (token: string | null, machineId: string) => s.as(token, "machines.get", { machineId });

    // reports over the links, and the Space server's own
    let seen = "";
    const rows = await waitFor(async () => { const m = await list(null); seen = JSON.stringify(m.map((x) => x.machineId)); return ["space", OLIVIA, NOAHS].every((id) => m.some((x) => x.machineId === id)) ? m : null; }, 30_000, () => seen);
    const olivia = rows.find((x) => x.machineId === OLIVIA)!;
    assert.equal(olivia.name, "Olivia's Mac");
    assert.ok(olivia.can.includes("claude_code") && olivia.os && olivia.load && olivia.mine, "her own computer, in full");
    assert.equal(rows.find((x) => x.machineId === "space")!.kind, "space");

    // history appears
    const page = await waitFor(async () => {
      const r = await get(null, OLIVIA);
      assert.equal(r.status, 200, JSON.stringify(r.data));
      const g = r.data as { series: Record<string, Array<{ cpuPct?: number; diskFreePct?: number }>> };
      return g.series["1h"]!.some((p) => p.cpuPct !== undefined && p.diskFreePct !== undefined) ? g : null;
    }, 20_000);
    assert.deepEqual(Object.keys(page.series), ["1h", "24h", "7d", "30d"]);
    assert.equal(page.series["1h"]!.length, 60);

    // the admin's view of Noah's computer
    const theirs = (await list(null)).find((x) => x.machineId === NOAHS)!;
    assert.equal(theirs.restricted, true);
    assert.equal(theirs.name, "Noah's Mac");
    assert.equal(theirs.online, true);
    assert.ok((theirs.cores ?? 0) >= 1, "its capacity");
    assert.equal(theirs.load, undefined, "not his machine's load");
    assert.equal(theirs.os, undefined, "not his system");
    assert.ok(theirs.vyreLoad, "Vyre's own share");
    const pg = (await get(null, NOAHS)).data as { privacy: string; findings: unknown[]; series: Record<string, Array<Record<string, unknown>>> };
    assert.equal(pg.privacy, "vyre_only");
    assert.deepEqual(pg.findings, []);
    for (const p of pg.series["1h"]!) for (const k of ["cpuPct", "memPct", "diskFreePct", "netInBps", "netOutBps"]) assert.equal(k in p, false, `${k} in the admin's series of his computer`);
    const noahsOwn = await list(NOAH);
    assert.deepEqual(noahsOwn.map((x) => x.machineId), [NOAHS], "a member sees only their own");
    assert.ok(noahsOwn[0]!.load && !noahsOwn[0]!.restricted);
    assert.notEqual((await get(NOAH, OLIVIA)).status, 200);
    assert.notEqual((await s.as(NOAH, "machines.set", { machineId: OLIVIA, drain: true })).status, 200);
    assert.notEqual((await s.as(null, "machines.set", { machineId: NOAHS, nickname: "Mine" })).status, 200, "an admin does not rename a member's computer");

    // drain: the next turn goes elsewhere, and the line says why
    const threadId = await startChat(s, agentId, "mc-drain");
    assert.equal((await s.as(null, "engine.placement.decide", { threadId, agentId, kind: "message" })).data.placement, "device");
    assert.equal((await s.as(null, "machines.set", { machineId: OLIVIA, drain: true })).status, 200);
    const drained = (await s.as(null, "engine.placement.decide", { threadId, agentId, kind: "message" })).data;
    assert.equal(drained.reason, "space", JSON.stringify(drained));
    assert.equal(`Moved from ${drained.moved.from} because ${drained.moved.why}`, "Moved from Olivia's Mac because it is draining");
    assert.equal(await replyAfter(s, threadId, await send(s, threadId, agentId, "whereami", "mc-1")), "ran-on=space handover=no", hostLog(s.d));
    assert.equal((await s.as(null, "machines.set", { machineId: OLIVIA, drain: false })).status, 200);

    // the turn limit: while her one turn runs, the next chat's turn goes to the Space
    assert.equal((await s.as(null, "machines.set", { machineId: OLIVIA, maxTurns: 1 })).status, 200);
    const chatA = await startChat(s, agentId, "mc-a"), chatB = await startChat(s, agentId, "mc-b");
    const beforeA = await send(s, chatA, agentId, "slowwhere", "mc-slow");
    await waitFor(async () => ((await list(null)).find((x) => x.machineId === OLIVIA)!.runs.turns >= 1 ? true : null), 15_000, () => hostLog(s.d));
    const full = (await list(null)).find((x) => x.machineId === OLIVIA)!;
    assert.deepEqual([full.room.score, full.room.tightest], [0, "turns"]);
    // what runs here is on the machine's page while it runs
    const work = ((await get(null, OLIVIA)).data as { work: Array<{ kind: string; agentId?: string }> }).work;
    assert.ok(work.some((w) => w.kind === "turn" && w.agentId === agentId), "the running turn is listed under the machine");
    const busy = (await s.as(null, "engine.placement.decide", { threadId: chatB, agentId, kind: "message" })).data;
    assert.equal(busy.reason, "space", JSON.stringify(busy) + JSON.stringify((await s.as(null, "machines.rooms", { ids: [OLIVIA, "space"] })).data));
    assert.match(busy.moved.why, /1 of 1 turns running/);
    assert.equal(await replyAfter(s, chatB, await send(s, chatB, agentId, "whereami", "mc-b1")), "ran-on=space handover=no");
    const finalA = await waitFor(async () => { const m = (await messages(s, chatA)).slice(beforeA).filter((x) => x.author?.kind === "agent").at(-1)?.body ?? ""; return /ran-on=/.test(m) ? m : null; }, 30_000, () => hostLog(s.d));
    assert.match(finalA, /ran-on=device handover=no$/, "her slow turn ran on her computer to the end");
    // two turns started back to back respect a limit of 1: the Space counts what it has started, so one runs on her computer and the other goes to the Space
    const chatD = await startChat(s, agentId, "mc-d"), chatE = await startChat(s, agentId, "mc-e");
    const [beforeD, beforeE] = await Promise.all([send(s, chatD, agentId, "whereami", "mc-d1"), send(s, chatE, agentId, "whereami", "mc-e1")]);
    const where = [await replyAfter(s, chatD, beforeD), await replyAfter(s, chatE, beforeE)].sort();
    assert.deepEqual(where, ["ran-on=device handover=no", "ran-on=space handover=no"], hostLog(s.d));
    assert.equal((await s.as(null, "machines.set", { machineId: OLIVIA, maxTurns: 4 })).status, 200);

    // an agent pinned to the Space server runs there; draining the server moves the agent on, and the turn says why
    assert.equal((await s.as(null, "machines.set", { machineId: "space", pinAgent: { agentId, pinned: true } })).status, 200);
    const chatC = await startChat(s, agentId, "mc-c");
    const pinned = (await s.as(null, "engine.placement.decide", { threadId: chatC, agentId, kind: "message" })).data;
    assert.equal(pinned.reason, "space", JSON.stringify(pinned));
    assert.equal(pinned.moved, undefined);
    assert.equal((await s.as(null, "machines.set", { machineId: "space", drain: true })).status, 200);
    const away = (await s.as(null, "engine.placement.decide", { threadId: chatC, agentId, kind: "message" })).data;
    assert.equal(away.placement, "device", JSON.stringify(away));
    assert.equal(`Moved from ${away.moved.from} because ${away.moved.why}`, "Moved from the Space server because it is draining");
    assert.equal((await s.as(null, "machines.set", { machineId: "space", drain: false, pinAgent: { agentId, pinned: false } })).status, 200);

    // Recent moves, Space-wide
    let mv = "";
    const moves = await waitFor(async () => { const m = (await s.as(null, "machines.moves", {})).data.moves as Array<{ from: string; to: string; why: string }>; mv = JSON.stringify(m); return m.length >= 2 ? m : null; }, 10_000, () => mv);
    assert.ok(moves.every((m) => m.from === "Olivia's Mac" && m.to.length > 0));
    assert.ok(moves.some((m) => /draining/.test(m.why)) && moves.some((m) => /1 of 1/.test(m.why)));
    assert.equal(((await s.as(NOAH, "machines.moves", {})).data.moves as unknown[]).length, 0, "Noah sees only his own");

    // Fix: on the Space server (the host runs it) and on Noah's computer (its owner presses it, the Space asks over the link)
    const cache = path.join(s.dir, "cache"); fs.mkdirSync(cache, { recursive: true }); fs.writeFileSync(path.join(cache, "blob"), Buffer.alloc(200_000));
    const fx = await s.as(null, "machines.fix", { machineId: "space", fix: "clear_caches" });
    assert.equal(fx.status, 200, JSON.stringify(fx.data));
    assert.match(fx.data.detail, /^Cleared \d+ MB/);
    assert.equal(fs.existsSync(path.join(cache, "blob")), false);
    assert.equal(((await get(null, "space")).data as { lastFix?: { state: string } }).lastFix?.state, "done");
    assert.notEqual((await s.as(null, "machines.fix", { machineId: NOAHS, fix: "stop_idle" })).status, 200, "an admin does not fix a member's computer");
    const nf = await s.as(NOAH, "machines.fix", { machineId: NOAHS, fix: "stop_idle" });
    assert.equal(nf.status, 200, JSON.stringify(nf.data));
    assert.deepEqual(nf.data, { state: "done", detail: "No idle engine sessions." });
  } finally { await noah.stop(); await mac.stop(); await s.stop(); }
});
