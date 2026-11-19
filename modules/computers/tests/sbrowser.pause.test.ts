// Pause (sbrowser/pause.ts): a person pauses an agent's browser and the agent's next call waits, spending nothing, until Resume. Pause mid-typing, resume, stop while paused (the waiting call never runs),
// take over while paused (the call is refused with the hold's line, never run), a pause nobody came back to, and who may do what.
import test from "node:test";
import assert from "node:assert/strict";
import { bindSpaceBrowser } from "../sbrowser/port.ts";
import type { ProfileRow, SpaceBrowser } from "../sbrowser/port.ts";
import { resetRoom } from "../sbrowser/room.ts";
import { PAUSE_MAX_MS, pausedBy, setWaitMs, waitingOn } from "../sbrowser/pause.ts";
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
