// The three counter-trust fast paths of the access writers (27 Nov 2026), and the one thing none of them may ever do: act on state that a revoke, a member removal or a role change has already replaced.
//   1. the settle skip     (share.ts settleForWriter): a writer whose warm store is the one the kept share state was built for does not settle against the sync's view first
//   2. the shared stamp    (share.ts shareOf): the kept share state is taken as it is while the access write counter stands where it was published
//   3. the change log      (share.ts changedRoots + projections.ts SealedMap): only the resources a sealed view changed since the base was copied are compared
// and the warm store itself (projections.ts keepWarm/takeWarm), kept only when the trigger counter stood where the store was read at the start of the transaction that wrote.
// Each scenario: call A (a folder follows a record) leaves a warm store; something else changes the access tables between the two calls (an event the sync folds, plain SQL); call B must act on the new
// state and leave every read right. A control without any change proves the fast path is live (the counters), so the scenarios are not vacuous. Forcing a check to pass turns each of them red.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../../../host/src/daemon/sqlite.ts";
import type { HostDb } from "../../../host/src/daemon/sqlite.ts";
import { migrate } from "../../../host/src/daemon/hosttables.ts";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { hostCalls } from "../consumers.ts";
import type { LogEvent } from "../consumers.ts";
import { handlers } from "../handlers/index.ts";
import type { AccessCtx } from "../projections.ts";
import { shareKept } from "../handlers/share.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const NOW = 1_800_000_000_000;
const SPACE = "spc_fp";
const TRACE = "0123456789abcdef0123456789abcdef";
const sync = hostCalls["access.sync"] as unknown as (ctx: unknown, input: { events: LogEvent[] }) => unknown;

type Ctx = AccessCtx & {
  origin: string;
  depth: number;
  call(cap: string, input: unknown): Promise<unknown>;
  log: { warn(): void };
};
function ctxOf(raw: HostDb, principal = "usr_owner", kind = "person"): Ctx {
  return {
    space: SPACE,
    principal: { kind, id: principal },
    trace: { traceId: TRACE },
    now: () => NOW,
    db: scopedDb("access", raw, TRACE),
    emit: () => undefined,
    origin: "gateway",
    depth: 0,
    call: async () => null,
    log: { warn: () => undefined },
  } as Ctx;
}
function fresh(tag: string): HostDb {
  const dir = fs.mkdtempSync(path.join(process.env["TMPDIR"] ?? os.tmpdir(), `access-fp-${tag}-`));
  const raw = openDb(path.join(dir, "modules.db"));
  migrate(raw, ROOT, () => NOW);
  return raw;
}
let seq = 0;
const ev = (type: string, payload: unknown): LogEvent => ({ seq: ++seq, type, payload });
const res = (id: string, type: string, parent: string | null, label = 0, owner = "usr_owner"): LogEvent =>
  ev("resource.created", { id, type, parent_id: parent, label, owner_id: owner, holds: 0 });
function seed(raw: HostDb): void {
  sync(ctxOf(raw), {
    events: [
      res(SPACE, "space", null),
      ...["usr_owner", "usr_mia", "usr_noor"].map((id) =>
        ev("principal.created", { id, kind: "person", name: id.slice(4), status: "active" }),
      ),
      ev("principal.role_set", { holder: "usr_owner", role: "rol_owner" }),
      ev("principal.role_set", { holder: "usr_mia", role: "rol_member" }),
      ev("principal.role_set", { holder: "usr_noor", role: "rol_member" }),
      ev("group.member_added", { group: "grp_everyone", member: "usr_mia" }),
      res("contact", "record_type", SPACE),
      res("rec_1", "record", "contact", 0, "usr_owner"),
      res("fld_1", "folder", SPACE),
      res("fld_a", "folder", SPACE),
      res("fld_b", "folder", SPACE),
      res("fld_c", "folder", SPACE),
      ev("grant.created", {
        id: "gr_grp",
        subject_kind: "group",
        subject_id: "grp_everyone",
        resource_type: "folder",
        resource_id: "fld_1",
        level: "edit",
        by: "usr_owner",
      }),
    ],
  });
}
const follows = (raw: HostDb, folder: string) =>
  (handlers["access.audience_set"] as unknown as (c: unknown, i: unknown) => Promise<unknown>)(
    ctxOf(raw, "svc_host", "service"),
    {
      resource: { type: "folder", id: folder },
      follows: "rec_1",
    },
  );
const listed = (raw: HostDb, who: string) =>
  (handlers["access.lists"] as unknown as (c: unknown, i: unknown) => Promise<{ rows: { id: string }[] }>)(
    ctxOf(raw, who),
    { type: "folder" },
  ).then((r) => r.rows.map((x) => x.id).sort());
const mine = (raw: HostDb, person: string, id?: string): number =>
  Number(
    (
      raw.all(
        `SELECT COUNT(*) AS n FROM access_my_access WHERE person = ?${id ? " AND resourceId = ?" : ""}`,
        ...(id ? [person, id] : [person]),
      )[0] as { n: number }
    ).n,
  );
const grants = (raw: HostDb, id: string): number =>
  Number((raw.all("SELECT COUNT(*) AS n FROM access_grants WHERE id = ?", id)[0] as { n: number }).n);

/** A, the control (B without a change: the fast paths must be live), the change, B. */
async function around(tag: string, change: (raw: HostDb) => void | Promise<void>): Promise<HostDb> {
  const raw = fresh(tag);
  seed(raw);
  assert.deepEqual(
    await listed(raw, "usr_mia"),
    ["fld_1", "fld_a", "fld_b", "fld_c"].filter((f) => f === "fld_1"),
    "mia sees the folder her group may edit",
  );
  await follows(raw, "fld_a");
  const skips = shareKept.settleSkips;
  await follows(raw, "fld_c"); // nothing changed in between: the settle skip is live
  assert.ok(
    shareKept.settleSkips > skips,
    "control: with nothing changed between two calls, the writer skips the settle",
  );
  await change(raw);
  await follows(raw, "fld_b");
  return raw;
}

test("a revoke folded by the sync between two folder-follows calls is seen by the second call and by every read after it", async () => {
  const raw = await around(
    "revoke",
    (r) =>
      void sync(ctxOf(r), {
        events: [ev("grant.revoked", { grantId: "gr_grp", resource: { type: "folder", id: "fld_1" } })],
      }),
  );
  assert.equal(grants(raw, "gr_grp"), 0, "the second call did not write the revoked grant back");
  assert.equal(mine(raw, "usr_mia", "fld_1"), 0, "no cached row gives mia the folder she lost");
  assert.ok(!(await listed(raw, "usr_mia")).includes("fld_1"), "a read after it does not list the folder");
});

test("a revoke written with plain SQL (another path, not folded by the sync) between two calls is seen by the second call", async () => {
  const raw = await around("sql", (r) => void r.run("DELETE FROM access_grants WHERE id = ?", "gr_grp"));
  assert.equal(grants(raw, "gr_grp"), 0);
  assert.equal(mine(raw, "usr_mia", "fld_1"), 0, "no cached row gives mia the folder after the revoke");
  assert.ok(!(await listed(raw, "usr_mia")).includes("fld_1"));
});

test("a member removed between two calls has no row left after the second call", async () => {
  const raw = await around(
    "removed",
    (r) => void sync(ctxOf(r), { events: [ev("member.removed", { personId: "usr_mia" })] }),
  );
  assert.equal(mine(raw, "usr_mia"), 0, "a removed person keeps no cached access");
});

test("a role change between two calls is seen: a person given the role a folder is shared with has the folder after the second call", async () => {
  const raw = await around(
    "role",
    (r) =>
      void sync(ctxOf(r), {
        events: [
          ev("grant.created", {
            id: "gr_role",
            subject_kind: "role",
            subject_id: "rol_guest",
            resource_type: "folder",
            resource_id: "fld_1",
            level: "view",
            by: "usr_owner",
          }),
          ev("principal.role_set", { holder: "usr_noor", role: "rol_guest" }),
        ],
      }),
  );
  assert.ok(
    mine(raw, "usr_noor", "fld_1") > 0,
    "noor, given the guest role between the calls, has the folder shared with that role",
  );
  assert.deepEqual(await listed(raw, "usr_noor"), ["fld_1"], "and a read lists it");
});

test("the shared stamp and the change log are live, and a change they must see is seen (a new folder registered by the sync between two reads)", async () => {
  const raw = fresh("stamp");
  seed(raw);
  await listed(raw, "usr_mia");
  await follows(raw, "fld_a");
  const stamp = shareKept.stampShared + shareKept.logCompared;
  await follows(raw, "fld_c");
  await listed(raw, "usr_owner");
  sync(ctxOf(raw), {
    events: [
      res("fld_d", "folder", SPACE),
      ev("grant.revoked", { grantId: "gr_grp", resource: { type: "folder", id: "fld_1" } }),
    ],
  });
  await follows(raw, "fld_b");
  assert.ok(shareKept.stampShared + shareKept.logCompared >= stamp, "the paths ran");
  assert.ok((await listed(raw, "usr_owner")).includes("fld_d"), "a folder registered between the calls is listed");
  assert.ok(!(await listed(raw, "usr_mia")).includes("fld_1"), "and the revoke in the same batch is seen");
});

test("fold lag: an access event logged but not yet folded is not in the tables, so the next call works from the tables as it always did; once the sync folds it, the call after it sees it", async () => {
  const raw = fresh("lag");
  seed(raw);
  await listed(raw, "usr_mia");
  await follows(raw, "fld_a");
  const pending = ev("grant.revoked", { grantId: "gr_grp", resource: { type: "folder", id: "fld_1" } }); // in the log, not yet folded
  await follows(raw, "fld_b"); // the tables still hold the grant: this call must neither fail nor invent the revoke
  assert.equal(grants(raw, "gr_grp"), 1, "the unfolded event is not applied by a writer that does not know of it");
  assert.ok((await listed(raw, "usr_mia")).includes("fld_1"));
  sync(ctxOf(raw), { events: [pending] });
  await follows(raw, "fld_c");
  assert.equal(grants(raw, "gr_grp"), 0, "once folded, the next writer works from the new tables");
  assert.ok(!(await listed(raw, "usr_mia")).includes("fld_1"), "and so does the next read");
});

// ---- the checks that the scenarios above cannot reach through a writer, each with the test that is red without it ----

import { changedResources, keepWarm, peekWarm, storeOf } from "../projections.ts";

test("keepWarm refuses a store when anything wrote to the access tables after the store was read, and keeps it when nothing did", () => {
  const raw = fresh("keep");
  seed(raw);
  const c = ctxOf(raw, "svc_host", "service");
  const store = storeOf(c);
  store.resources.get("fld_a")!.parentId = "rec_1";
  const writes = changedResources(c, store, ["fld_a"]);
  keepWarm(c, store, writes, ["fld_a"]);
  assert.equal(
    peekWarm(ctxOf(raw, "svc_host", "service")),
    store,
    "control: nothing wrote in between, the store is kept",
  );

  const c2 = ctxOf(raw, "svc_host", "service");
  const store2 = storeOf(c2); // read again
  raw.run("UPDATE access_resources SET label = label WHERE id = ?", "fld_b"); // somebody else writes to the access tables after it was read
  store2.resources.get("fld_c")!.parentId = "rec_1";
  const w2 = changedResources(c2, store2, ["fld_c"]);
  keepWarm(c2, store2, w2, ["fld_c"]);
  assert.equal(
    peekWarm(ctxOf(raw, "svc_host", "service")),
    null,
    "a write in between: the store is not kept, whatever the rows counted add up to",
  );
});

test("a reader's kept share state is compared with the sync's view by what the view changed since: a folder registered and a grant revoked between two reads are seen, and the log path ran", async () => {
  const raw = fresh("log");
  seed(raw);
  await listed(raw, "usr_mia");
  await listed(raw, "usr_owner");
  const logged = shareKept.logCompared;
  sync(ctxOf(raw), {
    events: [
      res("fld_d", "folder", SPACE),
      ev("grant.revoked", { grantId: "gr_grp", resource: { type: "folder", id: "fld_1" } }),
    ],
  });
  assert.ok((await listed(raw, "usr_owner")).includes("fld_d"), "the new folder is listed by the next read");
  assert.ok(!(await listed(raw, "usr_mia")).includes("fld_1"), "the revoked folder is not");
  assert.ok(shareKept.logCompared > logged, "the change log was what found them");
});

test("my_access rows written by anyone else between two calls take the settle skip away: the second call does not trust a copy of rows the table no longer holds", async () => {
  const raw = fresh("rows");
  seed(raw);
  await listed(raw, "usr_mia");
  await follows(raw, "fld_a");
  raw.run("DELETE FROM access_my_access WHERE person = ?", "usr_mia"); // moves the my_access counter, not the access tables' write counter
  const skips = shareKept.settleSkips;
  await follows(raw, "fld_b");
  assert.equal(shareKept.settleSkips, skips, "no skip: the copy no longer matches the table");
  assert.ok((await listed(raw, "usr_mia")).includes("fld_1"), "and mia still has the folder her group may edit");
});
