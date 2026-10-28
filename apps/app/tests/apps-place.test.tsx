// The Apps place (spec 3.6): the sidebar lists the five groups, the Forms and Campaigns lists open from the Space's data, a row's menu acts with one capability call, and publishing a form or
// launching a campaign goes through Gate: held until a yes. Screens render with react-dom/server over react-native-web (ruling 28), where effects do not run, so the sending domains (loaded
// after paint) and every click are checked through the same calls the place makes.
import test from "node:test";
import assert from "node:assert/strict";
import { Dimensions } from "react-native";
import { renderToStaticMarkup } from "react-dom/server";
import Apps, { AppsLoading } from "../src/places/apps/shell/AppsPlace.tsx";
import { GROUPS, actionsFor, domainRow, formRow, heldOf, matches, openKitBuilder, runAction, templateRow } from "../src/places/apps/shell/index.ts";
import type { AppRow, AppsStart } from "../src/places/apps/shell/index.ts";
import { createSampleApps } from "../src/places/apps/shell/sample.ts";
import AppsPlace, { appsData } from "../src/shell/providers/apps.tsx";
import { appsRoute } from "../src/shell/providers/apps.tsx";
import { addSendingDomain, createCampaign, createForm } from "../src/places/apps/shell/surface-actions.ts";
import { ShellRuntimeProvider } from "../src/shell/providers/runtime.tsx";
import { PlaceHashProvider } from "../src/shell/hash/context.tsx";
import { sampleRuntime } from "../src/shell/providers/misc-test-runtime.tsx";
import type { SampleApps } from "../src/places/apps/shell/sample.ts";

const size = (width: number): void => Dimensions.set({ window: { width, height: 800, scale: 1, fontScale: 1 }, screen: { width, height: 800, scale: 1, fontScale: 1 } });
size(1280);
const html = (s: SampleApps, start?: AppsStart): string => renderToStaticMarkup(<Apps data={s.data} {...(start ? { start } : {})} />).replaceAll("<!-- -->", "");
const has = (s: string, n: string): boolean => s.includes(n);
const at = (s: string, n: string): number => { const i = s.indexOf(n); assert.ok(i >= 0, `expected ${n}`); return i; };
const row = (g: AppRow["group"], id: string, title: string, state?: string): AppRow => ({ group: g, id, title, note: "", ...(state ? { state } : {}) });
const callsTo = (s: SampleApps, cap: string): { cap: string; input: unknown }[] => s.calls.filter((c) => c.cap === cap);

test("sidebar: the groups in order with their counts, and a title, a search and New; Sites is not drawn while it is deferred and comes back with it", () => {
  const out = html(createSampleApps({ deferred: [] }));
  const order = GROUPS.map((g) => at(out, `data-testid="apps-group-${g.key}"`));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "Sites, Forms, Campaigns, Templates, Sending domains");
  assert.deepEqual(GROUPS.map((g) => g.title), ["Sites", "Forms", "Campaigns", "Templates", "Sending domains"]);
  const head = (k: string): string => out.slice(at(out, `data-testid="apps-head-${k}"`), at(out, `data-testid="apps-head-${k}"`) + 500);
  assert.ok(has(head("sites"), ">2<") && has(head("forms"), ">3<") && has(head("campaigns"), ">3<") && has(head("templates"), ">2<"), "counts from the Space");
  assert.ok(has(out, 'data-testid="apps-search"') && has(out, 'aria-label="New"') && has(out, ">Apps<"));
  const deferred = html(createSampleApps());
  assert.ok(!has(deferred, 'data-testid="apps-group-sites"') && has(deferred, 'data-testid="apps-group-forms"'), "a deferred module's group is not drawn");
  assert.ok(!has(html(createSampleApps(), { group: "sites" }), 'data-testid="apps-head-sites"'), "even when asked to open on it");
  assert.ok(!has(deferred, 'aria-label="New site"'));
});

test("Forms list opens with a row for each form, its kind and state, and how many answers", () => {
  const out = html(createSampleApps());
  assert.ok(has(out, 'data-testid="apps-title"') && has(out, ">Forms<"));
  for (const n of ["Client intake form", "Consult booking", "After the consult"]) assert.ok(has(out, n), n);
  assert.ok(has(out, "Public form · Published") && has(out, "Booking page · Draft") && has(out, "Survey · Published"));
  assert.ok(has(out, "14 answers") && has(out, "6 answers") && has(out, "0 answers"));
  assert.ok(has(out, 'aria-label="New form"'), "New form in the header");
});

test("Campaigns list opens with its state and who it reaches", () => {
  const out = html(createSampleApps(), { group: "campaigns" });
  for (const n of ["Fall check-in", "October newsletter", "Win-back"]) assert.ok(has(out, n), n);
  assert.ok(has(out, "Sequence · Draft") && has(out, "One time · Running") && has(out, "Triggered · Paused"));
  assert.ok(has(out, "212 people") && has(out, "860 sent"));
  assert.ok(has(out, 'aria-label="New campaign"'));
});

test("Templates and Sites lists open; Templates offers Build a Kit", () => {
  const t = html(createSampleApps(), { group: "templates" });
  assert.ok(has(t, "Law firm intake") && has(t, "Journey · v1.2") && has(t, 'data-testid="apps-kit"') && has(t, "Adds 3"));
  const s = html(createSampleApps({ deferred: [] }), { group: "sites" });
  assert.ok(has(s, "Booking widget") && has(s, "App · live") && has(s, "Northwind site") && has(s, "Site · on staging"));
});

test("a Personal Space says it needs a Team Space instead of drawing the place", () => {
  const out = html(createSampleApps({ team: false }));
  assert.ok(has(out, 'data-testid="apps-needs-team"') && has(out, "Needs a Team Space") && !has(out, 'data-testid="apps-sidebar"'));
});

test("the frame before data: the title and a blank the size of the real list", () => {
  const out = renderToStaticMarkup(<AppsLoading />);
  assert.ok(has(out, 'data-testid="apps-loading-frame"') && has(out, ">Apps<"));
});

test("a phone shows one pane at a time: the groups first, then the list with Back", () => {
  size(390);
  try {
    const groups = html(createSampleApps());
    assert.ok(has(groups, 'data-testid="apps-sidebar"') && !has(groups, 'data-testid="apps-main"'));
    const list = html(createSampleApps(), { open: true, group: "forms" });
    assert.ok(has(list, 'data-testid="apps-main"') && has(list, 'data-testid="apps-back"') && !has(list, 'data-testid="apps-sidebar"'));
  } finally { size(1280); }
});

test("search keeps the rows whose title or note has every word", () => {
  const r = formRow({ formId: "f", name: "Client intake form", recordType: "clients", kind: "public", state: "published", slug: "i", submissions: 1 });
  assert.ok(matches(r, "") && matches(r, "intake") && matches(r, "client published") && !matches(r, "campaign"));
  const out = html(createSampleApps(), { group: "forms", q: "survey" });
  assert.ok(has(out, "After the consult") && !has(out, "Client intake form"));
  assert.ok(has(html(createSampleApps(), { group: "forms", q: "zzz" }), "Nothing matches zzz"));
});

test("row menus: a draft form offers Publish, a published one Unpublish; a campaign offers what its state allows", () => {
  assert.deepEqual(actionsFor(row("forms", "a", "A", "draft")), ["open", "publish"]);
  assert.deepEqual(actionsFor(row("forms", "a", "A", "published")), ["open", "unpublish"]);
  assert.deepEqual(actionsFor(row("campaigns", "c", "C", "draft")), ["open", "launch"]);
  assert.deepEqual(actionsFor(row("campaigns", "c", "C", "running")), ["open", "pause", "stop"]);
  assert.deepEqual(actionsFor(row("campaigns", "c", "C", "paused")), ["open", "resume", "stop"]);
  assert.deepEqual(actionsFor(row("campaigns", "c", "C", "completed")), ["open"]);
  assert.deepEqual(actionsFor(row("templates", "t", "T")), ["open", "install"]);
  assert.deepEqual(actionsFor(row("domains", "d", "D")), ["check"]);
});

test("publish a form reaches forms.publish and the form is public afterwards", async () => {
  const s = createSampleApps();
  const done = await runAction(s.data, "publish", row("forms", "fm_consult", "Consult booking", "draft"));
  assert.deepEqual(callsTo(s, "forms.publish").map((c) => c.input), [{ formId: "fm_consult" }]);
  assert.equal(done.text, "Published Consult booking.");
  assert.ok(has(html(s), "Booking page · Published"));
  await runAction(s.data, "unpublish", row("forms", "fm_consult", "Consult booking"));
  assert.equal(callsTo(s, "forms.unpublish").length, 1);
});

test("launch a campaign reaches campaigns.launch with an idempotency key; pause, resume and stop are one call each", async () => {
  const s = createSampleApps();
  const done = await runAction(s.data, "launch", row("campaigns", "cp_fall", "Fall check-in", "draft"));
  const launch = callsTo(s, "campaigns.launch")[0]!.input as { campaignId: string; idempotencyKey: string };
  assert.equal(launch.campaignId, "cp_fall");
  assert.match(launch.idempotencyKey, /^launch-cp_fall-/);
  assert.equal(done.text, "Launched Fall check-in.");
  assert.ok(has(html(s, { group: "campaigns" }), "Sequence · Running"));
  for (const [a, cap] of [["pause", "campaigns.pause"], ["resume", "campaigns.resume"], ["stop", "campaigns.stop"]] as const) {
    await runAction(s.data, a, row("campaigns", "cp_fall", "Fall check-in"));
    assert.equal(callsTo(s, cap).length, 1, cap);
  }
});

test("through Gate: a held publish or launch says it is waiting for a yes, points at the task, and changes nothing", async () => {
  const s = createSampleApps({ gate: true });
  const pub = await runAction(s.data, "publish", row("forms", "fm_consult", "Consult booking", "draft"));
  const lau = await runAction(s.data, "launch", row("campaigns", "cp_fall", "Fall check-in", "draft"));
  assert.deepEqual([pub.text, pub.taskId], ["Publishing is waiting for a yes.", "tsk_gate1"]);
  assert.deepEqual([lau.text, lau.taskId], ["Launching is waiting for a yes.", "tsk_gate1"]);
  assert.ok(has(html(s), "Booking page · Draft"), "the form is still a draft");
  assert.ok(has(html(s, { group: "campaigns" }), "Sequence · Draft"), "the campaign has not started");
  assert.deepEqual(heldOf({ status: "held", taskId: "t1", runId: "r1" }), { taskId: "t1" });
  assert.equal(heldOf({ runId: "r" }), null);
});

test("install a template, check a sending domain, build a Kit: one call each", async () => {
  const s = createSampleApps();
  const inst = await runAction(s.data, "install", templateRow({ templateId: "tp_intake", title: "Law firm intake", kind: "journey", summary: "", version: "1.2", adds: [] }));
  assert.deepEqual(callsTo(s, "templates.install")[0]!.input, { templateId: "tp_intake" });
  assert.equal(inst.text, "Installed Law firm intake. It added 2.");
  const list = (await s.data.call("mail.domain.list", {})) as { domains: Parameters<typeof domainRow>[0][] };
  const fresh = domainRow(list.domains.find((d) => !d.verified)!);
  assert.match(fresh.note, /Mailgun · Checking/);
  await runAction(s.data, "check", fresh);
  assert.deepEqual(callsTo(s, "mail.domain.check")[0]!.input, { domainId: "dm_new" });
  const after = (await s.data.call("mail.domain.list", {})) as { domains: Parameters<typeof domainRow>[0][] };
  assert.match(domainRow(after.domains.find((d) => d.id === "dm_new")!).note, /Verified/);
  assert.equal(await openKitBuilder(s.data, "A Kit for estate planning"), "thr_kit1");
  const opened = callsTo(s, "kits.builder_open")[0]!.input as { brief: string; idempotencyKey: string };
  assert.equal(opened.brief, "A Kit for estate planning");
  assert.match(opened.idempotencyKey, /^kit-builder-/);
  assert.deepEqual(s.went, ["thread:thr_kit1"]);
});

test("Open goes out through the shell, and a refusal is words, not a crash", async () => {
  const s = createSampleApps();
  await runAction(s.data, "open", row("forms", "fm_intake", "Client intake form"));
  assert.deepEqual(s.went, ["open:forms:fm_intake"]);
  s.failNext("forms.publish", "You may not publish that.");
  await assert.rejects(() => runAction(s.data, "publish", row("forms", "fm_consult", "Consult booking")), /You may not publish that/);
});

test("no copy in the Apps place uses an em dash", () => {
  const s = createSampleApps();
  const all = [html(s), html(s, { group: "campaigns" }), html(s, { group: "templates" }), html(createSampleApps({ team: false }))].join("\n");
  assert.ok(!has(all, String.fromCharCode(0x2014)));
});

const placeIn = (deferred: readonly string[], kind: "team" | "personal" = "team"): string => {
  const s = createSampleApps({ deferred: [] });
  const rt = { ...sampleRuntime({ screens: s.data.screens, call: s.data.call }), deferredModules: new Set(deferred) as ReadonlySet<string>, space: { id: "northwind", kind, name: "Northwind" } };
  return renderToStaticMarkup(<ShellRuntimeProvider value={rt}><AppsPlace place="apps" /></ShellRuntimeProvider>).replaceAll("<!-- -->", "");
};

test("in the real app, Sites stays deferred for v1 while the working Apps remain available", () => {
  const hidden = placeIn(["sites"]);
  assert.ok(has(hidden, 'data-testid="apps-group-forms"') && !has(hidden, 'data-testid="apps-group-sites"'), "the runtime's deferred set hides the group");
  assert.ok(!has(hidden, 'aria-label="New site"') && !has(hidden, "Booking widget"), "and nothing of it is listed");
  const shown = placeIn([]);
  assert.ok(has(shown, 'data-testid="apps-group-forms"') && !has(shown, 'data-testid="apps-group-sites"'), "the provider keeps Sites out of the v1 shell");
  const s = createSampleApps();
  const rt = { ...sampleRuntime({ screens: s.data.screens, call: s.data.call }), deferredModules: new Set(["sites"]) as ReadonlySet<string> };
  assert.deepEqual(appsData(rt).deferred, ["sites"]);
});

test("only working create flows are offered: templates use the Kit builder and domains can be added", () => {
  const templates = html(createSampleApps(), { group: "templates" });
  assert.ok(has(templates, 'data-testid="apps-kit"') && !has(templates, 'aria-label="New template"'));
  const domains = html(createSampleApps(), { group: "domains" });
  assert.ok(has(domains, 'aria-label="Add sending domain"') && !has(domains, 'aria-label="New domain"'));
});

test("in the real app, a Personal Space gets the Team Space line, and a click out goes through the shell's door", () => {
  assert.ok(has(placeIn([], "personal"), 'data-testid="apps-needs-team"'));
  const s = createSampleApps();
  const opened: string[] = [];
  const d = appsData(sampleRuntime({ screens: s.data.screens, call: s.data.call, opened }));
  d.nav.joinTeam();
  d.nav.openTask("tsk_1");
  assert.deepEqual(opened, ["settings.page", '{"type":"task","id":"tsk_1"}']);
});

test("Apps hashes select real detail and create surfaces", () => {
  assert.deepEqual(appsRoute({ screen: "apps.form-settings", args: { selected: "fm_intake" } }), { kind: "detail", group: "forms", id: "fm_intake" });
  assert.deepEqual(appsRoute({ screen: "apps.campaign-builder", args: { selected: "cp_fall" } }), { kind: "detail", group: "campaigns", id: "cp_fall" });
  assert.deepEqual(appsRoute({ screen: "apps.templates", args: { selected: "tp_intake" } }), { kind: "detail", group: "templates", id: "tp_intake" });
  assert.deepEqual(appsRoute({ screen: "apps.sending-domains", args: { selected: "dm_main" } }), { kind: "detail", group: "domains", id: "dm_main" });
  assert.deepEqual(appsRoute({ screen: "apps.forms", args: { create: "true" } }), { kind: "create", group: "forms" });
});

test("New forms, campaigns, and sending domains call their real capabilities", async () => {
  const s = createSampleApps();
  await createForm(s.data, { name: "Referral intake", recordType: "contacts", kind: "public" });
  await createCampaign(s.data, { name: "Referral follow-up", kind: "sequence" });
  await addSendingDomain(s.data, { name: "mail.northwind.example", provider: "resend" });
  const calls = s.calls.slice(-3);
  assert.deepEqual(calls.map((x) => x.cap), ["forms.create", "campaigns.create", "mail.domain.add"]);
  assert.deepEqual({ ...(calls[0]!.input as object), idempotencyKey: undefined }, { name: "Referral intake", recordType: "contacts", kind: "public", idempotencyKey: undefined });
  assert.deepEqual({ ...(calls[1]!.input as object), idempotencyKey: undefined }, { name: "Referral follow-up", kind: "sequence", idempotencyKey: undefined });
  assert.deepEqual({ ...(calls[2]!.input as object), idempotencyKey: undefined }, { name: "mail.northwind.example", provider: "resend", idempotencyKey: undefined });
  for (const call of calls) assert.match(String((call.input as { idempotencyKey: string }).idempotencyKey), /^(form|campaign|domain)-/);
});

test("the real app mounts Forms, Campaigns, Templates, domain detail, and create surfaces from the tab hash", () => {
  const s = createSampleApps();
  const rt = sampleRuntime({ screens: s.data.screens, call: s.data.call });
  const draw = (hash: string): string => renderToStaticMarkup(
    <ShellRuntimeProvider value={rt}><PlaceHashProvider hash={hash} opened={() => undefined}><AppsPlace place="apps" /></PlaceHashProvider></ShellRuntimeProvider>,
  ).replaceAll("<!-- -->", "");
  assert.match(draw("screen=apps.form-settings&selected=fm_intake"), /data-testid="apps-form-detail"/);
  assert.match(draw("screen=apps.campaign-builder&selected=cp_fall"), /data-testid="apps-campaign-detail"/);
  assert.match(draw("screen=apps.templates&selected=tp_intake"), /data-testid="apps-template-detail"/);
  assert.match(draw("screen=apps.sending-domains&selected=dm_main"), /data-testid="apps-domain-detail"/);
  assert.match(draw("screen=apps.forms&create=true"), /data-testid="apps-create-form"/);
});


test("Personal Apps gates before opening any query, including deep links", () => {
  const sample = createSampleApps({ team: false });
  let queries = 0;
  sample.data.screens = { query() { queries++; throw new Error("must not query a Team capability"); } };
  const out = renderToStaticMarkup(<Apps data={sample.data} route={{ kind: "detail", group: "forms", id: "frm_fixture" }} />);
  assert.match(out, /Needs a Team Space/); assert.equal(queries, 0);
});

test("deferred Sites creates no subscription while real Forms and Campaigns stay available", () => {
  const sample = createSampleApps();
  const original = sample.data.screens;
  const asked: string[] = [];
  sample.data.screens = { query(screen, name, state) { asked.push(screen); return original.query(screen, name, state); } };
  const out = html(sample);
  assert.equal(asked.includes("apps.sites"), false); assert.match(out, /Client intake form/);
});
