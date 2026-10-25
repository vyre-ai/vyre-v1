// Folder and sharing property test (ARCH 4.12 test 1): random folder trees, placements, moves, shares, unshares, deletes and group changes.
// After every step, for every person and every site and folder: my_access and access.lists equal an independent model of grants and ancestry,
// and agree with authorize. A refused operation changes nothing. The incremental refresh equals a full rebuild at the end of each run.
import test from "node:test";
import assert from "node:assert/strict";
import { authorize } from "../../../kernel/src/authorize/index.ts";
import {
  foldersCreate, foldersDelete, foldersMove, foldersPlace, foldersUnplace, lists, myAccess, share, shareOf, unshare,
} from "../handlers/share.ts";
import type { ShareCtx } from "../handlers/share.ts";
import { groupsAddMember, groupsRemoveMember, putPrincipal } from "../handlers/roles.ts";
import type { AccessStore, Db, Level } from "../projections.ts";
import { EVERYONE, storeOf } from "../projections.ts";

const NOW = 1_700_000_000_000;
const SEEDS = 40;
const STEPS = 35;
const PEOPLE = ["usr_admin", "usr_a", "usr_b", "usr_c"] as const;
const ORDER: readonly Level[] = ["view", "use", "edit", "manage"];

class SqlDb implements Db {
  tables = new Map<string, Record<string, unknown>[]>();
  all(sql: string): unknown[] {
    const rows = this.tables.get(/\bFROM\s+([A-Za-z0-9_]+)/i.exec(sql)?.[1] ?? "");
    if (!rows) throw new Error("no table");
    return rows.map((r) => ({ ...r }));
  }
  run(sql: string, ...args: unknown[]): { changes: number } {
    if (/^CREATE\s+/i.test(sql)) return { changes: 0 };
    const del = /^DELETE\s+FROM\s+([A-Za-z0-9_]+)(\s+WHERE\s+id\s*=\s*\?)?/i.exec(sql);
    if (del) {
      const rows = this.tables.get(del[1]!) ?? [];
      const keep = del[2] ? rows.filter((r) => r["id"] !== args[0]) : [];
      this.tables.set(del[1]!, keep);
      return { changes: rows.length - keep.length };
    }
    const ins = /^INSERT\s+INTO\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/i.exec(sql);
    if (!ins) throw new Error(`unsupported sql: ${sql}`);
    const row: Record<string, unknown> = {};
    ins[2]!.split(",").map((c) => c.trim()).forEach((c, i) => { row[c] = args[i] ?? null; });
    const list = this.tables.get(ins[1]!) ?? [];
    list.push(row);
    this.tables.set(ins[1]!, list);
    return { changes: 1 };
  }
}

function rng(seed: number) {
  let a = (seed * 2654435761) >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number): number => Math.floor(next() * n);
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)]!;
  const chance = (p: number): boolean => next() < p;
  return { int, pick, chance };
}

/** The effective level by walking parent links and reading grants, with none of the module's helpers. */
function model(store: AccessStore, person: string, id: string, now: number): Level | null {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = id;
  while (cur !== null) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const r = store.resources.get(cur);
    if (!r) return null;
    chain.push(r.id);
    cur = r.parentId;
  }
  if (store.resources.get(id)!.ownerId === person) return "manage";
  const groups = [...store.groups.values()].filter((g) => g.members.some((m) => m.id === person)).map((g) => g.id);
  const roles = new Set<string>([...store.rolesOf(person), ...groups.flatMap((g) => store.rolesOf(g))]);
  let best = -1;
  for (const g of store.grants.values()) {
    if (!chain.includes(g.resource.id)) continue;
    if (g.conditions.expiresAt !== undefined && g.conditions.expiresAt <= now) continue;
    const hit = g.subject.kind === "person" ? g.subject.id === person
      : g.subject.kind === "group" ? groups.includes(g.subject.id)
      : g.subject.kind === "role" ? roles.has(g.subject.id) : false;
    if (hit) best = Math.max(best, ORDER.indexOf(g.level));
  }
  return best < 0 ? null : ORDER[best]!;
}

/** Section of a row from first principles. */
function modelSection(store: AccessStore, spaceFolders: ReadonlySet<string>, person: string, id: string, now: number): "personal" | "shared" | "space" {
  const chain: string[] = [];
  let cur: string | null = id;
  while (cur !== null) { chain.push(cur); cur = store.resources.get(cur)?.parentId ?? null; }
  const owner = store.resources.get(id)!.ownerId === person;
  const groups = [...store.groups.values()].filter((g) => g.members.some((m) => m.id === person)).map((g) => g.id);
  const roles = new Set<string>([...store.rolesOf(person), ...groups.flatMap((g) => store.rolesOf(g))]);
  const kinds: ("direct" | "folder" | "space")[] = [];
  for (const g of store.grants.values()) {
    if (!chain.includes(g.resource.id)) continue;
    if (g.conditions.expiresAt !== undefined && g.conditions.expiresAt <= now) continue;
    const mine = g.subject.kind === "person" ? g.subject.id === person
      : g.subject.kind === "group" ? groups.includes(g.subject.id)
      : g.subject.kind === "role" ? roles.has(g.subject.id) : false;
    if (owner ? (g.subject.kind === "person" && g.subject.id === person) : !mine) continue;
    const onSelf = g.resource.id === id;
    if ((g.subject.kind === "group" && g.subject.id === EVERYONE) || (!onSelf && spaceFolders.has(g.resource.id))) kinds.push("space");
    else kinds.push(onSelf ? "direct" : "folder");
  }
  if (owner) return kinds.includes("space") ? "space" : kinds.length ? "shared" : "personal";
  return kinds.some((k) => k !== "space") ? "shared" : "space";
}

function codeOf(e: unknown): string {
  return (e as { error?: { code?: string } }).error?.code ?? "";
}

function stateOf(store: AccessStore, ctx: ShareCtx): string {
  const ss = shareOf(ctx);
  return JSON.stringify({
    g: [...store.grants.values()].map((g) => [g.id, g.level, g.subject, g.resource, g.conditions, g.source ?? null]).sort(),
    r: [...store.resources.values()].map((x) => [x.id, x.type, x.parentId, x.ownerId]).sort(),
    f: [...ss.folders.values()].map((f) => [f.id, f.name, f.parentId, f.scope]).sort(),
    p: [...ss.placement].sort(),
    v: [...ss.prev].sort(),
  });
}

test(`folders and sharing: effective access equals the grants through ${SEEDS} random worlds of ${STEPS} steps`, async () => {
  const seen = { via: new Set<string>(), ok: new Map<string, number>(), refused: 0, rows: 0 };
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = rng(seed);
    const db = new SqlDb();
    let clock = NOW;
    const ctx: ShareCtx = {
      space: "spc_test", principal: { kind: "person", id: "usr_admin" }, trace: { traceId: "0123456789abcdef0123456789abcdef" },
      now: () => clock, db, emit() { /* events are checked in share.test.ts */ },
    };
    const store = storeOf(ctx);
    const everyone = store.groups.get(EVERYONE)!;
    for (const id of PEOPLE) {
      putPrincipal(store, { id, kind: "person", name: id });
      store.setRoles(id, [id === "usr_admin" ? "rol_owner" : "rol_member"]);
      everyone.members.push({ kind: "person", id });
    }
    for (const gid of ["grp_g1", "grp_g2"]) {
      store.groups.set(gid, { id: gid, name: gid, builtIn: false, managers: [], members: PEOPLE.filter(() => r.chance(0.5)).map((id) => ({ kind: "person" as const, id })) });
    }
    const sites: string[] = [];
    for (let i = 0; i < 6; i++) {
      const id = `sit_${seed}_${i}`;
      sites.push(id);
      store.resources.set(id, { id, type: "site", parentId: null, label: "public", ownerId: r.pick(PEOPLE), holds: 0, row: { title: id } });
    }
    store.bump();
    const as = (id: string): ShareCtx => ({ ...ctx, principal: { kind: "person", id } });
    const ss = shareOf(ctx);

    const verify = async (where: string): Promise<void> => {
      const now = clock;
      const spaceFolders = new Set([...ss.folders.values()].filter((f) => f.scope === "space").map((f) => f.id));
      const snap = store.snapshot();
      for (const person of PEOPLE) {
        const rows = myAccess(ctx, person);
        const byKey = new Map(rows.map((x) => [`${x.type}:${x.id}`, x]));
        let expected = 0;
        for (const res of store.resources.values()) {
          if (res.type !== "site" && res.type !== "folder") continue;
          const want = model(store, person, res.id, now);
          const got = byKey.get(`${res.type}:${res.id}`);
          assert.equal(got?.level ?? null, want, `${where}: ${person} on ${res.id}`);
          const d = authorize(snap, { principal: person, action: { perm: null, level: "view" }, resource: { type: res.type, id: res.id }, now });
          assert.equal(d.effect === "allow", want !== null, `${where}: authorize agrees for ${person} on ${res.id}`);
          if (want !== null) {
            expected++;
            seen.rows++;
            seen.via.add(got!.via);
            if (res.type === "site") {
              const sec = got!.via === "owner" ? "personal" : got!.via === "space" ? "space" : "shared";
              assert.equal(sec, modelSection(store, spaceFolders, person, res.id, now), `${where}: section of ${res.id} for ${person}`);
            }
          }
        }
        assert.equal(rows.filter((x) => x.type === "site" || x.type === "folder").length, expected, `${where}: no extra rows for ${person}`);
        const listed = await lists(as(person), { type: "site" });
        assert.deepEqual(
          listed.rows.map((x) => x.id).sort(),
          [...store.resources.values()].filter((x) => x.type === "site" && model(store, person, x.id, now) !== null).map((x) => x.id).sort(),
          `${where}: lists for ${person}`,
        );
        assert.equal((listed.counts["personal"] ?? 0) + (listed.counts["shared"] ?? 0) + (listed.counts["space"] ?? 0), listed.rows.length, `${where}: counts add up`);
      }
      // every folder's resource row, folder record and placement agree
      for (const f of ss.folders.values()) {
        const res = store.resources.get(f.id)!;
        assert.equal(res.parentId, f.parentId, `${where}: folder parent`);
      }
      for (const [key, fid] of ss.placement) {
        const id = key.slice(key.indexOf(":") + 1);
        assert.equal(store.resources.get(id)?.parentId, fid, `${where}: placement of ${id}`);
        assert.ok(ss.folders.has(fid), `${where}: placement names a live folder`);
      }
    };

    await verify(`seed ${seed} start`);
    for (let step = 0; step < STEPS; step++) {
      const folders = [...ss.folders.keys()];
      const ownerOf = (id: string): string => store.resources.get(id)?.ownerId ?? r.pick(PEOPLE);
      /** Mostly the owner acts, so the interesting paths succeed; sometimes anyone, so the refusals are exercised too. */
      const actorFor = (id: string): ShareCtx => as(r.chance(0.75) ? ownerOf(id) : r.pick(PEOPLE));
      const op = r.int(10);
      const before = stateOf(store, ctx);
      let name = "";
      let actor = as(r.pick(PEOPLE));
      try {
        if (op <= 1) {
          name = "folders.create";
          const parent = folders.length && r.chance(0.5) ? r.pick(folders) : undefined;
          actor = parent ? actorFor(parent) : actor;
          await foldersCreate(actor, { type: "site", name: `F${step}${r.int(3)}`, ...(parent ? { parentId: parent } : {}), ...(!parent && r.chance(0.2) ? { scope: "space" as const } : {}) });
        } else if (op === 2 && folders.length) {
          name = "folders.place";
          const item = r.pick(sites);
          const mine = folders.filter((f) => ownerOf(f) === ownerOf(item));
          actor = actorFor(item);
          await foldersPlace(actor, { resource: { type: "site", id: item }, folderId: mine.length && r.chance(0.7) ? r.pick(mine) : r.pick(folders) });
        } else if (op === 3) {
          name = "folders.unplace";
          const item = r.pick(sites);
          actor = actorFor(item);
          await foldersUnplace(actor, { resource: { type: "site", id: item } });
        } else if (op === 4 && folders.length) {
          name = "folders.move";
          const f = r.pick(folders);
          const mine = folders.filter((x) => ownerOf(x) === ownerOf(f));
          actor = actorFor(f);
          await foldersMove(actor, { folderId: f, parentId: r.chance(0.3) ? null : mine.length && r.chance(0.7) ? r.pick(mine) : r.pick(folders) });
        } else if (op === 5 && folders.length && r.chance(0.3)) {
          name = "folders.delete";
          const f = r.pick(folders);
          actor = actorFor(f);
          await foldersDelete(actor, { folderId: f });
        } else if (op === 6 || op === 7) {
          name = "access.share";
          const resource = r.chance(0.5) && folders.length ? { type: "folder", id: r.pick(folders) } : { type: "site", id: r.pick(sites) };
          actor = actorFor(resource.id);
          const k = r.int(4);
          const subject = k === 0 ? { kind: "person" as const, id: r.pick(PEOPLE) }
            : k === 1 ? { kind: "group" as const, id: r.pick(["grp_g1", "grp_g2", EVERYONE]) }
            : k === 2 ? { kind: "role" as const, id: r.pick(["rol_member", "rol_guest"]) }
            : { kind: "person" as const, id: r.pick(PEOPLE) };
          await share(actor, {
            resource, subject, level: r.pick(ORDER),
            ...(r.chance(0.15) ? { conditions: { expiresAt: clock + 500 + r.int(2500) } } : {}),
          });
        } else if (op === 8) {
          name = "access.unshare";
          const grants = [...store.grants.values()].filter((g) => g.resource.id !== "*");
          if (grants.length) {
            const g = r.pick(grants);
            actor = as(r.chance(0.75) ? ownerOf(g.resource.id) : r.pick(PEOPLE));
            await unshare(actor, { grantId: g.id });
          } else name = "";
        } else {
          name = "tick";
          if (r.chance(0.5)) clock += 400 + r.int(1200);
          else {
            const g = r.pick(["grp_g1", "grp_g2"]);
            const member = { kind: "person" as const, id: r.pick(PEOPLE) };
            await (r.chance(0.5) ? groupsAddMember(ctx, { groupId: g, member }) : groupsRemoveMember(ctx, { groupId: g, member }));
          }
        }
        if (name) seen.ok.set(name, (seen.ok.get(name) ?? 0) + 1);
      } catch (e) {
        const c = codeOf(e);
        assert.ok(c.startsWith("permission.") || c.startsWith("validation."), `seed ${seed} step ${step} ${name}: unexpected error ${String(e)}`);
        assert.equal(stateOf(store, ctx), before, `seed ${seed} step ${step} ${name}: a refused ${name} changed something (${c})`);
        seen.refused++;
      }
      await verify(`seed ${seed} step ${step} ${name}`);
    }

    // the incremental cache equals a full rebuild, and the table holds exactly the cache
    const incremental = JSON.stringify([...ss.access.values()].sort((x, y) => (`${x.person}${x.type}${x.id}` < `${y.person}${y.type}${y.id}` ? -1 : 1)));
    const persisted = (db.tables.get("access_my_access") ?? []).length;
    assert.equal(persisted, ss.access.size, `seed ${seed}: table rows equal cache rows`);
    store.bump();
    myAccess(ctx, "usr_a");
    const rebuilt = JSON.stringify([...ss.access.values()].sort((x, y) => (`${x.person}${x.type}${x.id}` < `${y.person}${y.type}${y.id}` ? -1 : 1)));
    assert.equal(rebuilt, incremental, `seed ${seed}: incremental refresh equals a full rebuild`);
  }
  for (const k of ["folders.create", "folders.place", "folders.unplace", "folders.move", "access.share", "access.unshare"]) {
    assert.ok((seen.ok.get(k) ?? 0) >= 8, `${k} succeeded often enough to mean something (${seen.ok.get(k) ?? 0})`);
  }
  assert.ok((seen.ok.get("folders.delete") ?? 0) >= 1, "at least one folder was deleted");
  for (const v of ["owner", "grant", "folder", "space"]) assert.ok(seen.via.has(v), `the run reached via ${v}`);
  assert.ok(seen.refused > 20, "refusals were exercised");
});
