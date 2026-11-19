// Pause (sbrowser/pause.ts): a person pauses an agent's browser and the agent's next call waits, spending nothing, until Resume. Pause mid-typing, resume, stop while paused (the waiting call never runs),
// take over while paused (the call is refused with the hold's line, never run), a pause nobody came back to, and who may do what.
import test from "node:test";
import assert from "node:assert/strict";
import { bindSpaceBrowser } from "../sbrowser/port.ts";
import type { ProfileRow, SpaceBrowser } from "../sbrowser/port.ts";
import { resetRoom } from "../sbrowser/room.ts";
import {
  admitAfterPause,
  dropPause,
  dropPausesOfAgent,
  PAUSE_MAX_MS,
  pausedBy,
  setPause,
  setWaitMs,
  waitingOn,
} from "../sbrowser/pause.ts";
import { consumers } from "../impl.ts";
import { asPerson, codeOf, DANA, harness, OMAR } from "../fixtures/harness.ts";
import { tool } from "./tools.fixture.ts";

const AGENTS: Record<string, { ownerId: string; class: "space"; people: string[] }> = {
  agt_dex: { ownerId: DANA, class: "space", people: [] },
};
const respond = {
  "agents.share_class": (i: Record<string, unknown>) => {
    const a = AGENTS[String(i["agentId"])];
    if (!a) throw new Error("no such agent");
    return a;
  },
};
function rig() {
  const ran: string[] = [];
  const sb: SpaceBrowser = {
    async available() {
      return true;
    },
    async tool(a) {
      ran.push(a.tool);
      return {
        ok: true,
        url: "https://x.test/",
        title: "X",
        loading: false,
        connected: false,
        paused: false,
        held: [],
      };
    },
    async downloads() {
      return [];
    },
    async downloadRead() {
      return new Uint8Array();
    },
    async downloadAck() {},
    async takeover() {},
    async giveBack() {},
    async screenshot() {
      return { bytes: new Uint8Array(), width: 1, height: 1 };
    },
    async stream() {
      return { transport: "mjpeg", url: "http://x" };
    },
    async sessions() {
      return [];
    },
    async signOut() {
      return true;
    },
    async profileUsed() {
      return true;
    },
    async importChrome() {
      return { bytes: 0 };
    },
    async stop() {},
    async forget() {},
    async profiles() {
      const rows: ProfileRow[] = [
        {
          profileId: "agt_dex",
          running: true,
          tabs: 1,
          busy: false,
          takeover: false,
          viewers: 0,
          lastActiveAt: 1,
          held: 0,
          paused: false,
        },
      ];
      return { profiles: rows, maxRunning: 6 };
    },
    async health() {
      return { ok: true };
    },
  };
  bindSpaceBrowser(sb);
  const dana = harness({ principal: { kind: "person", id: DANA }, manager: false, respond });
  dana.fake.host.capacity = async () => ({ totalMb: 8192, freeMb: 6000, cpus: 4, os: "linux" });
  const agent = asPerson(dana, { kind: "agent", id: "agt_dex" }, { actingFor: DANA, respond });
  return { ran, dana, agent };
}
const clean = () => {
  bindSpaceBrowser(null);
  resetRoom();
  setWaitMs(null);
};
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const call = (r: ReturnType<typeof rig>) =>
  tool["computers.chrome.state"]!(r.agent.ctx, {}) as Promise<{ url: string }>;

test("with no pause a call runs at once; pausing makes the next call wait without running; Resume lets exactly it go", async () => {
  const r = rig();
  try {
    await call(r);
    assert.deepEqual(r.ran, ["chrome_state"]);
    const p = await tool["computers.browser.pause"]!(r.dana.ctx, { agentId: "agt_dex" });
    assert.equal(p.profile.pausedBy, DANA);
    let done = false;
    const waiting = call(r).then((x) => ((done = true), x));
    await tick();
    assert.equal(done, false, "the call waits");
    assert.deepEqual(r.ran, ["chrome_state"], "and has not run");
    assert.equal(waitingOn("agt_dex"), 1);
    const back = await tool["computers.browser.resume"]!(r.dana.ctx, { agentId: "agt_dex" });
    assert.equal(back.profile.pausedBy, undefined);
    assert.equal((await waiting).url, "https://x.test/");
    assert.deepEqual(r.ran, ["chrome_state", "chrome_state"]);
    assert.equal(waitingOn("agt_dex"), 0);
  } finally {
    clean();
  }
});

test("pause mid-typing: the step that is already running finishes; only the next one waits", async () => {
  const r = rig();
  try {
    let release: () => void = () => undefined;
    const sb = (await import("../sbrowser/port.ts")).spaceBrowser()!;
    const real = sb.tool.bind(sb);
    sb.tool = async (a) => {
      if (a.tool === "chrome_state" && release !== undefined && r.ran.length === 0)
        await new Promise<void>((ok) => (release = ok));
      return real(a);
    };
    const inFlight = call(r);
    await tick();
    await tool["computers.browser.pause"]!(r.dana.ctx, { agentId: "agt_dex" });
    release();
    await inFlight;
    assert.deepEqual(r.ran, ["chrome_state"], "the call that was running completed");
    let next = false;
    void call(r).then(() => (next = true));
    await tick();
    assert.equal(next, false, "the next one waits");
    await tool["computers.browser.resume"]!(r.dana.ctx, { agentId: "agt_dex" });
    await tick();
    assert.equal(next, true);
  } finally {
    clean();
  }
});

test("stop while paused: the call that waits does not run, and says so in one line; the next call after the stop is not held", async () => {
  const r = rig();
  try {
    await tool["computers.browser.pause"]!(r.dana.ctx, { agentId: "agt_dex" });
    const waiting = call(r);
    const result = assert.rejects(
      waiting,
      (e) => codeOf(e) === "provider.unavailable" && /did not run/.test(JSON.stringify(e)),
    );
    await tick();
    await tool["computers.browser.resume"]!(r.dana.ctx, { agentId: "agt_dex", stopped: true });
    await result;
    assert.deepEqual(r.ran, [], "nothing ran after the stop");
    await call(r);
    assert.deepEqual(r.ran, ["chrome_state"]);
  } finally {
    clean();
  }
});

test("take over while paused: the pause ends, the waiting call is refused with the hold's line and never runs, and the person's hold stands", async () => {
  const r = rig();
  try {
    await tool["computers.browser.pause"]!(r.dana.ctx, { agentId: "agt_dex" });
    const waiting = call(r);
    const result = assert.rejects(
      waiting,
      (e) => codeOf(e) === "provider.unavailable" && /controls/i.test(JSON.stringify(e)),
    );
    await tick();
    await tool["computers.browser.take_over"]!(r.dana.ctx, { agentId: "agt_dex" });
    await result;
    assert.deepEqual(r.ran, []);
    assert.equal(pausedBy(r.dana.ctx, "agt_dex"), null, "a take-over leaves no pause behind");
    // and a pause is refused while a person holds the controls
    await assert.rejects(
      () => tool["computers.browser.pause"]!(r.dana.ctx, { agentId: "agt_dex" }),
      (e) => codeOf(e) === "validation.precondition_failed",
    );
  } finally {
    clean();
  }
});

test("pausing twice changes nothing; another person's pause is theirs to resume (an admin may); a stranger and an agent are refused", async () => {
  const r = rig();
  try {
    await tool["computers.browser.pause"]!(r.dana.ctx, { agentId: "agt_dex" });
    const again = await tool["computers.browser.pause"]!(r.dana.ctx, { agentId: "agt_dex" });
    assert.equal(again.profile.pausedBy, DANA);
    const omar = asPerson(r.dana, { kind: "person", id: OMAR }, { manager: false, respond });
    await assert.rejects(
      () => tool["computers.browser.resume"]!(omar.ctx, { agentId: "agt_dex" }),
      (e) => ["permission.no_grant", "validation.not_found"].includes(codeOf(e)),
    );
    await assert.rejects(
      () => tool["computers.browser.pause"]!(r.agent.ctx, { agentId: "agt_dex" }),
      (e) => codeOf(e) === "permission.no_grant",
    );
    const admin = asPerson(r.dana, { kind: "person", id: OMAR }, { manager: true, respond });
    const out = await tool["computers.browser.resume"]!(admin.ctx, { agentId: "agt_dex" });
    assert.equal(out.profile.pausedBy, undefined);
    // resuming what is not paused changes nothing and does not fail
    await tool["computers.browser.resume"]!(r.dana.ctx, { agentId: "agt_dex" });
  } finally {
    clean();
  }
});

test("a pause nobody came back to ends by itself after half an hour, and a call that waits too long gives up with the line, having run nothing", async () => {
  const r = rig();
  try {
    await tool["computers.browser.pause"]!(r.dana.ctx, { agentId: "agt_dex" });
    r.dana.advance(PAUSE_MAX_MS + 1);
    assert.equal(pausedBy(r.dana.ctx, "agt_dex"), null);
    await call(r);
    assert.deepEqual(r.ran, ["chrome_state"], "after the pause ran out the call goes");
    await tool["computers.browser.pause"]!(r.dana.ctx, { agentId: "agt_dex" });
    setWaitMs(60);
    await assert.rejects(
      call(r),
      (e) => codeOf(e) === "provider.unavailable" && /paused your browser/.test(JSON.stringify(e)),
    );
    assert.deepEqual(r.ran, ["chrome_state"], "the call that gave up never ran");
  } finally {
    clean();
  }
});

test("the profile row says who paused it, in the list too; looks (status) are not held by a pause", async () => {
  const r = rig();
  try {
    await tool["computers.browser.pause"]!(r.dana.ctx, { agentId: "agt_dex" });
    const list = await tool["computers.browser.profiles"]!(r.dana.ctx, {});
    assert.equal(list.profiles.find((p: { agentId: string }) => p.agentId === "agt_dex")?.pausedBy, DANA);
    await tool["computers.chrome.status"]!(r.agent.ctx, {});
    assert.deepEqual(r.ran, ["chrome_status"], "status runs while paused");
  } finally {
    clean();
  }
});

test("a stop by someone who did not pause: the turn's own cancel ends the pause and the waiting call never runs, whoever pressed Stop and whether or not any second call arrives", async () => {
  const r = rig();
  try {
    // Ana pauses; Bo (or anyone) stops the agent: the engine cancels the turn
    await tool["computers.browser.pause"]!(r.dana.ctx, { agentId: "agt_dex" });
    const waiting = call(r);
    const result = assert.rejects(
      waiting,
      (e) => codeOf(e) === "provider.unavailable" && /did not run/.test(JSON.stringify(e)),
    );
    await tick();
    await consumers["computers.browser_turns"].run(r.dana.ctx, {
      name: "turn.cancelled",
      payload: { agentId: "agt_dex", turnId: "trn_1" },
    });
    await result;
    assert.deepEqual(r.ran, [], "nothing ran after the stop");
    assert.equal(
      pausedBy(r.dana.ctx, "agt_dex"),
      null,
      "the pause is over, so Ana's later Resume or the half hour cannot let anything run",
    );
    await call(r);
    assert.deepEqual(r.ran, ["chrome_state"], "the next turn's call is not held");
  } finally {
    clean();
  }
});

test("a failed turn ends the pause too; a turn that completes normally leaves it; every profile of the agent is covered (its askers' too), and no other agent's", async () => {
  const r = rig();
  try {
    setPause(r.dana.ctx, "agt_dex", DANA);
    setPause(r.dana.ctx, "agt_dex-usr_omar", OMAR);
    setPause(r.dana.ctx, "agt_other", DANA);
    await consumers["computers.browser_turns"].run(r.dana.ctx, {
      name: "turn.completed",
      payload: { agentId: "agt_dex", turnId: "trn_a" },
    });
    assert.equal(pausedBy(r.dana.ctx, "agt_dex"), DANA, "a normal end of a turn is not a stop");
    await consumers["computers.browser_turns"].run(r.dana.ctx, {
      name: "turn.failed",
      payload: { agentId: "agt_dex", turnId: "trn_b" },
    });
    assert.equal(pausedBy(r.dana.ctx, "agt_dex"), null);
    assert.equal(pausedBy(r.dana.ctx, "agt_dex-usr_omar"), null);
    assert.equal(pausedBy(r.dana.ctx, "agt_other"), DANA, "another agent's pause stays");
    assert.equal(dropPausesOfAgent(r.dana.ctx, "agt_dex"), 0, "nothing left to end");
  } finally {
    clean();
  }
});

test("admitting a call: a pause that appears while the hold is being read is waited out, then the hold is read again; a stop in that gap means the call does not run, a take-over in it means the call is refused by the hold", async () => {
  const r = rig();
  try {
    const ctx = r.dana.ctx;
    // no pause: one hold read, goes at once
    let reads = 0;
    const plain = await admitAfterPause(ctx, "agt_dex", false, async () => ((reads += 1), null));
    assert.deepEqual([plain.ok, reads], [true, 1]);
    // a look (status) goes through a pause and a hold without reading either
    setPause(ctx, "agt_dex", DANA);
    const look = await admitAfterPause(ctx, "agt_dex", true, async () => null);
    assert.equal(look.ok, true);
    dropPause(ctx, "agt_dex");
    // a pause appears during the hold read; Stop comes while the call waits: it does not run
    let n = 0;
    const racing = admitAfterPause(ctx, "agt_dex", false, async () => {
      n += 1;
      if (n === 1) setPause(ctx, "agt_dex", DANA);
      return null;
    });
    await tick();
    assert.equal(waitingOn("agt_dex"), 1, "it waits instead of going on");
    dropPause(ctx, "agt_dex", { stopped: true });
    assert.deepEqual(await racing, { ok: false, why: "stopped" });
    // a pause appears during the hold read; a take-over ends it: the hold is read again and the call is given it (so the caller refuses)
    let m = 0;
    const taken = admitAfterPause(ctx, "agt_dex", false, async () => {
      m += 1;
      if (m === 1) {
        setPause(ctx, "agt_dex", DANA);
        return null;
      }
      return { personId: OMAR };
    });
    await tick();
    dropPause(ctx, "agt_dex");
    const got = await taken;
    assert.ok(got.ok && got.hold?.personId === OMAR, "the hold is seen, not skipped");
    assert.equal(m, 2);
    // and a pause that is never lifted gives up with nothing run
    setPause(ctx, "agt_dex", DANA);
    assert.deepEqual(await admitAfterPause(ctx, "agt_dex", false, async () => null, 40), { ok: false, why: "gave_up" });
  } finally {
    clean();
  }
});
