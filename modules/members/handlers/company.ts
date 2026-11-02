// Connect your company (company.*): one flow for Google Workspace or Microsoft 365. It lives in members because sign-in and the directory are what it starts from. The connectors, the sign-in policy and the Vault already hold the truth, so this holds only where the flow stands (migrations/0001_company.sql) and reads
// the rest live. That is why it survives a restart and never asks for what it knows. Every change goes through the capability that owns it; the two that change the company declare connection_change, so a person with the
// right role decides. Secrets never come here: the person's own screen puts them in the Vault, and this module only ever names a handle.
import { readFileSync } from "node:fs";
import { DOC_PAGE, FLOW_STEPS, PROVIDER_TITLE, docSection, nextStep } from "../../../lib/company-flow.ts";
import type { CompanyProvider, StepId } from "../../../lib/company-flow.ts";
import { GOOGLE_KEY_HANDLE, MICROSOFT_KEY_HANDLE } from "../../../lib/company-keys.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import { googleScript, microsoftScript } from "./company-scripts.ts";
import type { Data } from "./company-scripts.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";

type Row = Record<string, unknown>;
const FLOW = "company";
const HOUR = 3_600_000;
const SWEEP_EVERY = 6 * HOUR;

const obj = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const flowOf = (ctx: Ctx): Row | null => (ctx.db.all(`SELECT * FROM members_company_flow WHERE id = ?`, FLOW)[0] as Row | undefined) ?? null;
const dataOf = (f: Row | null): Data => ({ mail: !f || f["dataMail"] === 1, calendar: !f || f["dataCalendar"] === 1, files: !f || f["dataFiles"] === 1 });
const bad = (ctx: Ctx, message: string): never => { throw fail("validation.precondition_failed", ctx.trace.traceId, { message }); };
const quiet = async (ctx: Ctx, cap: string, input: unknown): Promise<Row | null> => { try { return obj(await ctx.call(cap as never, input)); } catch { return null; } };

/** A call failing in status means this person cannot see that part yet, or it is not set up: never a broken flow. */
async function facts(ctx: Ctx, provider: CompanyProvider) {
  const conn = await quiet(ctx, provider === "google" ? "google.dwd.status" : "ms.consent.status", {});
  const sso = await quiet(ctx, "members.sso.list", {});
  const policy = await quiet(ctx, "members.sign_in_policy.get", {});
  const providerRow = arr(sso?.["providers"]).map(obj).find((p) => p["key"] === provider) ?? null;
  return { conn, sso: providerRow, policy: obj(policy?.["policy"]), caps: obj(policy?.["capabilities"]) };
}

async function statusOf(ctx: Ctx) {
  const f = flowOf(ctx);
  const provider = f ? (f["provider"] as CompanyProvider) : undefined;
  if (!provider) return { started: false, providers: (["google", "microsoft"] as const).map((key) => ({ key, title: PROVIDER_TITLE[key] })) };
  const { conn, sso, policy, caps } = await facts(ctx, provider);
  const data = conn && conn["configured"] === true ? (obj(conn["data"]) as unknown as Data) : dataOf(f);
  const google = provider === "google";
  const stored = typeof f!["keyCheckedAt"] === "number" || conn?.[google ? "keyStored" : "appStored"] === true;
  const configured = conn?.["configured"] === true;
  const checked = google ? conn?.["lastProbeOk"] === true : conn?.["consentGiven"] === true;
  const connected = typeof f!["connectedAt"] === "number";
  const done = new Set<StepId>(["choose"]);
  if (sso?.["enabled"] === true) done.add("signin_app");
  if (caps["ownerSsoLinked"] === true) done.add("signin_try");
  if (policy["requireSso"] === true) done.add("signin_require");
  if (stored) done.add("access_key");
  if (configured && (google ? checked : conn?.["consentGiven"] === true)) done.add("access_allow");
  if (!google && conn?.["policyConfirmed"] === true) done.add("access_limit");
  if (typeof f!["probedAt"] === "number") done.add("access_probe");
  if (typeof f!["peopleAt"] === "number" || connected) done.add("people");
  if (connected) done.add("confirm");
  const redirect = str(obj(await quiet(ctx, google ? "google.user.app_status" : "ms.user.app_status", {}))["redirectUri"]);
  const origin = redirect ? new URL(redirect).origin : undefined;
  const out: Row = {
    started: true, provider, title: PROVIDER_TITLE[provider], data, doc: DOC_PAGE[provider],
    steps: FLOW_STEPS[provider].map((s) => ({ id: s.id, title: s.title, doc: s.doc, done: done.has(s.id), ...(s.optional ? { optional: true } : {}) })),
    requireSso: policy["requireSso"] === true, signInOn: sso?.["enabled"] === true, signInTried: caps["ownerSsoLinked"] === true, recoveryKey: caps["ownerHasRecovery"] === true, keyHandle: google ? GOOGLE_KEY_HANDLE : MICROSOFT_KEY_HANDLE, connected,
    mapped: typeof conn?.["mappedMembers"] === "number" ? conn["mappedMembers"] : 0, excluded: arr(conn?.["excluded"]).filter((x): x is string => typeof x === "string"),
  };
  const next = nextStep(provider, done);
  if (next) out["next"] = next.id;
  if (origin) { out["space"] = origin; out["redirect"] = `${origin}/auth/sso/${provider}/callback`; }
  const clientId = str(conn?.["clientId"]) ?? str(f!["clientId"]);
  if (clientId) out["clientId"] = clientId;
  if (str(f!["accountEmail"])) out["who"] = f!["accountEmail"];
  if (str(sso?.["domainHint"])) out["domain"] = sso!["domainHint"];
  if (str(conn?.["tenantId"])) out["tenant"] = conn!["tenantId"];
  if (typeof f!["connectedAt"] === "number") out["connectedAt"] = f!["connectedAt"];
  if (str(f!["lastSweepLine"])) out["lastSweep"] = f!["lastSweepLine"];
  if (str(f!["probeLine"])) out["probeLine"] = f!["probeLine"];
  return out;
}

export async function companyStatus(ctx: Ctx) { return statusOf(ctx); }

/** Starts the flow, or picks it up where it stands. A second start with another provider changes nothing once a provider is connected. */
export async function companyStart(ctx: Ctx, input: { provider: CompanyProvider; data?: Data }) {
  const f = flowOf(ctx);
  const data = input.data ?? dataOf(f);
  if (!data.mail && !data.calendar && !data.files) bad(ctx, "Choose at least one of Mail, Calendar and Files.");
  if (f && typeof f["connectedAt"] === "number" && f["provider"] !== input.provider) bad(ctx, `${PROVIDER_TITLE[f["provider"] as CompanyProvider]} is connected. Disconnect it first.`);
  if (f) ctx.db.run(`UPDATE members_company_flow SET provider = ?, "dataMail" = ?, "dataCalendar" = ?, "dataFiles" = ? WHERE id = ?`, input.provider, data.mail ? 1 : 0, data.calendar ? 1 : 0, data.files ? 1 : 0, FLOW);
  else ctx.db.run(`INSERT INTO members_company_flow (id, provider, "dataMail", "dataCalendar", "dataFiles", "startedBy", "startedAt") VALUES (?, ?, ?, ?, ?, ?, ?)`, FLOW, input.provider, data.mail ? 1 : 0, data.calendar ? 1 : 0, data.files ? 1 : 0, ctx.actingFor ?? ctx.principal.id, ctx.now());
  return statusOf(ctx);
}

/** The guide for a step, or all of it: the doc page itself, so the screen, Assistant and the docs say the same thing. */
export async function companyGuide(ctx: Ctx, input: { provider: CompanyProvider; section?: string }) {
  const page = readFileSync(new URL(`../guides/${DOC_PAGE[input.provider]}.md`, import.meta.url), "utf8");
  const text = input.section === undefined ? page : docSection(page, input.section);
  if (text === null) throw fail("validation.not_found", ctx.trace.traceId, { message: "There is no such section in the guide." });
  return { text };
}

export async function companyScript(ctx: Ctx, input: { provider: CompanyProvider }) {
  const f = flowOf(ctx);
  const data = dataOf(f);
  if (input.provider === "google") return { shell: "Google Cloud Shell", url: "https://console.cloud.google.com/cloudshell", script: googleScript(data) };
  const status = await statusOf(ctx);
  const perms = arr(obj(await quiet(ctx, "ms.consent.status", {}))["permissions"]).filter((p): p is string => typeof p === "string");
  return { shell: "Azure Cloud Shell", url: "https://shell.azure.com/bash", script: microsoftScript(data, str(obj(status)["redirect"]), perms) };
}

/** The key is in the Vault: prove it now, with no person involved. What is wrong comes back as words; what is right is remembered, so this is never asked again. The value never comes here. */
export async function companyCheck(ctx: Ctx) {
  const f = flowOf(ctx);
  if (!f) return bad(ctx, "Start Connect your company first.");
  const google = f["provider"] === "google";
  const out = obj(await ctx.call((google ? "google.dwd.check_key" : "ms.consent.check_app") as never, { vaultItem: google ? GOOGLE_KEY_HANDLE : MICROSOFT_KEY_HANDLE }));
  const ok = out["ok"] === true;
  ctx.db.run(`UPDATE members_company_flow SET "keyCheckedAt" = ?, "clientId" = ?, "accountEmail" = ? WHERE id = ?`, ok ? ctx.now() : null, ok ? str(out["clientId"]) ?? null : null, ok ? str(out["clientEmail"]) ?? null : null, FLOW);
  return { ok, ...(str(out["problem"]) ? { problem: out["problem"] } : {}), ...(str(out["clientId"]) ? { clientId: out["clientId"] } : {}), ...(str(out["clientEmail"]) ? { who: out["clientEmail"] } : {}), ...(str(out["tenantId"]) ? { tenantId: out["tenantId"] } : {}), ...(str(out["credential"]) ? { credential: out["credential"] } : {}) };
}

/** A person has looked at who is in. Nothing else changes: this only moves the flow on, and it keeps moving if someone is excluded later. */
export async function companyPeopleDone(ctx: Ctx) {
  ctx.db.run(`UPDATE members_company_flow SET "peopleAt" = ? WHERE id = ?`, ctx.now(), FLOW);
  return statusOf(ctx);
}

function passed(ctx: Ctx, line: string) {
  ctx.db.run(`UPDATE members_company_flow SET "probedAt" = ?, "probeLine" = ? WHERE id = ?`, ctx.now(), line, FLOW);
  return { ok: true, line };
}

/** The read-only check, as one line a person can act on. It reads whether Google or Microsoft will answer, never anyone's content. */
export async function companyProbe(ctx: Ctx) {
  const f = flowOf(ctx);
  if (!f) return bad(ctx, "Start Connect your company first.");
  if (f["provider"] === "google") {
    const out = obj(await ctx.call("google.dwd.probe" as never, {}));
    const missing = arr(out["scopesMissing"]).filter((s): s is string => typeof s === "string").map((s) => s.slice(s.lastIndexOf("/") + 1));
    if (out["ok"] === true) return passed(ctx, `Google answered for ${str(out["email"]) ?? "the admin"}. Every scope is allowed.`);
    if (missing.length) return { ok: false, line: `Not allowed yet in Google Admin: ${missing.join(", ")}. It can take up to 24 hours, usually much less.`, missing };
    return { ok: false, line: str(out["detail"]) ?? "Google did not accept the check." };
  }
  const out = obj(await ctx.call("ms.consent.verify" as never, {}));
  if (out["ok"] === true) return passed(ctx, str(out["detail"]) ?? "Microsoft answered. Consent is given and the app can reach your members' mailboxes.");
  return { ok: false, line: str(out["detail"]) ?? "Microsoft did not accept the check." };
}

/** The one confirmation: everyone included comes in, and the directory is watched from here on. Delegation is already proved by the probe, so this reads and writes only Vyre's own side, and the first pulls run after it. */
export async function companyConnect(ctx: Ctx, input: { idempotencyKey: string }) {
  const f = flowOf(ctx);
  if (!f) return bad(ctx, "Start Connect your company first.");
  const google = f["provider"] === "google";
  const status = obj(await quiet(ctx, google ? "google.dwd.status" : "ms.consent.status", {}));
  if (status["configured"] !== true) return bad(ctx, `${PROVIDER_TITLE[f["provider"] as CompanyProvider]} is not set up yet. Finish the steps above.`);
  const made = obj(await ctx.call((google ? "google.dwd.connect_all" : "ms.consent.connect_all") as never, { idempotencyKey: `${input.idempotencyKey}:all` }));
  const now = ctx.now(), at = now + SWEEP_EVERY;
  ctx.db.run(`UPDATE members_company_flow SET "connectedAt" = ?, "nextSweepAt" = ? WHERE id = ?`, now, at, FLOW);
  await ctx.schedule(at, "company.sweep" as never, {});
  return { connected: typeof made["connected"] === "number" ? made["connected"] : 0, included: typeof made["included"] === "number" ? made["included"] : 0 };
}

/** Undo: everything stops at once. What already came in stays with its owner. Sign-in stays as it is: taking it away is a separate choice and an owner's. */
export async function companyDisconnect(ctx: Ctx) {
  const f = flowOf(ctx);
  if (!f) return { disconnected: false };
  await ctx.call((f["provider"] === "google" ? "google.dwd.disable" : "ms.consent.disable") as never, {});
  ctx.db.run(`UPDATE members_company_flow SET "connectedAt" = NULL, "nextSweepAt" = NULL WHERE id = ?`, FLOW);
  return { disconnected: true };
}

/** Runs on a schedule, and on a person's press when a large change was held. One chain only: a queued sweep that finds itself early or turned off stops. */
export async function companySweep(ctx: Ctx, input: { confirmed?: boolean }) {
  const f = flowOf(ctx);
  if (!f || typeof f["connectedAt"] !== "number") return { checked: 0, gone: [] };
  const now = ctx.now();
  let line: string;
  let out: Row = {};
  try {
    out = obj(await ctx.call((f["provider"] === "google" ? "google.directory.reconcile" : "ms.directory.reconcile") as never, input.confirmed === true ? { confirmed: true } : {}));
    const gone = arr(out["gone"]);
    line = str(out["held"]) ?? (gone.length ? `${gone.length} ${gone.length === 1 ? "person" : "people"} left the directory and lost access.` : `Directory checked: ${String(out["checked"] ?? 0)} people.`);
  } catch (e) {
    line = "The directory could not be read, so nobody was changed. It will be tried again.";
    ctx.log.warn("company sweep failed", { error: e instanceof Error ? e.name : "unknown" });
  }
  ctx.db.run(`UPDATE members_company_flow SET "lastSweepAt" = ?, "lastSweepLine" = ? WHERE id = ?`, now, line, FLOW);
  const planned = typeof f["nextSweepAt"] === "number" ? f["nextSweepAt"] : 0;
  if (planned <= now) {
    const at = now + SWEEP_EVERY;
    ctx.db.run(`UPDATE members_company_flow SET "nextSweepAt" = ? WHERE id = ?`, at, FLOW);
    await ctx.schedule(at, "company.sweep" as never, {});
  }
  return { checked: typeof out["checked"] === "number" ? out["checked"] : 0, gone: arr(out["gone"]).filter((x): x is string => typeof x === "string"), ...(str(out["held"]) ? { held: out["held"] } : {}) };
}

/** Who reached whose mail, calendar or files, whatever the provider. */
export async function companyAccessLog(ctx: Ctx, input: { cursor?: string; limit?: number; mailbox?: string }) {
  const f = flowOf(ctx);
  if (!f) return { entries: [] };
  return obj(await ctx.call((f["provider"] === "google" ? "google.access_log" : "ms.access_log") as never, input));
}

export const companyHandlers = {
  "company.status": (ctx: Ctx) => companyStatus(ctx),
  "company.start": (ctx: Ctx, i: Parameters<typeof companyStart>[1]) => companyStart(ctx, i),
  "company.script": (ctx: Ctx, i: Parameters<typeof companyScript>[1]) => companyScript(ctx, i),
  "company.guide": (ctx: Ctx, i: Parameters<typeof companyGuide>[1]) => companyGuide(ctx, i),
  "company.check": (ctx: Ctx) => companyCheck(ctx),
  "company.people_done": (ctx: Ctx) => companyPeopleDone(ctx),
  "company.probe": (ctx: Ctx) => companyProbe(ctx),
  "company.connect": (ctx: Ctx, i: Parameters<typeof companyConnect>[1]) => companyConnect(ctx, i),
  "company.disconnect": (ctx: Ctx) => companyDisconnect(ctx),
  "company.sweep": (ctx: Ctx, i: Parameters<typeof companySweep>[1]) => companySweep(ctx, i),
  "company.access_log": (ctx: Ctx, i: Parameters<typeof companyAccessLog>[1]) => companyAccessLog(ctx, i),
};
