// Warm before asked (sbrowser/warm.ts): the browser of an agent that has browsed before starts when its turn starts. Every way the warm can end is here, and none of them takes room from anyone, raises
// to the turn, leaves a claim behind or lets a real call be taken for a reopened browser.
import test from "node:test";
import assert from "node:assert/strict";
import { bindSpaceBrowser } from "../sbrowser/port.ts";
import type { ProfileRow, SpaceBrowser } from "../sbrowser/port.ts";
import { resetRoom } from "../sbrowser/room.ts";
import { resetWarm, warmBrowser, WARM_EVERY_MS } from "../sbrowser/warm.ts";
import { harness, DANA } from "../fixtures/harness.ts";
import { consumers } from "../impl.ts";
import { tool } from "./tools.fixture.ts";

interface Fake {
  warmed: Array<{ profileId: string; space?: string; agentName?: string }>;
  used: boolean;
  running: string[];
  takeover: string[];
  max: number;
  warmFails: boolean;
  warmHangs: boolean;
  profilesFails: boolean;
  noWarm: boolean;
}
function fake(o: Partial<Fake> = {}): Fake {
  const f: Fake = {
    warmed: [],
    used: true,
    running: [],
    takeover: [],
    max: 6,
    warmFails: false,
    warmHangs: false,
    profilesFails: false,
    noWarm: false,
    ...o,
  };
  const sb: SpaceBrowser = {
    async available() {
      return true;
    },
    async tool() {
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
      return f.used;
    },
    async importChrome(_p, tar) {
      return { bytes: tar.length };
    },
    async stop() {},
    async forget() {},
    async profiles() {
      if (f.profilesFails) throw new Error("service down");
      const rows: ProfileRow[] = f.running.map((id) => ({
        profileId: id,
        running: true,
        tabs: 1,
        busy: false,
        takeover: f.takeover.includes(id),
        viewers: 0,
        lastActiveAt: 1,
        held: 0,
        paused: false,
      }));
      return { profiles: rows, maxRunning: f.max };
    },
    async health() {
      return { ok: true };
    },
    ...(f.noWarm
      ? {}
      : {
          async warm(a: { profileId: string; space?: string; agentName?: string }) {
            if (f.warmHangs) return new Promise<void>(() => undefined);
            if (f.warmFails) throw new Error("no room in the service");
            f.warmed.push(a);
            f.running.push(a.profileId);
          },
        }),
  };
  bindSpaceBrowser(sb);
  return f;
}
const agent = (id = "agt_dex") => {
  const h = harness({ principal: { kind: "agent", id }, actingFor: DANA });
  h.fake.host.capacity = async () => ({ totalMb: 8192, freeMb: 6000, cpus: 4, os: "linux" });
  return h;
};
const claim = (h: ReturnType<typeof agent>, k = "agt_dex") =>
  h.rows("SELECT state FROM computers_claim WHERE claim_key = ?", k)[0]?.["state"];
const clean = () => {
  bindSpaceBrowser(null);
  resetRoom();
  resetWarm();
};

test("an agent that has browsed before gets its browser started, with its Space and name, and holds a running claim", async () => {
  const f = fake();
  const h = agent();
  try {
    assert.equal(await warmBrowser(h.ctx, "agt_dex"), "warmed");
    assert.equal(f.warmed.length, 1);
    assert.equal(f.warmed[0]?.profileId, "agt_dex");
    assert.equal(claim(h), "running");
  } finally {
    clean();
  }
});

test("an agent that never browsed is not given a browser, and no claim is made", async () => {
  const f = fake({ used: false });
  const h = agent();
  try {
    assert.equal(await warmBrowser(h.ctx, "agt_dex"), "never_browsed");
    assert.equal(f.warmed.length, 0);
    assert.equal(claim(h), undefined);
  } finally {
    clean();
  }
});

test("a browser that already runs is left alone", async () => {
  const f = fake({ running: ["agt_dex"] });
  const h = agent();
  try {
    assert.equal(await warmBrowser(h.ctx, "agt_dex"), "running");
    assert.equal(f.warmed.length, 0);
  } finally {
    clean();
  }
});

test("a person who has the controls keeps them: no warm, in the service's row or in the module's table", async () => {
  const f = fake({ running: ["agt_dex"], takeover: ["agt_dex"] });
  const h = agent();
  try {
    assert.equal(await warmBrowser(h.ctx, "agt_dex"), "running", "it runs, so there is nothing to start");
    f.running = [];
    f.takeover = ["agt_dex"];
    // the service lists a stopped browser nowhere: the take-over is the table's (hold.ts)
    h.db.run(
      "INSERT INTO computers_browser_hold (profile_id, person_id, since, seen) VALUES ('agt_dex', ?, ?, ?)",
      DANA,
      h.ctx.now(),
      h.ctx.now(),
    );
    assert.equal(await warmBrowser(h.ctx, "agt_dex"), "held");
    assert.equal(f.warmed.length, 0);
  } finally {
    clean();
  }
});

test("a full service is not asked to make room: no warm and no claim; the real call still asks for room itself", async () => {
  const f = fake({ running: ["a1", "a2"], max: 2 });
  const h = agent();
  try {
    assert.equal(await warmBrowser(h.ctx, "agt_dex"), "no_room");
    assert.equal(f.warmed.length, 0);
    assert.equal(claim(h), undefined);
    // and a quiet browser of the same Space is not closed for it
    assert.deepEqual(f.running, ["a1", "a2"]);
  } finally {
    clean();
  }
});

test("a host with no memory to spare is not asked either, and the claim the ask left is dropped", async () => {
  const f = fake();
  const h = agent();
  h.fake.host.capacity = async () => ({ totalMb: 1600, freeMb: 100, cpus: 2, os: "linux" });
  try {
    assert.equal(await warmBrowser(h.ctx, "agt_dex"), "no_room");
    assert.equal(f.warmed.length, 0);
    assert.equal(claim(h), undefined, "no waiting claim is left to take a real call's place in line");
  } finally {
    clean();
  }
});

test("a call of its own already waiting for room under the key is not touched", async () => {
  const f = fake();
  const h = agent();
  h.db.run(
    "INSERT INTO computers_claim (claim_key, kind, host, state, since, note) VALUES ('agt_dex', 'browser', 'space', 'waiting', ?, 'Waiting for room')",
    h.ctx.now(),
  );
  try {
    assert.equal(await warmBrowser(h.ctx, "agt_dex"), "no_room");
    assert.equal(f.warmed.length, 0);
    assert.equal(claim(h), "waiting");
  } finally {
    clean();
  }
});

test("a service that fails to start it leaves nothing behind and never raises", async () => {
  const f = fake({ warmFails: true });
  const h = agent();
  try {
    assert.equal(await warmBrowser(h.ctx, "agt_dex"), "failed");
    assert.equal(claim(h), undefined, "the claim made for the warm is dropped");
    assert.equal(f.warmed.length, 0);
  } finally {
    clean();
  }
});

test("a service that cannot be listed ends the warm quietly", async () => {
  fake({ profilesFails: true });
  const h = agent();
  try {
    assert.equal(await warmBrowser(h.ctx, "agt_dex"), "failed");
    assert.equal(claim(h), undefined);
  } finally {
    clean();
  }
});

test("a service without a warm, no service at all, and an id that cannot be a profile are each skipped", async () => {
  const h = agent();
  try {
    fake({ noWarm: true });
    assert.equal(await warmBrowser(h.ctx, "agt_dex"), "no_service");
    bindSpaceBrowser(null);
    assert.equal(await warmBrowser(h.ctx, "agt_dex"), "no_service");
    fake();
    assert.equal(await warmBrowser(h.ctx, "bad id!"), "bad_profile");
  } finally {
    clean();
  }
});

test("two turns that start together warm once, and one that follows within seconds warms no more", async () => {
  const f = fake();
  const h = agent();
  try {
    const [a, b] = await Promise.all([warmBrowser(h.ctx, "agt_dex"), warmBrowser(h.ctx, "agt_dex")]);
    assert.deepEqual([a, b].sort(), ["busy", "warmed"]);
    f.running = [];
    assert.equal(await warmBrowser(h.ctx, "agt_dex"), "recent");
    h.advance(WARM_EVERY_MS + 1);
    assert.equal(await warmBrowser(h.ctx, "agt_dex"), "warmed", "and again once the browser has been gone a while");
    assert.equal(f.warmed.length, 2);
  } finally {
    clean();
  }
});

test("the turn.started event starts no browser (rc.44: asleep by default), and a service that hangs does not hold the event", async () => {
  const f = fake({ warmHangs: true });
  const h = agent();
  try {
    const run = consumers["computers.browser_turns"].run;
    const t0 = Date.now();
    await run(h.ctx, { name: "turn.started", payload: { agentId: "agt_dex", turnId: "trn_1" } });
    assert.ok(Date.now() - t0 < 500, "the event is handled at once");
    await new Promise((x) => setTimeout(x, 30));
    assert.equal(f.warmed.length, 0, "nothing was asked to start, not even later");
  } finally {
    clean();
  }
});

test("a real call after a warm is a first look, not a reopened browser: it answers, it is not refused", async () => {
  fake();
  const h = agent();
  try {
    assert.equal(await warmBrowser(h.ctx, "agt_dex"), "warmed");
    // the answer is the tool's own (computers.chrome.state: url, title, loading, and the reopened notice only when the browser started again since the last step)
    const r = (await tool["computers.chrome.state"]!(h.ctx, {})) as {
      url: string;
      title: string;
      loading: boolean;
      reopened?: boolean;
      note?: string;
    };
    assert.equal(r.url, "https://x.test/");
    assert.equal(r.title, "X");
    assert.equal(r.loading, false);
    assert.equal(r.reopened, undefined, "a first look after a warm is not a reopen");
    assert.equal(r.note, undefined);
    assert.equal(claim(h), "running", "it uses the claim the warm made, and asks for no second");
  } finally {
    clean();
  }
});
