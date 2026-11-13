// A first call on a cold browser never ends as internal.unexpected (13 Nov 2026, owner on rc.26: "computers.chrome.open internal.unexpected once: the agent's first page load"). Whatever throws in the steps
// around the browser's own answer (making room, the hold, the agent's details), the agent is told in plain words that the browser is not available, with the tool that was called, and told to call it again;
// the server's log keeps the cause. A failure after the page loaded (noting its tab) never fails the call.
import test from "node:test";
import { coldStartRetry } from "../handlers/tools/common.ts";
import { HostError, makeError } from "../../../host/src/routes/errors.ts";
import assert from "node:assert/strict";
import { bindSpaceBrowser } from "../sbrowser/port.ts";
import { resetAgentInfo } from "../sbrowser/agentinfo.ts";
import type { SpaceBrowser } from "../sbrowser/port.ts";
import { DANA, harness } from "../fixtures/harness.ts";
import { tool } from "./tools.fixture.ts";

function browser(): SpaceBrowser {
  const sb = {
    async available() {
      return true;
    },
    async tool() {
      return {
        url: "https://acme.test/",
        title: "Acme",
        ok: true,
        tabId: "t1",
        loading: false,
        tree: "- page [e1]",
        truncated: false,
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
      return { bytes: new Uint8Array([1, 2, 3]), width: 1, height: 1 };
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
      return false;
    },
    async importChrome() {
      return { bytes: 0 };
    },
    async stop() {},
    async forget() {},
    async profiles() {
      return { profiles: [], maxRunning: 6 };
    },
    async health() {
      return { ok: true };
    },
  } as unknown as SpaceBrowser;
  bindSpaceBrowser(sb);
  return sb;
}

test("a crash while making room for a cold browser is a plain 'not available', never an unexpected error", async () => {
  browser();
  resetAgentInfo();
  try {
    const dex = harness({ principal: { kind: "agent", id: "agt_dex" }, actingFor: DANA }).ctx;
    // the room's own table is gone: a raw database error from inside the steps that run before the browser is asked
    dex.db.run("DROP TABLE computers_claim");
    const err = await tool["computers.chrome.open"]!(dex, { url: "https://acme.test/" }).then(
      () => null,
      (e: { error?: { code?: string; message?: string; details?: Record<string, unknown> } }) => e,
    );
    assert.equal(err?.error?.code, "provider.unavailable");
    assert.match(err?.error?.message ?? "", /not available right now/);
    assert.match(err?.error?.message ?? "", /call it once more/);
    assert.equal(err?.error?.details?.["tool"], "chrome_open");
    assert.ok(!/SQL|no such table|computers_claim/i.test(JSON.stringify(err)), "no internal word reaches the agent");
  } finally {
    bindSpaceBrowser(null);
    resetAgentInfo();
  }
});

test("a cold browser that works answers the first call", async () => {
  browser();
  resetAgentInfo();
  try {
    const dex = harness({ principal: { kind: "agent", id: "agt_dex" }, actingFor: DANA }).ctx;
    const out = (await tool["computers.chrome.open"]!(dex, { url: "https://acme.test/" })) as { url?: string };
    assert.equal(out.url, "https://acme.test/");
  } finally {
    bindSpaceBrowser(null);
    resetAgentInfo();
  }
});

test("a failure of a waking browser is waited out inside the call: the model sees one answer", async () => {
  let n = 0;
  const out = await coldStartRetry(
    async () => {
      if (++n < 3) throw new Error("starting");
      return "ok";
    },
    3,
    1,
  );
  assert.equal(out, "ok");
  assert.equal(n, 3);
});

test("a refusal with its own words is not retried, and a failure that outlasts the bound ends", async () => {
  let n = 0;
  await assert.rejects(() =>
    coldStartRetry(
      async () => {
        n++;
        throw new HostError(makeError("provider.unavailable", "t", { message: "full" }));
      },
      3,
      1,
    ),
  );
  assert.equal(n, 1);
  let m = 0;
  await assert.rejects(() =>
    coldStartRetry(
      async () => {
        m++;
        throw new Error("x");
      },
      3,
      1,
    ),
  );
  assert.equal(m, 3);
});
