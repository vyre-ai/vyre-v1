// The agent's first browser calls on a database an rc.25 server left (13 Nov 2026, B6a): no hold or gone tables yet (they came with rc.26), and a running browser claim and workspace claim for containers that are gone.
// Two opens arrive together; both answer. Written while looking for the first-open internal.unexpected on the owner's updated server; it did not reproduce there (see team/v1/NOTE-b6a-first-open-2026-11-13.md).
import test from "node:test";
import assert from "node:assert/strict";
import { bindSpaceBrowser } from "../sbrowser/port.ts";
import type { SpaceBrowser } from "../sbrowser/port.ts";
import { DANA, harness, openRaw } from "../fixtures/harness.ts";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { tool } from "./tools.fixture.ts";

test("two first opens on an rc.25 database with stale claims both answer", async () => {
  const raw = openRaw();
  const first = harness({ raw });
  for (const t of ["computers_browser_hold", "computers_browser_gone"]) raw.run(`DROP TABLE IF EXISTS ${t}`);
  // what an rc.25 server left: a running browser claim and a running workspace claim, for a container that is gone
  raw.run(
    "INSERT INTO computers_claim (claim_key, kind, host, state, since, note) VALUES (?, ?, ?, ?, ?, NULL)",
    "agt_dex",
    "browser",
    "space",
    "running",
    1,
  );
  raw.run(
    "INSERT INTO computers_claim (claim_key, kind, host, state, since, note) VALUES (?, ?, ?, ?, ?, NULL)",
    "agt_other",
    "workspace",
    "space",
    "running",
    1,
  );
  const sb = {
    async available() {
      return true;
    },
    async profiles() {
      return { profiles: [], maxRunning: 6 };
    },
    async health() {
      return { ok: true };
    },
    async sessions() {
      return [];
    },
    async tool() {
      return {
        url: "https://www.harborquotes.com/",
        title: "H",
        tree: "",
        truncated: false,
        ok: true,
        tabId: "t1",
        loading: false,
      };
    },
    async screenshot() {
      return { bytes: new Uint8Array(), width: 1, height: 1 };
    },
  } as unknown as SpaceBrowser;
  bindSpaceBrowser(sb);
  const agent = {
    ...first.ctx,
    principal: { kind: "agent" as const, id: "agt_dex" },
    actingFor: DANA,
    db: scopedDb("computers", raw, first.ctx.trace.traceId),
  };
  const person = { ...first.ctx, db: scopedDb("computers", raw, first.ctx.trace.traceId) };
  const r = await Promise.allSettled([
    tool["computers.chrome.open"]!(agent as never, { url: "https://www.harborquotes.com/" }),
    tool["computers.chrome.open"]!(agent as never, { url: "https://www.harborquotes.com/x" }),
  ]);
  assert.deepEqual(
    r.map((x) => (x.status === "fulfilled" ? "ok" : String((x.reason as Error).stack).slice(0, 400))),
    ["ok", "ok"],
  );
  bindSpaceBrowser(null);
});
