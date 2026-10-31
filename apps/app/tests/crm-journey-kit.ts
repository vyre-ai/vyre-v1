// The pieces the five CRM-to-Records journeys share (apps/app/tests/crm.journeys.live.test.ts): a daemon started in this process the way a person's computer or a Team server runs it, with the app's
// production export on one origin, a fake CRM behind the connector network seam (a real HTTP server, the Link header and webhooks included), a model stand-in that does what the crm-sync-builder skill
// tells an agent to do (it reads real pages through the discovery tools and fills the spec), and screenshots at every step in light and dark, desktop and phone.
// Nothing in the daemon is faked except the two outside things: the app (the fake CRM) and the model vendor (the stand-in).
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DriverEvent, EngineSession, OpenSession, ToolResult, TurnInput } from "../../../agent/src/turn-engine/types.ts";
import { fakePlatform } from "../../../host/src/platform/index.ts";
import type { FetchFn } from "../../../host/src/platform/probes.ts";
import { loadConfig } from "../../../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../../../host/src/daemon/daemon.ts";
import type { Daemon } from "../../../host/src/daemon/daemon.ts";
import { startFakeCrm } from "../../../test/support/fake-crm-server.ts";
import type { FakeCrm } from "../../../test/support/fake-crm-server.ts";
import { edge } from "./real-app-harness.test.ts";
import type { Edge } from "./real-app-harness.test.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export const KEY_TEXT = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake

export interface Space { d: Daemon; dir: string; web: Edge; crm: FakeCrm; model: ModelState; stop(): Promise<void> }
export interface ModelState { plan: Plan | null; log: string[] }
type Plan = { spec: Record<string, unknown>; summary: string };

export async function startSpace(o: { kind: "personal" | "team"; name: string; address?: string }): Promise<Space> {
  const dist = process.env["VYRE_APP_DIST"] ?? "";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vyre-crm-journey-${o.kind}-`));
  const crm = await startFakeCrm();
  const model: ModelState = { plan: null, log: [] };
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space-name", o.name, "--space-kind", o.kind, ...(o.address ? ["--address", o.address] : [])], {}, "1.2.3"), codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: `crm-${o.kind}`, free: 80e9, commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    } }),
    fetch: caddyFetch,
    connectorNetwork: { resolve: async () => ["93.184.216.34"], request: async (url, req) => { const r = await crm.fetch(url.toString(), { method: req.method, headers: req.headers, ...(req.body !== undefined ? { body: req.body } : {}) }); return { status: r.status, text: await r.text(), ...(r.link ? { link: r.link } : {}) }; } },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    vault: { secret: async () => KEY_TEXT, signRs256: async () => "" },
    engineOpenSession: syncBuilderModel(model),
  });
  const web = await edge(dist, d.url);
  return { d, dir, web, crm, model, stop: async () => { web.close(); await d.stop(); await crm.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

/** A capability over HTTP as the owner (the same door the CLI and the Console use). */
export async function api(s: Space, cap: string, input: Record<string, unknown> = {}, token = s.d.token): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${s.d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ idempotencyKey: `j-${cap}-${Math.random().toString(36).slice(2)}`, ...input }) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}
export async function ok(s: Space, cap: string, input: Record<string, unknown> = {}, token?: string): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await api(s, cap, input, token);
  if (r.status !== 200) throw new Error(`${cap}: ${JSON.stringify(r.data).slice(0, 300)}`);
  return r.data;
}

/** The person's Claude account (the stand-in answers for it): unlocked Vault and a connected subscription, as in Settings. */
export async function connectAi(s: Space): Promise<void> {
  const unlock = await fetch(`${s.d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${s.d.token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
  if (unlock.status !== 204) throw new Error(`unlock ${unlock.status}`);
  const folder = (await ok(s, "vault.folders.create", { name: "Accounts", scope: "mine" })).folder.id as string;
  const flow = await ok(s, "providers.subscription_start", { providerKey: "claude-code" });
  await ok(s, "vault.item.put", { folderId: folder, name: "Claude setup", kind: "ai_subscription", fields: [{ key: "setup_token", value: KEY_TEXT, secret: true }] });
  const provider = (await ok(s, "providers.subscription_complete", { flowId: flow.flowId })).provider;
  await ok(s, "providers.set_space_use", { providerId: provider.id, allow: true });
  await ok(s, "engine.pool.status");
}

/** The permissions an admin gives the assistant for this work (agents never hold Owner or Admin). */
export async function trustAssistant(s: Space): Promise<string> {
  const agents = (await ok(s, "agents.list", {})).agents as { agentId: string; name: string }[];
  const agentId = agents.find((a) => /assistant/i.test(a.name))?.agentId ?? (await ok(s, "agents.create", { name: "Assistant", role: "You are the person's assistant." })).agent.agentId as string;
  const roles = (await ok(s, "access.roles.list", {})).roles as { id: string; name: string; builtIn: boolean; permissions: string[] }[];
  const member = roles.find((r) => r.builtIn && /member/i.test(r.name)) ?? roles.find((r) => r.builtIn && !/owner|admin/i.test(r.name))!;
  const role = (await ok(s, "access.roles.create", { name: "CRM sync builder", cloneFrom: member.id, assignableToAgents: true })).role as { id: string; permissions: string[] };
  const wanted = [...new Set([...role.permissions, "connectors.manage", "schema.manage"])];
  const preview = await ok(s, "access.roles.preview", { roleId: role.id, permissions: wanted });
  await ok(s, "access.roles.apply", { roleId: role.id, permissions: wanted, previewHash: preview.previewHash });
  await ok(s, "access.roles.assign", { subject: { kind: "agent", id: agentId }, roleId: role.id });
  return agentId;
}

// ---- the model stand-in: the crm-sync-builder skill, as a deterministic script

type Use = (name: string, input: unknown) => AsyncGenerator<DriverEvent, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const leaf = (p: string): string => p.split("/").pop() ?? p;
const title = (s: string): string => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
function readPath(doc: unknown, pointer: string): unknown {
  let cur: unknown = doc;
  for (const k of pointer.slice(1).split("/")) { if (cur === null || typeof cur !== "object") return undefined; cur = (cur as Record<string, unknown>)[k]; }
  return cur;
}
function choicesFrom(preview: string | undefined): Map<string, { value: string; label?: string }[]> {
  const out = new Map<string, { value: string; label?: string }[]>();
  if (!preview) return out;
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v === null || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const name = (o["key"] ?? o["name"]) as string | undefined;
    if (typeof name === "string" && Array.isArray(o["options"])) out.set(name, (o["options"] as unknown[]).map((x) => (typeof x === "string" ? { value: x } : { value: String((x as { value: unknown }).value), ...((x as { label?: string }).label ? { label: (x as { label: string }).label } : {}) })));
    Object.values(o).forEach(walk);
  };
  try { walk(JSON.parse(preview)); } catch { /* too long for a preview: no choices to read */ }
  return out;
}

export interface Know {
  name: string; domain: string; handle: string; auth: { style: "bearer" | "header"; header?: string };
  objects: { remote: string; path: string; label: string; recordType: string; write?: { path: string; evidence: string } }[];
  fieldsEndpoint?: string; account?: string; filter?: { remote: string; param: string; value: string; words: string }; query?: Record<string, Record<string, string>>;
  webhook?: { remote: string; subscribePath: string; evidence: string };
}

/** Read real pages through the discovery tools and fill the spec, the way the skill tells an agent to. */
export async function* fillSpec(use: Use, know: Know): AsyncGenerator<DriverEvent, Record<string, unknown>> {
  const auth = { vaultHandle: know.handle, ...know.auth };
  const base = { auth, domain: know.domain };
  const seen = new Map<string, any>();   // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const o of know.objects) seen.set(o.remote, (yield* use("sync_specs_sample", { ...base, path: o.path, query: know.query?.[o.remote] ?? {}, items: 10 })).data);
  const choices = know.fieldsEndpoint ? choicesFrom((yield* use("sync_specs_sample", { ...base, path: know.fieldsEndpoint })).data?.preview) : new Map();
  const idsOf = new Map<string, Set<string>>();
  for (const o of know.objects) { const l = seen.get(o.remote).shape.lists[0]; idsOf.set(o.remote, new Set((seen.get(o.remote).items as Record<string, unknown>[]).map((it) => String(readPath(it, l.idAt ?? "/id"))))); }
  const objects: Record<string, unknown>[] = [];
  const mapping: Record<string, unknown>[] = [];
  for (const o of know.objects) {
    const s = seen.get(o.remote);
    const l = s.shape.lists[0];
    let cursor: Record<string, unknown> = { kind: "none" };
    if (s.nextLink) cursor = { kind: "link", size: l.count, sizeParam: "limit" };
    else if (s.shape.cursors[0]) cursor = { kind: "cursor", param: "after", next: s.shape.cursors[0].pointer };
    else {
      const p2 = (yield* use("sync_specs_sample", { ...base, path: o.path, query: { ...(know.query?.[o.remote] ?? {}), page: "2", per_page: String(l.count) } })).data;
      const first2 = p2?.items?.[0] as Record<string, unknown> | undefined;
      if (p2?.ok && first2 && String(readPath(first2, l.idAt ?? "/id")) !== String(readPath((s.items as Record<string, unknown>[])[0]!, l.idAt ?? "/id"))) cursor = { kind: "page", param: "page", size: l.count, sizeParam: "per_page" };
    }
    const filter = know.filter?.remote === o.remote ? { param: know.filter.param, value: know.filter.value } : undefined;
    const fields = l.fields.filter((f: { seen: number; path: string }) => f.seen > 0 && f.path !== (l.idAt ?? "/id")).map((f: { path: string; type: string }) => {
      const values = (s.items as Record<string, unknown>[]).map((it) => readPath(it, f.path)).filter((v) => v !== null && v !== undefined);
      const target = know.objects.find((t) => t.remote !== o.remote && values.length > 0 && values.every((v) => idsOf.get(t.remote)!.has(String(v))));
      const pick = choices.get(leaf(f.path));
      return { path: f.path, label: title(leaf(f.path)), ...(target && f.type !== "date" ? { type: "relation", relationTo: target.remote } : pick ? { type: "choice", choices: pick } : { type: f.type }), ...(/(modified|updated|created)/.test(leaf(f.path)) ? { readOnly: true } : {}) };
    });
    objects.push({
      remote: o.remote, label: o.label, ...(s.estimate ? { count: s.estimate.count } : {}), id: l.idAt ?? "/id", itemsAt: l.itemsAt, ...(l.updatedAtGuess ? { updatedAt: l.updatedAtGuess } : {}),
      list: { path: o.path, ...(know.query?.[o.remote] ? { query: know.query[o.remote] } : {}), cursor, ...(filter ? { filter } : {}) },
      ...(o.write ? { update: { path: o.write.path, method: "PATCH", evidence: o.write.evidence } } : {}), ...(know.webhook?.remote === o.remote ? { webhook: { events: ["updated"], subscribePath: know.webhook.subscribePath, evidence: know.webhook.evidence } } : {}), fields,
    });
    const status = (fields as { path: string; type: string }[]).find((f) => f.type === "choice" && /status|stage/.test(f.path));
    const email = (fields as { path: string; type: string }[]).find((f) => f.type === "email");
    mapping.push({
      remote: o.remote, recordType: o.recordType, title: o.label,
      fields: (fields as { path: string; type: string }[]).map((f) => ({ path: f.path, field: ((k) => (k === "name" || k === "title" ? k : k === o.recordType ? `${k}_value` : k))(leaf(f.path).replace(/^full_/, "").replace(/_id$/, "").replace(/[^a-z0-9_]/g, "_")), direction: f.type === "relation" || !o.write ? "pull" : "both" })),
      ...(status ? { stagesFrom: status.path } : {}), ...(email ? { match: [email.path] } : {}),
    });
  }
  return { app: { name: know.name, domain: know.domain, ...(know.account ? { account: know.account } : {}) }, auth, objects, mapping, plan: { firstPull: { words: know.filter?.words ?? "Everything" }, backfill: "later", conflicts: "newest" } };
}

/** What the person typed that starts the sync, from the openings the app sends or plain words. */
export const KNOW: { current: Know | null } = { current: null };

export function syncBuilderModel(state: ModelState): OpenSession {
  return async () => {
    const waiting = new Map<string, (r: ToolResult) => void>();
    let n = 0;
    const run = async function* (name: string, input: unknown): AsyncGenerator<DriverEvent, ToolResult> {
      const id = `call_${++n}`;
      const answer = new Promise<ToolResult>((resolve) => waiting.set(id, resolve));
      state.log.push(name);
      yield { type: "tool_call", id, name, input };
      return answer;
    };
    const use: Use = async function* (name, input) { const r = yield* run(name, input); return (r.content ?? {}) as any; };   // eslint-disable-line @typescript-eslint/no-explicit-any
    return {
      warm: true,
      async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
        const said = input.trigger?.body ?? "";
        const know = KNOW.current;
        if (know && /records/i.test(said) && /(bring|sync)/i.test(said) && !state.plan) {
          const spec = yield* fillSpec(use, know);
          const v = yield* use("sync_specs_preview", { spec });
          if (v.data?.ok !== true) { yield { type: "text", text: `The spec has problems: ${JSON.stringify(v.data?.problems ?? v).slice(0, 300)}` }; yield { type: "done" }; return; }
          state.plan = { spec, summary: v.data.summary };
          yield* use("ask_question", {
            threadId: input.thread?.id, prompt: `${v.data.summary} Go?`, mode: "single",
            options: [{ key: "go", label: "Looks good" }, { key: "dir", label: "Change direction" }, { key: "fields", label: "Show me fields" }],
          });
        } else if (state.plan && /looks good/i.test(said)) {
          const out = yield* use("sync_specs_apply", { spec: state.plan.spec, idempotencyKey: `apply-${Date.now()}` });
          state.plan = null;
          yield { type: "text", text: out.data?.types ? `Done. ${out.data.types.map((t: { type: string }) => t.type).join(", ")} are in Records and filling in. Live by ${out.data.live}.` : `That failed: ${JSON.stringify(out).slice(0, 300)}` };
        } else yield { type: "text", text: "Tell me which app to bring into Records." };
        yield { type: "done" };
      },
      sendToolResult(id: string, r: ToolResult) { waiting.get(id)?.(r); waiting.delete(id); },
      inject() {}, async cancel() {}, async close() {},
    } as EngineSession;
  };
}

// ---- screenshots

export interface Shots { dir: string; n: number; take(page: Pg, name: string): Promise<void> }
interface Pg { screenshot(o: { path: string }): Promise<unknown>; setViewportSize(s: { width: number; height: number }): Promise<void>; emulateMedia(o: { colorScheme: "light" | "dark" }): Promise<void>; waitForTimeout(ms: number): Promise<void> }

/** One step, four pictures: desktop light and dark, phone light and dark. The page is put back where it was. */
export function shots(dir: string, journey: string): Shots {
  const out = path.join(dir, journey);
  fs.mkdirSync(out, { recursive: true });
  const s: Shots = { dir: out, n: 0, async take(page, name) {
    s.n++;
    const label = `${String(s.n).padStart(2, "0")}-${name}`;
    for (const [vp, w, h] of [["desktop", 1280, 800], ["phone", 390, 780]] as const) for (const mode of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: mode });
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(out, `${label}-${vp}-${mode}.png`) });
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForTimeout(250);
  } };
  return s;
}

export function hostErrors(d: Daemon): string {
  d.sink.flush();
  const rows = new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT level, place, cap, msg, attrs FROM logs WHERE level >= 40 AND msg NOT LIKE '%grants on an agent%' AND msg NOT LIKE '%neighbour%' ORDER BY id DESC LIMIT 20").all() as { level: number; place?: string; cap?: string; msg: string; attrs?: string }[];
  return rows.map((r) => `${r.level} ${r.place ?? ""} ${r.cap ?? ""} ${r.msg} ${String(r.attrs ?? "").slice(0, 200)}`).join("\n");
}
