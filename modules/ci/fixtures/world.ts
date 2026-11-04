// A Space's CI in one process: a real SQLite database behind the host's table guard for ci_* tables, a clock, a fake cloud (droplets that can be created, listed and deleted), and stand-ins for the
// github, projects and git modules. No real cloud or GitHub call is ever made.
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { consumers, handlers } from "../impl.ts";
import { sweep } from "../handlers/runner.ts";
import { setCiHost } from "../projections.ts";
import type { CiCtx, CiHost, Db } from "../projections.ts";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
export const ADMIN = "usr_admin", MAYA = "usr_maya";
/** Tue 3 Nov 2026, 10:00 in Karachi. */
export const T0 = Date.UTC(2026, 10, 3, 5, 0);
export const MIN = 60_000, HOUR = 3_600_000, DAY = 24 * HOUR;
export interface Caller { id: string; kind?: "person" | "service"; admin?: boolean }
export const admin: Caller = { id: ADMIN, kind: "person", admin: true };
export const maya: Caller = { id: MAYA, kind: "person" };
export const host: Caller = { id: "svc_host", kind: "service" };

export interface FakeDroplet { id: string; created_at: string; tags: string[]; user_data: string; name: string; size: string }
export interface Fakes {
  /** repos linked to projects: "owner/name" (lower case) -> project id */
  links?: Record<string, string>;
  /** people (other than the admin) who are in a project */
  members?: Record<string, string[]>;
  secrets?: number | null;
}

export function world(f: Fakes = {}) {
  const sqlite = new DatabaseSync(":memory:");
  const raw: Db = { all: (sql, ...a) => sqlite.prepare(sql).all(...(a.map((x) => (x === undefined ? null : x)) as never[])), run: (sql, ...a) => ({ changes: Number(sqlite.prepare(sql).run(...(a.map((x) => (x === undefined ? null : x)) as never[])).changes) }) };
  const db = scopedDb("ci", raw, "0123456789abcdef0123456789abcdef") as Db;
  const st = {
    now: T0, events: [] as Array<{ name: string; subject: string; payload: Record<string, any> }>,   // eslint-disable-line @typescript-eslint/no-explicit-any
    droplets: [] as FakeDroplet[], nextId: 1000, cloudCalls: [] as Array<{ method: string; path: string }>, keysUsed: [] as string[], jit: [] as Array<Record<string, unknown>>, removed: [] as number[],
    secrets: f.secrets === undefined ? 0 : f.secrets, links: f.links ?? { "northwind/site": "prj_site" }, members: f.members ?? {},
    links_: [] as Array<Record<string, unknown>>, noLinkCap: false, failCreate: 0, failList: false, failDelete: false, jitFails: false, runnerSeq: 1,
  };
  const cloud: CiHost = {
    async cloud(_ctx, handle, req) {
      st.keysUsed.push(handle);
      st.cloudCalls.push({ method: req.method, path: req.path });
      const json = (status: number, body: unknown) => ({ status, text: JSON.stringify(body) });
      if (req.method === "POST" && req.path === "/v2/droplets") {
        if (st.failCreate) return json(st.failCreate, { message: "no" });
        const b = req.body as { name: string; size: string; tags: string[]; user_data: string };
        const d: FakeDroplet = { id: String(st.nextId++), created_at: new Date(st.now).toISOString(), tags: b.tags, user_data: b.user_data, name: b.name, size: b.size };
        st.droplets.push(d);
        return json(202, { droplet: { id: Number(d.id) } });
      }
      if (req.method === "GET" && req.path === "/v2/droplets") {
        if (st.failList) return json(500, {});
        return json(200, { droplets: st.droplets.filter((d) => d.tags.includes(String(req.query?.["tag_name"]))).map((d) => ({ id: Number(d.id), created_at: d.created_at, tags: d.tags })) });
      }
      const del = /^\/v2\/droplets\/(\d+)$/.exec(req.path);
      if (req.method === "DELETE" && del) {
        if (st.failDelete) return json(500, {});
        const i = st.droplets.findIndex((d) => d.id === del[1]);
        if (i < 0) return json(404, {});
        st.droplets.splice(i, 1);
        return json(204, {});
      }
      return json(404, {});
    },
  };
  setCiHost(cloud);
  const ctxFor = (who: Caller): CiCtx => ({
    space: "spc_test", principal: { kind: who.kind ?? "person", id: who.id }, trace: { traceId: "0123456789abcdef0123456789abcdef" }, now: () => st.now, db,
    emit: (name, subject, payload) => { st.events.push({ name, subject, payload: payload as Record<string, never> }); return { id: "evt" }; },
    log: { info: () => undefined, warn: () => undefined },
    authorize: () => ({ effect: who.admin || who.kind === "service" ? "allow" : "deny" }),
    call: async (cap, input) => {
      const i = input as Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
      if (cap === "github.runners.jit_config") {
        if (st.jitFails) throw Object.assign(new Error("x"), { error: { code: "provider.auth_failed" } });
        st.jit.push(i);
        return { runnerId: 7000 + st.runnerSeq++, jitConfig: "eyJhbGciOiJIUzI1NiJ9abc123==" };
      }
      if (cap === "github.runners.remove") { st.removed.push(i["runnerId"]); return { removed: true }; }
      if (cap === "projects.links.link") { if (st.noLinkCap) throw new Error("no cap"); st.links_.push(i); return { link: {} }; }
      if (cap === "github.actions.secrets") return { count: st.secrets };
      if (cap === "projects.list") {
        return { projects: Object.values(st.links).map((projectId) => ({ projectId })).filter((p) => who.admin || who.kind === "service" || (st.members[p.projectId] ?? []).includes(who.id)) };
      }
      if (cap === "projects.get") {
        const ok = who.admin || who.kind === "service" || (st.members[i["projectId"]] ?? []).includes(who.id);
        if (!ok) throw Object.assign(new Error("no"), { error: { code: "permission.no_grant" } });
        return { project: { projectId: i["projectId"], folderId: `fld_${i["projectId"]}` } };
      }
      if (cap === "git.status") {
        const projectId = String(i["folderId"]).slice(4), repo = Object.entries(st.links).find(([, p]) => p === projectId)?.[0];
        return { remotes: repo ? [{ name: "origin", url: `https://github.com/${repo}.git` }] : [] };
      }
      throw new Error(`no ${cap}`);
    },
  });
  const call = async (cap: string, input: Record<string, unknown> = {}, who: Caller = admin): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const h = (handlers as Record<string, (c: CiCtx, i: never) => unknown>)[cap];
    if (!h) throw new Error(`no handler ${cap}`);
    return await h(ctxFor(who), input as never);
  };
  /** The admin turns runners on with a key and a cap. */
  const turnOn = (o: Record<string, unknown> = {}) => call("ci.settings.set", { enabled: true, vaultKeyRef: "#Northwind_DO", monthlyCapUsd: 10, ...o });
  const job = (action: "queued" | "completed", o: { jobId: number; repo?: string; labels?: string[]; fork?: "no" | "yes" | "unknown"; conclusion?: string }) =>
    consumers["ci.workflow_job"].run(ctxFor(host), { name: `workflow_job.${action}`, payload: { repo: o.repo ?? "northwind/site", jobId: o.jobId, runId: 500 + o.jobId, name: "build", labels: o.labels ?? ["self-hosted", "vyre"], fork: o.fork ?? "no", ...(o.conclusion ? { conclusion: o.conclusion } : {}) } });
  const sweepNow = () => sweep(ctxFor(host));
  const named = (n: string) => st.events.filter((e) => e.name === n);
  return { state: st, call, ctxFor, db, turnOn, job, sweepNow, named, advance(ms: number) { st.now += ms; } };
}
