// kits publish and test runner (spec 2.21 "Tests", ARCH 10.4): a Kit version is tested on a seeded fixture Space before it can go live.
// kits.publish runs the same runner kits.yml runs in CI, on the host. A failing test blocks the publish: nothing is stored, the channel head does not move, the last good
// version stays live, and kit.publish_blocked says how many tests failed. A Kit with no tests cannot publish, and neither can a server with no fixture Space.
// Test kinds: "space" applies the Kit to a fresh fixture Space, makes the seed calls, then checks the events that happened and the views (capability reads) that follow;
// "script" runs one of the Kit's scripts in the sandbox against that Space and checks its result and its denials.
// Denials from real script runs go through runKitScript, which the host's script triggers call; it stores them for kits.denials and emits sandbox.denied with the trace id.

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import {
  checkKit, compareSemver, ensureCatalog, ensureDeclaredType, fail, headOf, isSemver, kitsConfig, many, mustKit, nid, num, pageOf, parseManifest, rec, reqStr, setHead, storeVersion, str, versionRow,
} from "./install.ts";
import type { FixtureSpace, KitChannel, KitManifest, KitStep, ScriptTest, SpaceTest } from "./install.ts";
import { runSandboxed } from "./sandbox.ts";
import type { SandboxResult } from "./sandbox.ts";

export interface TestFailure {
  test: string;
  message: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Every key of `want` is present in `have` with an equal value; objects and arrays compare the same way, so a partial row matches. */
export function subset(want: unknown, have: unknown): boolean {
  if (isObj(want)) return isObj(have) && Object.entries(want).every(([k, v]) => subset(v, have[k]));
  if (Array.isArray(want)) return Array.isArray(have) && want.every((w) => have.some((h) => subset(w, h)));
  return want === have;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

function errorText(e: unknown): string {
  const m = (e as { error?: { message?: unknown } } | null)?.error?.message ?? (e instanceof Error ? e.message : "failed");
  return String(m).slice(0, 200);
}

async function applyKit(space: FixtureSpace, kit: KitManifest): Promise<string | null> {
  for (const it of kit.items) {
    if (!it.apply && it.type !== "record_type") continue;
    try {
      if (it.apply) await space.call(it.apply.cap, it.apply.input);
      else await ensureDeclaredType((cap, input) => space.call(cap, input), it.recordType ?? it.key);
    } catch (e) {
      return `installing "${it.title}" failed: ${errorText(e)}`;
    }
  }
  return null;
}

async function seedSpace(space: FixtureSpace, steps: KitStep[] | undefined): Promise<string | null> {
  for (const s of steps ?? []) {
    try {
      await space.call(s.cap, s.input);
    } catch (e) {
      return `seed call ${s.cap} failed: ${errorText(e)}`;
    }
  }
  return null;
}

async function checkSpaceTest(space: FixtureSpace, t: SpaceTest): Promise<string[]> {
  const problems: string[] = [];
  const events = space.events();
  for (const want of t.expect.events ?? []) {
    if (!events.some((e) => e.name === want.name && (want.payload === undefined || subset(want.payload, e.payload)))) {
      problems.push(`expected the event ${want.name}${want.payload ? ` with ${JSON.stringify(want.payload)}` : ""}; saw ${events.map((e) => e.name).join(", ") || "no events"}`);
    }
  }
  for (const view of t.expect.views ?? []) {
    let out: unknown;
    try {
      out = await space.call(view.cap, view.input ?? {});
    } catch (e) {
      problems.push(`view ${view.cap} failed: ${errorText(e)}`);
      continue;
    }
    const rows: unknown[] = Array.isArray(out) ? out : isObj(out) ? (Object.values(out).find((v) => Array.isArray(v)) as unknown[] | undefined) ?? [] : [];
    if (view.rows !== undefined && rows.length !== view.rows) problems.push(`view ${view.cap} returned ${rows.length} rows, expected ${view.rows}`);
    if (view.contains !== undefined && !rows.some((r) => subset(view.contains, r))) problems.push(`view ${view.cap} has no row like ${JSON.stringify(view.contains)}`);
  }
  return problems;
}

async function checkScriptTest(space: FixtureSpace, kit: KitManifest, t: ScriptTest): Promise<string[]> {
  const script = (kit.scripts ?? []).find((s) => s.name === t.script);
  if (!script) return [`there is no script named ${t.script}`];
  const res = await runSandboxed({ source: script.source, input: t.input, caps: script.caps, call: (cap, input) => space.call(cap, input) });
  const problems: string[] = [];
  const wantDenied = t.expect.denied ?? [];
  for (const d of wantDenied) if (!res.denials.some((x) => x.includes(d))) problems.push(`expected a denial containing "${d}"; saw ${res.denials.join("; ") || "none"}`);
  if (wantDenied.length === 0 && res.denials.length > 0) problems.push(`unexpected sandbox denial: ${res.denials.join("; ")}`);
  // a denial mismatch already explains a failed run
  if (problems.length > 0) return problems;
  if (t.expect.error !== undefined) {
    if (res.ok || !(res.error ?? "").includes(t.expect.error)) problems.push(`expected the error "${t.expect.error}", got ${res.ok ? "a result" : `"${res.error}"`}`);
  } else if (!res.ok && wantDenied.length === 0) {
    problems.push(`the script failed: ${res.error}`);
  } else if (t.expect.value !== undefined && !deepEqual(res.value, t.expect.value)) {
    problems.push(`the script returned ${JSON.stringify(res.value)}, expected ${JSON.stringify(t.expect.value)}`);
  }
  return problems;
}

/** Runs every test of a Kit, each on its own fresh fixture Space. Returns the failures; none means the Kit passes. */
export async function runKitTests(kit: KitManifest, open: () => Promise<FixtureSpace>): Promise<TestFailure[]> {
  const tests = kit.tests ?? [];
  if (tests.length === 0) return [{ test: "(none)", message: "The Kit has no tests. Every Kit needs at least one before it can publish." }];
  const failures: TestFailure[] = [];
  for (const t of tests) {
    let space: FixtureSpace | null = null;
    try {
      space = await open();
      const applied = (await applyKit(space, kit)) ?? (t.kind === "space" ? await seedSpace(space, t.seed) : null);
      if (applied) {
        failures.push({ test: t.name, message: applied });
        continue;
      }
      const problems = t.kind === "space" ? await checkSpaceTest(space, t) : await checkScriptTest(space, kit, t);
      for (const p of problems) failures.push({ test: t.name, message: p });
    } catch (e) {
      failures.push({ test: t.name, message: `the test could not run: ${errorText(e)}` });
    } finally {
      if (space) await space.close().catch(() => undefined);
    }
  }
  return failures;
}

function fixtureOrFail(ctx: Ctx): () => Promise<FixtureSpace> {
  const open = kitsConfig()?.fixture;
  if (!open) fail(ctx, "validation.precondition_failed", "Kit tests cannot run on this server: there is no fixture Space. Nothing was published.");
  return open;
}

function recordRun(ctx: Ctx, kitId: string, version: string, failures: TestFailure[]): void {
  ctx.db.run("INSERT INTO kits_test_run (id, kit_id, version, passed, failures, at) VALUES (?, ?, ?, ?, ?, ?)", nid(ctx, "ktr"), kitId, version, failures.length === 0 ? 1 : 0, JSON.stringify(failures), ctx.now());
}

// ---- capabilities -------------------------------------------------------------------------------------------

async function testRun(ctx: Ctx, input: unknown): Promise<{ passed: boolean; failures: TestFailure[] }> {
  await ensureCatalog(ctx);
  const k = mustKit(ctx, reqStr(ctx, rec(ctx, input), "kitId"));
  const open = fixtureOrFail(ctx);
  const src = kitsConfig()?.source;
  const raw = (await src?.working(k.key)) ?? null;
  let kit: KitManifest;
  if (raw !== null) {
    const checked = checkKit(raw);
    if (!checked.kit) return { passed: false, failures: checked.problems.map((p) => ({ test: "(manifest)", message: p })) };
    kit = checked.kit;
  } else {
    const head = headOf(ctx, k.id, k.channel);
    if (!head) fail(ctx, "validation.precondition_failed", "This Kit has no working copy and no published version to test.");
    kit = parseManifest(head);
  }
  const failures = await runKitTests(kit, open);
  recordRun(ctx, k.id, kit.version, failures);
  return { passed: failures.length === 0, failures };
}

async function publish(ctx: Ctx, input: unknown): Promise<{ published: boolean }> {
  const o = rec(ctx, input);
  await ensureCatalog(ctx);
  const k = mustKit(ctx, reqStr(ctx, o, "kitId"));
  const version = reqStr(ctx, o, "version");
  const channel = reqStr(ctx, o, "channel");
  if (!isSemver(version)) fail(ctx, "validation.bad_input", "The version must look like 1.2.0.", { field: "version" });
  if (channel !== "stable" && channel !== "beta") fail(ctx, "validation.bad_input", "Choose stable or beta.", { field: "channel" });
  const open = fixtureOrFail(ctx);
  if (versionRow(ctx, k.id, version)) fail(ctx, "validation.precondition_failed", `Version ${version} is already published. Published versions never change; publish a new version.`);
  const head = headOf(ctx, k.id, channel);
  if (head && compareSemver(version, str(head.version)) <= 0) fail(ctx, "validation.precondition_failed", `The ${channel} channel is already at ${str(head.version)}. Publish a higher version.`);

  const raw = (await kitsConfig()?.source.read(k.key, version)) ?? null;
  if (raw === null) fail(ctx, "validation.precondition_failed", `There is no ${k.title} ${version} in the Kit folder to publish.`);
  const checked = checkKit(raw);
  if (!checked.kit) fail(ctx, "validation.bad_input", `The Kit is not valid: ${checked.problems.slice(0, 3).join("; ")}`, { problems: checked.problems.slice(0, 10) });
  const kit = checked.kit;
  if (kit.key !== k.key) fail(ctx, "validation.bad_input", `The folder is for "${kit.key}", not "${k.key}".`);
  if (kit.version !== version) fail(ctx, "validation.bad_input", `The folder holds version ${kit.version}, not ${version}.`);
  const published: KitManifest = { ...kit, channel: channel as KitChannel };

  const failures = await runKitTests(published, open);
  recordRun(ctx, k.id, version, failures);
  if (failures.length > 0) {
    ctx.emit("kit.publish_blocked", `kit/${k.id}`, { kitId: k.id, version, failures: failures.length });
    return { published: false };
  }
  const row = await storeVersion(ctx, k.id, published, ctx.principal.id);
  setHead(ctx, k.id, channel as KitChannel, str(row.id));
  ctx.db.run("UPDATE kits_kit SET updated_at = ? WHERE id = ?", ctx.now(), k.id);
  ctx.emit("kit.published", `kit/${k.id}`, { kitId: k.id, version });
  return { published: true };
}

async function health(ctx: Ctx, input: unknown): Promise<{ state: "healthy" | "degraded" | "down"; denials: number; lastTestAt?: number }> {
  const k = mustKit(ctx, reqStr(ctx, rec(ctx, input), "kitId"));
  const denials = many(ctx, "SELECT * FROM kits_denial WHERE kit_id = ?", k.id).filter((d) => ctx.now() - num(d.at) < 7 * 24 * 3600_000).length;
  // newest first; runs in the same millisecond keep the later insert first
  const runs = many(ctx, "SELECT * FROM kits_test_run WHERE kit_id = ?", k.id).reverse().sort((a, b) => num(b.at) - num(a.at));
  const last = runs[0];
  const state = last && num(last.passed) === 0 ? "down" : denials > 0 ? "degraded" : "healthy";
  return { state, denials, ...(last ? { lastTestAt: num(last.at) } : {}) };
}

async function denials(ctx: Ctx, input: unknown): Promise<{ denials: { at: number; what: string; traceId: string }[]; next?: string; total: number }> {
  const o = rec(ctx, input);
  const k = mustKit(ctx, reqStr(ctx, o, "kitId"));
  const { offset, limit } = pageOf(ctx, o);
  const rows = many(ctx, "SELECT * FROM kits_denial WHERE kit_id = ?", k.id).sort((a, b) => num(b.at) - num(a.at) || str(b.id).localeCompare(str(a.id)));
  const out: { denials: { at: number; what: string; traceId: string }[]; next?: string; total: number } = {
    denials: rows.slice(offset, offset + limit).map((r) => ({ at: num(r.at), what: str(r.what), traceId: str(r.trace_id) })), total: rows.length,
  };
  if (offset + limit < rows.length) out.next = String(offset + limit);
  return out;
}

// ---- running a Kit script for real -------------------------------------------------------------------------------

/** Records each denial for kits.denials and emits sandbox.denied with the trace id. Called by whatever runs a Kit script. */
export function reportDenials(ctx: Ctx, kitId: string, what: readonly string[]): void {
  for (const w of what) {
    ctx.db.run("INSERT INTO kits_denial (id, kit_id, at, what, trace_id) VALUES (?, ?, ?, ?, ?)", nid(ctx, "kdn"), kitId, ctx.now(), w, ctx.trace.traceId);
    ctx.emit("sandbox.denied", `kit/${kitId}`, { kitId, what: w, traceId: ctx.trace.traceId });
  }
}

/** Runs one script of an installed Kit as the caller. api.call goes through ctx.call, so the caller's access, the Gate and the audit apply. */
export async function runKitScript(ctx: Ctx, kitId: string, scriptName: string, input?: unknown): Promise<SandboxResult> {
  const k = mustKit(ctx, kitId);
  if (k.installedVersion === null) fail(ctx, "validation.precondition_failed", `${k.title} is not installed.`);
  const row = versionRow(ctx, k.id, k.installedVersion);
  const script = row ? (parseManifest(row).scripts ?? []).find((s) => s.name === scriptName) : undefined;
  if (!script) fail(ctx, "validation.not_found", `${k.title} has no script named ${scriptName}.`);
  const res = await runSandboxed({ source: script.source, input, caps: script.caps, call: (cap, i) => ctx.call(cap as never, i) });
  if (res.denials.length > 0) reportDenials(ctx, k.id, res.denials);
  return res;
}

export const publishHandlers = {
  "kits.test_run": (ctx: Ctx, input: unknown) => testRun(ctx, input),
  "kits.publish": (ctx: Ctx, input: unknown) => publish(ctx, input),
  "kits.health": (ctx: Ctx, input: unknown) => health(ctx, input),
  "kits.denials": (ctx: Ctx, input: unknown) => denials(ctx, input),
};
