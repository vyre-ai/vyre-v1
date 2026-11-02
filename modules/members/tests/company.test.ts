// Connect your company: one flow whose state survives a restart, never asks twice, holds no secret, and hands every change to the capability that owns it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { companyHandlers } from "../handlers/company.ts";
import { googleScript, microsoftScript } from "../handlers/company-scripts.ts";
import { COMPANY_INTENT, FLOW_STEPS, nextStep } from "../../../lib/company-flow.ts";
import { isCompanyKey } from "../../../lib/company-keys.ts";
import { registry } from "../../../generated/registry.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
const NOW = 1_760_000_000_000;
type Answers = Record<string, unknown | ((input: unknown) => unknown)>;

function world(answers: Answers = {}, raw = fresh()) {
  const calls: { cap: string; input: unknown }[] = [];
  const scheduled: { at: number; cap: string; input: unknown }[] = [];
  const ctx = {
    principal: { kind: "person", id: "usr_owner" }, trace: { traceId: "0".repeat(32) }, now: () => NOW, log: { warn() {} },
    db: { all: (sql: string, ...a: unknown[]) => raw.prepare(sql).all(...(a as never[])), run: (sql: string, ...a: unknown[]) => raw.prepare(sql).run(...(a as never[])) },
    async call(cap: string, input: unknown) {
      calls.push({ cap, input });
      if (!(cap in answers)) throw new Error(`nothing answers ${cap}`);
      const a = answers[cap];
      return typeof a === "function" ? (a as (i: unknown) => unknown)(input) : a;
    },
    async schedule(at: number, cap: string, input: unknown) { scheduled.push({ at, cap, input }); return "sch_1"; },
  } as never;
  return { ctx, calls, scheduled, raw };
}
function fresh() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(readFileSync(new URL("../migrations/0002_company.sql", import.meta.url), "utf8"));
  return raw;
}
const contract = (cap: string, out: unknown): void => {
  const def = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0]!;
  assert.deepEqual(validate(def.output, out, "", registry.$defs), [], cap);
};
const google = { "google.dwd.status": { configured: false, keyStored: false, data: { mail: true, calendar: true, files: true } }, "google.user.app_status": { configured: false, redirectUri: "https://acme.vyre.run/auth/google/callback" } };

test("before it starts it offers the two providers; started, it names the steps and the one next thing", async () => {
  const h = world(google);
  const before = await companyHandlers["company.status"](h.ctx);
  assert.deepEqual(before, { started: false, providers: [{ key: "google", title: "Google Workspace" }, { key: "microsoft", title: "Microsoft 365" }] });
  contract("company.status", before);
  const out = await companyHandlers["company.start"](h.ctx, { provider: "google", data: { mail: true, calendar: false, files: true } }) as Record<string, unknown>;
  contract("company.start", out);
  assert.equal(out["next"], "access_key");
  assert.deepEqual(out["data"], { mail: true, calendar: false, files: true });
  assert.equal(out["redirect"], "https://acme.vyre.run/auth/sso/google/callback");
  assert.equal(out["doc"], "connect-google-workspace");
  assert.equal(out["keyHandle"], "#Google_DWD");
});

test("it survives a restart and never asks for what it knows", async () => {
  const first = world(google);
  await companyHandlers["company.start"](first.ctx, { provider: "google", data: { mail: true, calendar: false, files: false } });
  const after = world({ ...google, "google.dwd.status": { configured: true, keyStored: true, lastProbeOk: true, clientId: "123", data: { mail: true, calendar: false, files: false }, mappedMembers: 4, excluded: ["kim@firm.test"] }, "members.sso.list": { providers: [{ key: "google", enabled: true }] } }, first.raw);
  const out = await companyHandlers["company.status"](after.ctx) as { next?: string; steps: { id: string; done: boolean }[]; mapped: number; excluded: string[] };
  assert.deepEqual(out.steps.filter((s) => s.done).map((s) => s.id), ["choose", "access_key", "access_allow", "signin_app"]);
  assert.equal(out.next, "signin_try");
  assert.deepEqual([out.mapped, out.excluded], [4, ["kim@firm.test"]]);
  const again = await companyHandlers["company.start"](after.ctx, { provider: "google" }) as { data: unknown };
  assert.deepEqual(again.data, { mail: true, calendar: false, files: false }, "starting again keeps what was chosen");
});

test("nothing chosen is refused, and a connected provider must be disconnected before the other", async () => {
  const h = world({ ...google, "google.dwd.status": { configured: true, data: { mail: true, calendar: true, files: true } }, "google.dwd.connect_all": { connected: 2, included: 2 } });
  await assert.rejects(companyHandlers["company.start"](h.ctx, { provider: "google", data: { mail: false, calendar: false, files: false } }), /at least one/);
  await companyHandlers["company.start"](h.ctx, { provider: "google" });
  await companyHandlers["company.connect"](h.ctx, { idempotencyKey: "c1" });
  await assert.rejects(companyHandlers["company.start"](h.ctx, { provider: "microsoft" }), /Google Workspace is connected/);
});

test("the one confirmation connects the included people and starts watching the directory; Undo stops everything", async () => {
  const h = world({ ...google, "google.dwd.status": { configured: true, data: { mail: true, calendar: true, files: true } }, "google.dwd.connect_all": { connected: 3, included: 3 }, "google.dwd.disable": { disabled: true } });
  await assert.rejects(companyHandlers["company.connect"](world(google).ctx, { idempotencyKey: "x" }), /Start Connect your company/);
  await companyHandlers["company.start"](h.ctx, { provider: "google" });
  assert.deepEqual(await companyHandlers["company.connect"](h.ctx, { idempotencyKey: "c1" }), { connected: 3, included: 3 });
  assert.deepEqual(h.scheduled.map((s) => s.cap), ["company.sweep"]);
  assert.equal((await companyHandlers["company.status"](h.ctx) as { connected: boolean }).connected, true);
  assert.deepEqual(await companyHandlers["company.disconnect"](h.ctx), { disconnected: true });
  assert.equal((await companyHandlers["company.status"](h.ctx) as { connected: boolean }).connected, false);
  assert.deepEqual(await companyHandlers["company.sweep"](h.ctx, {}), { checked: 0, gone: [] }, "a queued sweep after Undo does nothing");
});

test("connecting needs the provider set up first", async () => {
  const h = world(google);
  await companyHandlers["company.start"](h.ctx, { provider: "google" });
  await assert.rejects(companyHandlers["company.connect"](h.ctx, { idempotencyKey: "c1" }), /not set up yet/);
});

test("the sweep keeps one chain, says what it did, and a failure changes nothing", async () => {
  let answer: unknown = { checked: 9, gone: ["sam@firm.test"] };
  const h = world({ ...google, "google.dwd.status": { configured: true, data: { mail: true, calendar: true, files: true } }, "google.dwd.connect_all": { connected: 1, included: 1 }, "google.directory.reconcile": () => { if (answer instanceof Error) throw answer; return answer; } });
  await companyHandlers["company.start"](h.ctx, { provider: "google" });
  await companyHandlers["company.connect"](h.ctx, { idempotencyKey: "c1" });
  assert.equal((await companyHandlers["company.sweep"](h.ctx, {}) as { gone: string[] }).gone.length, 1);
  assert.equal(h.scheduled.length, 1, "the planned sweep is still ahead, so no second chain");
  assert.match((await companyHandlers["company.status"](h.ctx) as { lastSweep: string }).lastSweep, /1 person left the directory/);
  answer = new Error("down");
  assert.deepEqual(await companyHandlers["company.sweep"](h.ctx, {}), { checked: 0, gone: [] });
  assert.match((await companyHandlers["company.status"](h.ctx) as { lastSweep: string }).lastSweep, /nobody was changed/);
});

test("a key is proved the moment it is in the Vault: what is wrong is said, what works is remembered, the value never comes here", async () => {
  let answer: Record<string, unknown> = { ok: false, problem: "The key is not valid JSON. Paste the whole file, from the first { to the last }." };
  const h = world({ ...google, "google.dwd.check_key": () => answer });
  await companyHandlers["company.start"](h.ctx, { provider: "google" });
  const bad = await companyHandlers["company.check"](h.ctx);
  contract("company.check", bad);
  assert.deepEqual(bad, { ok: false, problem: answer["problem"] });
  assert.deepEqual(h.calls.find((c) => c.cap === "google.dwd.check_key")?.input, { vaultItem: "#Google_DWD" }, "it names a handle");
  assert.equal((await companyHandlers["company.status"](h.ctx) as { steps: { id: string; done: boolean }[] }).steps.find((s) => s.id === "access_key")?.done, false);
  answer = { ok: true, clientId: "1234567890", clientEmail: "vyre@p.iam.gserviceaccount.com" };
  assert.deepEqual(await companyHandlers["company.check"](h.ctx), { ok: true, clientId: "1234567890", who: "vyre@p.iam.gserviceaccount.com" });
  const later = await companyHandlers["company.status"](world({ ...google }, h.raw).ctx) as { next: string; clientId: string; steps: { id: string; done: boolean }[] };
  assert.equal(later.steps.find((s) => s.id === "access_key")?.done, true);
  assert.equal(later.clientId, "1234567890", "the client ID to paste survives a restart");
});

test("the guide comes from the doc page, a section at a time", async () => {
  const h = world();
  const out = await companyHandlers["company.guide"](h.ctx, { provider: "google", section: "run-the-read-only-check" });
  assert.match(out.text, /Press \*\*Run the check\*\*/);
  contract("company.guide", out);
  await assert.rejects(companyHandlers["company.guide"](h.ctx, { provider: "google", section: "nope" }), /no such section/);
  assert.match((await companyHandlers["company.guide"](h.ctx, { provider: "microsoft" })).text, /^# Connect Microsoft 365/);
});

test("the probe answers in one line a person can act on", async () => {
  const h = world({ ...google, "google.dwd.probe": { ok: false, scopesMissing: ["https://www.googleapis.com/auth/calendar"] } });
  await companyHandlers["company.start"](h.ctx, { provider: "google" });
  const out = await companyHandlers["company.probe"](h.ctx) as { ok: boolean; line: string };
  assert.equal(out.ok, false);
  assert.match(out.line, /Not allowed yet in Google Admin: calendar\. It can take up to 24 hours/);
  contract("company.probe", out);
});

test("the capabilities declare what the rules need, and none takes a secret", () => {
  const caps = registry.capabilities.filter((c) => c.name.startsWith("company."));
  assert.equal(caps.length, 11);
  for (const c of caps) assert.ok(!/secret|password|private_key/i.test(JSON.stringify(c.input)), c.name);
  for (const name of ["company.connect", "company.disconnect"]) assert.equal(caps.find((c) => c.name === name)?.gate?.act, "connection_change");
});

test("the setup scripts carry no secret of ours and do what the docs say", () => {
  const g = googleScript({ mail: true, calendar: false, files: true });
  assert.ok(g.includes("gmail.googleapis.com") && g.includes("drive.googleapis.com") && !g.includes("calendar-json.googleapis.com"), "only what was chosen is turned on");
  assert.match(g, /iam-disableServiceAccountKeyCreation/, "the block most new organizations hit is named, with the page that lifts it");
  assert.match(g, /gcloud iam service-accounts keys create/);
  const m = microsoftScript({ mail: true, calendar: true, files: true }, "https://acme.vyre.run/auth/sso/microsoft/callback", ["Files.ReadWrite.All", "User.Read.All"]);
  assert.match(m, /--sign-in-audience AzureADMyOrg/, "one tenant, never a shared app");
  assert.match(m, /--create-cert/);
  assert.ok(m.includes('--web-redirect-uris "https://acme.vyre.run/auth/sso/microsoft/callback"'));
  assert.ok(!/Mail\.|Calendars\./.test(m.replace(/echo .*/g, "")), "Mail and Calendars are not consented in Entra");
});

test("every step belongs to the flow and the next step skips what is optional", () => {
  assert.equal(nextStep("google", new Set(["choose"]))?.id, "access_key");
  assert.equal(nextStep("microsoft", new Set(["choose", "access_key", "access_allow", "access_limit"]))?.id, "signin_app");
  assert.equal(nextStep("google", new Set(FLOW_STEPS.google.filter((s) => s.id !== "signin_require").map((s) => s.id))), null, "requiring sign-in is a choice, not a step left");
});

test("the words people use start it", () => {
  for (const said of ["connect google workspace", "set up our company login", "connect our mail", "turn on sso", "Add Microsoft 365", "sign in with google for everyone", "hook up Office 365", "set up single sign-on"]) assert.ok(COMPANY_INTENT.test(said), said);
  for (const said of ["what is on my calendar", "send this to Sam", "add a task to connect with Dana"]) assert.ok(!COMPANY_INTENT.test(said), said);
});

test("the Vault knows the company keys by name", () => {
  for (const h of ["#Google_DWD", "#Microsoft_App", "#Google_DWD.key", "#Sso_Google_Secret", "#sso_microsoft_secret"]) assert.ok(isCompanyKey(h), h);
  for (const h of ["#Dana_Lawmatics", "#Google_Sign_In", "#Stripe"]) assert.ok(!isCompanyKey(h), h);
});
