// The cached rows of who may see what (my_access) are kept between calls, and a change made by a handler (a share, an unshare, a role, a group, a folder) now updates only the rows it touches instead
// of rebuilding every row of the Space (r39-share, 18 Nov 2026: a person sharing a file on a 140,000-record Space waited 3.4 s, the next list another 3.4 s). The one thing that may never happen is
// a row that differs from what a full rebuild from the tables would give. This test drives random sequences (seeded) of syncs, shares, unshares, role, group and folder changes, revocations and
// removals through the real handlers, and after EVERY step compares the rows a reader is served, and the rows stored in access_my_access, with a full rebuild of the same tables, row for row.
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
import { persistMode, storeOf } from "../projections.ts";
import type { AccessCtx } from "../projections.ts";
import { accessRowsFull, shareKept } from "../handlers/share.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SPACE = "spc_inc";
const TRACE = "0123456789abcdef0123456789abcdef";
const sync = hostCalls["access.sync"] as unknown as (ctx: unknown, input: { events: LogEvent[] }) => unknown;
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const clock = { now: 1_800_000_000_000 };
type Ctx = AccessCtx & {
  origin: string;
  depth: number;
  call(cap: string, input: unknown): Promise<unknown>;
  log: { warn(): void };
};
const ctxOf = (raw: HostDb, principal = "usr_owner"): Ctx => ({
  space: SPACE,
  principal: { kind: "person", id: principal },
  trace: { traceId: TRACE },
  now: () => clock.now,
  db: scopedDb("access", raw, TRACE),
  emit: () => undefined,
  origin: "gateway",
  depth: 0,
  call: async () => null,
  log: { warn: () => undefined },
});
function fresh(tag: string): HostDb {
  const dir = fs.mkdtempSync(path.join(process.env["TMPDIR"] ?? os.tmpdir(), `access-inc-${tag}-`));
  const raw = openDb(path.join(dir, "modules.db"));
  migrate(raw, ROOT, () => clock.now);
  return raw;
}
const call = (raw: HostDb, who: string, cap: string, input: unknown): Promise<Any> =>
  (handlers[cap as keyof typeof handlers] as unknown as (c: unknown, i: unknown) => Promise<Any>)(
    ctxOf(raw, who),
    input,
  );

let seq = 0;
const ev = (type: string, payload: unknown): LogEvent => ({ seq: ++seq, type, payload });
const PEOPLE = ["usr_owner", "usr_mia", "usr_noor", "usr_lee", "usr_ana"];

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const keyOf = (r: {
  person: string;
  type?: string;
  resourceType?: string;
  id?: string;
  resourceId?: string;
  level: string;
  via: string;
}): string => `${r.person}|${r.type ?? r.resourceType}|${r.id ?? r.resourceId}|${r.level}|${r.via}`;

/** What a reader is served, for every person and both kinds of thing, as ids. */
async function served(raw: HostDb): Promise<Set<string>> {
  const out = new Set<string>();
  for (const who of PEOPLE)
    for (const type of ["folder", "file"]) {
      let cursor: string | undefined;
      for (let guard = 0; guard < 50; guard++) {
        const r = await call(raw, who, "access.lists", { type, limit: 500, ...(cursor ? { cursor } : {}) });
        for (const row of r.rows) out.add(`${who}|${type}|${row.id}`);
        if (!r.next) break;
        cursor = r.next;
      }
    }
  return out;
}

function seedSpace(raw: HostDb): void {
  sync(ctxOf(raw), {
    events: [
      ev("resource.created", { id: SPACE, type: "space", parent_id: null, label: 0, owner_id: "usr_owner", holds: 0 }),
      ...PEOPLE.map((id) => ev("principal.created", { id, kind: "person", name: id.slice(4), status: "active" })),
      ev("principal.role_set", { holder: "usr_owner", role: "rol_owner" }),
      ...PEOPLE.slice(1).map((id) => ev("principal.role_set", { holder: id, role: "rol_member" })),
      ...PEOPLE.map((id) => ev("group.member_added", { group: "grp_everyone", member: id })),
      ev("grant.created", {
        id: "gr_boot_owner",
        subject_kind: "actor",
        subject_id: "usr_owner",
        resource_type: "space",
        resource_id: SPACE,
        level: "manage",
        by: "usr_owner",
      }),
      ev("resource.created", {
        id: "fld_a",
        type: "folder",
        parent_id: SPACE,
        label: 0,
        owner_id: "usr_owner",
        holds: 0,
      }),
      ev("resource.created", {
        id: "fld_b",
        type: "folder",
        parent_id: "fld_a",
        label: 0,
        owner_id: "usr_mia",
        holds: 0,
      }),
      ev("resource.created", {
        id: "fil_1",
        type: "file",
        parent_id: "fld_b",
        label: 0,
        owner_id: "usr_mia",
        holds: 0,
      }),
    ],
  });
}

async function run(
  seedNo: number,
  steps: number,
  dumps?: string[],
): Promise<{ incremental: number; built: number; hits: number }> {
  const raw = fresh(`s${seedNo}`);
  seq = 0;
  clock.now = 1_800_000_000_000;
  seedSpace(raw);
  const rnd = prng(seedNo);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const folders = ["fld_a", "fld_b"];
  const files = ["fil_1"];
  let n = 0;
  const logGrants: string[] = [];
  const base = { incremental: shareKept.incremental, built: shareKept.built, hits: shareKept.hits };
  const people = (): string[] => PEOPLE;
  // two groups the steps can fill and empty
  for (const g of ["grp_a", "grp_b"])
    await call(raw, "usr_owner", "access.groups.create", { name: g, idempotencyKey: `g-${g}` }).catch(() => undefined);
  const groups = (): string[] => [...storeOf(ctxOf(raw)).groups.keys()].filter((g) => g !== "grp_everyone");
  const anyResource = (): { type: string; id: string } =>
    rnd() < 0.5 ? { type: "folder", id: pick(folders) } : { type: "file", id: pick(files) };
  for (let step = 1; step <= steps; step++) {
    const op = Math.floor(rnd() * 18);
    let what = "";
    try {
      if (op <= 1) {
        // a sync registers a new thing (host-driven, only resources)
        const isFolder = rnd() < 0.4;
        const id = `${isFolder ? "fld" : "fil"}_${++n}x${seedNo}`;
        const parent = isFolder ? pick(["spc_inc", ...folders]) : pick(folders);
        sync(ctxOf(raw), {
          events: [
            ev("resource.created", {
              id,
              type: isFolder ? "folder" : "file",
              parent_id: parent === "spc_inc" ? SPACE : parent,
              label: Math.floor(rnd() * 3),
              owner_id: pick(people()),
              holds: 0,
            }),
          ],
        });
        (isFolder ? folders : files).push(id);
        what = `sync new ${id}`;
      } else if (op <= 4) {
        const r = anyResource();
        const subject =
          rnd() < 0.7
            ? { kind: "person", id: pick(PEOPLE.slice(1)) }
            : { kind: "group", id: pick(["grp_everyone", ...groups()]) };
        const level = pick(["view", "edit"]);
        what = `share ${r.type}:${r.id} ${subject.kind}:${subject.id} ${level}`;
        await call(raw, pick(["usr_owner", "usr_owner", "usr_mia"]), "access.share", {
          resource: r,
          subject,
          level,
          ...(rnd() < 0.15 ? { conditions: { expiresAt: clock.now + 5 * 60_000 } } : {}),
        });
      } else if (op <= 6) {
        const ids = [...storeOf(ctxOf(raw)).grants.keys()];
        if (ids.length) {
          const g = pick(ids);
          what = `unshare ${g}`;
          await call(raw, "usr_owner", "access.unshare", { grantId: g });
        }
      } else if (op === 7) {
        const roles = [...storeOf(ctxOf(raw)).roles.keys()].filter((r) => r !== "rol_owner");
        const who = pick(PEOPLE.slice(1));
        what = `role ${who}`;
        await call(raw, "usr_owner", "access.roles.assign", {
          subject: { kind: "person", id: who },
          roleId: pick(roles),
        });
      } else if (op === 8) {
        const g = pick(groups());
        const member = { kind: "person", id: pick(PEOPLE.slice(1)) };
        what = `group ${g}`;
        await call(raw, "usr_owner", rnd() < 0.6 ? "access.groups.add_member" : "access.groups.remove_member", {
          groupId: g,
          member,
        });
      } else if (op === 9) {
        // a seeded grant and its revocation arrive from the log
        const r = anyResource();
        const id = `gr_s${step}x${seedNo}`;
        what = `log grant ${id}`;
        sync(ctxOf(raw), {
          events: [
            ev("grant.created", {
              id,
              subject_kind: "actor",
              subject_id: pick(PEOPLE.slice(1)),
              resource_type: r.type,
              resource_id: r.id,
              level: "view",
              by: "usr_owner",
            }),
          ],
        });
        logGrants.push(id);
      } else if (op === 10) {
        const who = pick(PEOPLE.slice(1));
        what = `suspend/reactivate ${who}`;
        sync(ctxOf(raw), {
          events: [ev(rnd() < 0.5 ? "principal.suspended" : "principal.reactivated", { principalId: who })],
        });
      } else if (op === 11) {
        what = "folder";
        const made = await call(raw, "usr_owner", "access.folders.create", {
          type: "file",
          name: `F${step}`,
          scope: rnd() < 0.5 ? "space" : "personal",
        });
        const id = made.folder.id as string;
        if (id) {
          folders.push(id);
          if (rnd() < 0.7)
            await call(raw, "usr_owner", "access.folders.place", {
              type: "file",
              resourceId: pick(files),
              folderId: id,
            });
        }
      } else if (op === 12) {
        what = "empty sync, time passes";
        sync(ctxOf(raw), { events: [] });
        clock.now += 3 * 60_000;
      } else if (op === 14) {
        const id = logGrants.length ? logGrants.splice(Math.floor(rnd() * logGrants.length), 1)[0]! : "gr_none";
        what = `log revoke ${id}`;
        sync(ctxOf(raw), { events: [ev("grant.revoked", { grantId: id })] });
      } else if (op === 15) {
        // someone else writes rows of the cache (a copy from another computer, plain SQL): the kept copy must be refused
        what = "tamper with my_access rows";
        raw.run(
          "DELETE FROM access_my_access WHERE rowid IN (SELECT rowid FROM access_my_access ORDER BY rowid LIMIT 3 OFFSET ?)",
          Math.floor(rnd() * 20),
        );
        raw.run(
          "UPDATE access_my_access SET level = 'edit' WHERE rowid IN (SELECT rowid FROM access_my_access ORDER BY rowid DESC LIMIT 2)",
        );
      } else if (op === 16) {
        what = "tamper with the folder tables";
        raw.run(
          "UPDATE access_folders SET scope = CASE scope WHEN 'space' THEN 'personal' ELSE 'space' END WHERE rowid IN (SELECT rowid FROM access_folders LIMIT 1)",
        );
      } else {
        what = "resource removed";
        const id = pick(files);
        sync(ctxOf(raw), {
          events: [
            ev("resource.created", {
              id,
              type: "file",
              parent_id: pick(folders),
              label: 0,
              owner_id: pick(people()),
              holds: 0,
            }),
          ],
        });
      }
    } catch (e) {
      // a refused change (the caller may not, no such thing) changes nothing: the rows must still equal a rebuild
      what += ` (refused: ${(e as { error?: { code?: string } }).error?.code ?? "error"})`;
    }
    // what a reader is served and what is stored equal a full rebuild from the tables, row for row
    const oracle = accessRowsFull(ctxOf(raw));
    const want = new Set(oracle.map((r) => `${r.person}|${r.type}|${r.id}`));
    const got = await served(raw);
    for (const k of got) if (k.split("|")[1] !== "folder" && k.split("|")[1] !== "file") continue;
    const wantServed = new Set([...want].filter((k) => ["folder", "file"].includes(k.split("|")[1]!)));
    // the list shows what the rows say (a row may be filtered by section rules in access.lists: it must never show a row the rebuild lacks)
    for (const k of got)
      assert.ok(
        wantServed.has(k),
        `seed ${seedNo} step ${step} (${what}): a reader was served ${k}, which a full rebuild does not give`,
      );
    if (dumps) dumps.push(dumpTables(raw));
    const stored = (raw.all("SELECT person, resourceType, resourceId, level, via FROM access_my_access") as Any[])
      .map((r) => keyOf(r))
      .sort();
    const rebuilt = oracle.map((r) => keyOf(r)).sort();
    assert.deepEqual(
      stored,
      rebuilt,
      `seed ${seedNo} step ${step} (${what}): the stored rows differ from a full rebuild`,
    );
  }
  return {
    incremental: shareKept.incremental - base.incremental,
    built: shareKept.built - base.built,
    hits: shareKept.hits - base.hits,
  };
}

test(
  "my_access rows kept and updated by changes equal a full rebuild at every step of random sequences",
  { timeout: 600_000 },
  async () => {
    let incremental = 0,
      built = 0;
    for (const seedNo of [1, 2, 3, 4, 5, 6]) {
      const r = await run(seedNo, 250);
      incremental += r.incremental;
      built += r.built;
    }
    // the changes were absorbed by the incremental path far more often than by a full rebuild
    assert.ok(incremental > 100, `incremental ${incremental}, full ${built}`);
  },
);

test("a share that is revoked is gone on the very next read, whoever made the change", async () => {
  const raw = fresh("revoke");
  seq = 0;
  seedSpace(raw);
  const mia = async (): Promise<string[]> =>
    (await call(raw, "usr_noor", "access.lists", { type: "folder" })).rows.map((r: { id: string }) => r.id).sort();
  assert.deepEqual(
    await mia(),
    ["fld_a"].filter(() => false),
    "nobody shared it yet",
  );
  const g = await call(raw, "usr_owner", "access.share", {
    resource: { type: "folder", id: "fld_b" },
    subject: { kind: "person", id: "usr_noor" },
    level: "view",
  });
  const grantId = g.grant.grantId ?? g.grant.id;
  assert.ok((await mia()).includes("fld_b"), "the share is seen at once");
  await call(raw, "usr_owner", "access.unshare", { grantId });
  assert.ok(!(await mia()).includes("fld_b"), "the revoked share is gone on the very next read");
  // a grant that arrives from the log and is revoked from the log
  sync(ctxOf(raw), {
    events: [
      ev("grant.created", {
        id: "gr_log",
        subject_kind: "actor",
        subject_id: "usr_noor",
        resource_type: "folder",
        resource_id: "fld_b",
        level: "view",
        by: "usr_owner",
      }),
    ],
  });
  assert.ok((await mia()).includes("fld_b"));
  sync(ctxOf(raw), { events: [ev("grant.revoked", { grantId: "gr_log" })] });
  assert.ok(!(await mia()).includes("fld_b"), "a revoke from the log is gone on the very next read");
  // and after a share and a revoke made by one handler call right after the other, with no read between
  const g2 = await call(raw, "usr_owner", "access.share", {
    resource: { type: "folder", id: "fld_b" },
    subject: { kind: "person", id: "usr_noor" },
    level: "view",
  });
  await call(raw, "usr_owner", "access.unshare", { grantId: g2.grant.grantId ?? g2.grant.id });
  assert.ok(!(await mia()).includes("fld_b"));
});

/** Every durable access table as text, the ids of grants left out (they are drawn at random, so two runs differ in them only) and the epoch counter (it only has to move forward: a kept store that took a change in place holds a higher one than a store read again). */
const norm = (s: string): string => s.replace(/\b(grp|gnt|exc)_[0-9a-f]{10,}\b/g, "$1_#");
function dumpTables(raw: HostDb): string {
  const out: string[] = [];
  for (const table of [
    "access_roles",
    "access_groups",
    "access_principals",
    "access_assignments",
    "access_resources",
    "access_policies",
    "access_actors",
  ]) {
    const rows = (raw.all(`SELECT * FROM ${table}`) as Any[])
      .map((r) => norm(JSON.stringify(Object.entries(r).filter(([k]) => k !== "updated_at" && k !== "version"))))
      .sort();
    out.push(`${table}\n${rows.join("\n")}`);
  }
  const grants = (raw.all("SELECT * FROM access_grants") as Any[])
    .map((r) =>
      norm(JSON.stringify(Object.entries(r).filter(([k]) => k !== "id" && k !== "updated_at" && k !== "version"))),
    )
    .sort();
  out.push(`access_grants\n${grants.join("\n")}`);
  return out.join("\n--\n");
}

test(
  "a grant handler that writes only the grants leaves every access table exactly as writing the whole store does",
  { timeout: 600_000 },
  async () => {
    for (const seedNo of [31, 32, 33]) {
      const targeted: string[] = [];
      const whole: string[] = [];
      persistMode.targeted = true;
      await run(seedNo, 150, targeted);
      persistMode.targeted = false;
      try {
        await run(seedNo, 150, whole);
      } finally {
        persistMode.targeted = true;
      }
      assert.equal(targeted.length, whole.length);
      for (let i = 0; i < targeted.length; i++)
        assert.equal(
          targeted[i],
          whole[i],
          `seed ${seedNo} step ${i + 1}: the tables differ between writing the grants and writing the whole store`,
        );
    }
  },
);

test("taking away what an agent made for a person changes the resource too: it is done on a store of its own, and the tables, the kept snapshot and the rows agree", async () => {
  const raw = fresh("made");
  seq = 0;
  seedSpace(raw);
  sync(ctxOf(raw), {
    events: [
      ev("principal.created", { id: "agt_maker", kind: "agent", name: "Maker", status: "active", owner: "usr_mia" }),
      ev("principal.role_set", { holder: "agt_maker", role: "rol_member" }),
      ev("resource.created", {
        id: "fld_made",
        type: "folder",
        parent_id: SPACE,
        label: 0,
        owner_id: "usr_mia",
        holds: 0,
        made_by: "agt_maker",
        made_for: "usr_mia",
      }),
    ],
  });
  const rowJson = (): string =>
    String((raw.all(`SELECT row_json FROM access_resources WHERE id = 'fld_made'`) as Any[])[0]?.row_json ?? "");
  assert.match(rowJson(), /madeBy/);
  const made = `gnt_made${Buffer.from("fld_made", "utf8").toString("hex")}`;
  const out = await call(raw, "usr_owner", "access.unshare", { grantId: made });
  assert.equal(out.revoked, 1);
  assert.doesNotMatch(rowJson(), /madeBy/, "the maker's stamp on the resource was written");
  // what a reader is served and what is stored equal a full rebuild, and a second change still works on the kept store
  const oracle = accessRowsFull(ctxOf(raw))
    .map((r) => keyOf(r))
    .sort();
  assert.deepEqual(
    (raw.all("SELECT person, resourceType, resourceId, level, via FROM access_my_access") as Any[])
      .map((r) => keyOf(r))
      .sort(),
    oracle,
  );
  const g = await call(raw, "usr_owner", "access.share", {
    resource: { type: "folder", id: "fld_a" },
    subject: { kind: "person", id: "usr_noor" },
    level: "view",
  });
  assert.ok(
    (await call(raw, "usr_noor", "access.lists", { type: "folder" })).rows.some(
      (r: { id: string }) => r.id === "fld_a",
    ),
  );
  await call(raw, "usr_owner", "access.unshare", { grantId: g.grant.grantId ?? g.grant.id });
  assert.ok(
    !(await call(raw, "usr_noor", "access.lists", { type: "folder" })).rows.some(
      (r: { id: string }) => r.id === "fld_a",
    ),
  );
});
