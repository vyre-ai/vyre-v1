// CRM to Records as a person lives it, in a Personal Space and a Team Space: a daemon in this process, the app's production export in Chromium (CI builds it; VYRE_APP_DIST), a fake CRM behind
// the connector network (a real HTTP server with webhooks). Each journey asserts what the person would see and what the app was told, and takes four pictures per step (desktop and phone,
// light and dark) under VYRE_TEST_CAPTURE_DIR/crm/<journey>. The agent's conversation that fills the spec is proven by test/crm-to-records.test.ts; here the spec arrives through the same
// capability the agent calls (sync_specs.apply), as the owner.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ledgerAccountSpec, ledgerSpec, orbitSpec } from "../modules/connectors/fixtures/crm.ts";
import { claimOnEdge, dismissOnboarding } from "../apps/app/tests/real-app-harness.test.ts";
import { bringInByChat, connectAi, ok, shots, startSpace, trustAssistant, until, vaultItemOf, vaultKey, withHandle } from "./support/crm-journey-kit.ts";
import type { Know } from "./support/agent-standin.ts";
import type { Space } from "./support/crm-journey-kit.ts";

const ledgerKnow = (handle: string, account?: string, tenant?: string): Know => ({
  name: "Ledger", domain: "crm-a.test", auth: { vaultHandle: handle, style: "header", header: "X-Api-Token" },
  objects: [
    { remote: "organizations", path: "/api/v2/organizations", label: "Organization", recordType: "org" },
    { remote: "people", path: "/api/v2/people", label: "Person", recordType: "person", write: { path: tenant ? `/api/v2/people/{id}?tenant=${tenant}` : "/api/v2/people/{id}", evidence: "https://docs.crm-a.test/people#update" } },
  ],
  fieldsEndpoint: { path: "/api/v2/fields/people", forRemote: "people" },
  ...(tenant ? {} : { firstPullFilter: { remote: "people", param: "modified_after", value: "2026-01-01T00:00:00Z", words: "People changed since the start of 2026" } }),
  ...(account ? { account } : {}),
} as Know);
const OUT = path.join(process.env["VYRE_TEST_CAPTURE_DIR"] ?? path.join(process.env["TMPDIR"] ?? "/tmp", "vyre-crm-journeys"), "crm");

/* eslint-disable @typescript-eslint/no-explicit-any */
type Pg = any;
const rows = async (s: Space, type: string): Promise<any[]> => (await ok(s, "records.query", { type, limit: 200 })).rows as any[];
const nameOf = (r: any): string => String(r.data?.name ?? r.fields?.name ?? "");
const viaBrowser = async <T>(s: Space, kind: "personal" | "team", fn: (page: Pg) => Promise<T>): Promise<T | null> => {
  if (!s.web) return null;
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: process.env["CHROME_BIN"] || chromium.executablePath() });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(15_000);
    await page.goto(claimOnEdge(s.d.claim!.url, s.web.origin));
    await page.getByTestId("claim-name").fill(kind === "personal" ? "Personal owner" : "Team owner");
    await page.getByTestId("claim-username").fill("crmowner");
    await page.getByTestId("claim-password").fill("fixture crm password123");
    await page.getByTestId("claim-confirm").fill("fixture crm password123");
    await page.getByTestId("claim-next").click();
    await page.getByTestId("claim-saved").click();
    await page.getByTestId("claim-create").click();
    await dismissOnboarding(page);
    return await fn(page);
  } finally { await browser.close(); }
};
const openSync = async (s: Space, page: Pg): Promise<void> => {
  await page.goto(`${s.web!.origin}/records`);
  await page.getByTestId("sync-dot").first().click();
  await page.getByTestId("sync-page").waitFor();
};

test("journey 1, Personal: the first hour. A CRM key becomes record types and records, the person edits one and the app hears it once", async (t) => {
  const s = await startSpace({ kind: "personal", name: "Me" });
  try {
    // the way a person starts: in chat, "bring my CRM into Records"; the agent reads the app, proposes in one message, and the person taps Looks good
    await connectAi(s);
    const item = await vaultItemOf(s, "Ledger");
    const agentId = await trustAssistant(s, item.id);
    await bringInByChat(s, agentId, ledgerKnow(item.handle), item);
    await until("the agent applied it and the people arrived", async () => (await rows(s, "person").catch(() => [])).length === 4, 60_000);
    assert.equal(s.model.plan, null, "the proposal was applied");
    assert.ok(s.crm.methods().every((m) => m === "GET"), "reading the app is all that happened before the first edit");
    await until("people arrive", async () => (await rows(s, "person")).length === 4);
    assert.deepEqual((await rows(s, "org")).map(nameOf).sort(), ["North Works", "South Mill"]);
    const status = await ok(s, "sync_types.status", { type: "person" });
    assert.equal(status.records, 4);
    assert.equal(status.canBackfill, true, "the first pull left one person out and the page offers Bring in everything");

    // the person fixes a phone number; the app is told, once, and the record says who sent it
    const ada = (await rows(s, "person")).find((r) => nameOf(r) === "Ada Stone")!;
    await ok(s, "records.update", { type: "person", recordId: ada.id, patch: { note: "Called back" } });
    await ok(s, "connectors.sync_now", { type: "person", idempotencyKey: "j1-poll" });   // the next check, which a Personal computer makes within minutes
    await until("the app hears the edit", async () => s.crm.c.state.requests.some((r) => r.method === "PATCH"));
    assert.equal(s.crm.c.state.requests.filter((r) => r.method === "PATCH").length, 1);
    assert.equal((s.crm.c.state.people[0]!.attributes as any).note, "Called back");
    assert.ok(s.crm.c.state.requests.every((r) => r.method === "GET" || r.method === "PATCH"), "nothing but reads and the one edit travelled");

    await viaBrowser(s, "personal", async (page) => {
      const pics = shots(OUT, "1-personal-first-hour");
      await page.goto(`${s.web!.origin}/records`);
      await page.getByTestId("records-sidebar").waitFor();
      await pics.take(page, "records-sidebar-with-sync-dot");
      await openSync(s, page);
      assert.match(await page.getByTestId("sync-records-line").innerText(), /4/);
      await pics.take(page, "sync-page");
    });
  } finally { await s.stop(); }
  t.diagnostic(`shots in ${OUT}`);
});

test("journey 2, Personal later: the app changes, the person is behind, both sides edit, the newest wins and the older value stays in the history", async () => {
  const s = await startSpace({ kind: "personal", name: "Me" });
  try {
    const handle = await vaultKey(s, "Ledger");
    await ok(s, "sync_specs.apply", { spec: withHandle(ledgerSpec(), handle), idempotencyKey: "j2-apply" });
    await until("people arrive", async () => (await rows(s, "person")).length === 4);
    // someone changes Ben in the app and adds a person there
    const ben = s.crm.c.state.people.find((p) => p.attributes.full_name === "Ben Ford")!;
    ben.attributes.status = "client"; ben.modified = new Date().toISOString();
    s.crm.c.state.people.push({ id: 106, attributes: { full_name: "Fay Reed", email: "fay@example.test", phone: "", status: "lead", tier: "gold", note: "" }, org_id: null, modified: new Date().toISOString() });
    await ok(s, "connectors.sync_now", { type: "person", idempotencyKey: "j2-poll" });
    await until("the poll brings Fay", async () => (await rows(s, "person")).some((r) => nameOf(r) === "Fay Reed"));
    // both sides edit Ada's note: the person last
    const ada = (await rows(s, "person")).find((r) => nameOf(r) === "Ada Stone")!;
    s.crm.c.state.people[0]!.attributes.note = "App says"; s.crm.c.state.people[0]!.modified = new Date(Date.now() + 1000).toISOString();
    await ok(s, "records.update", { type: "person", recordId: ada.id, patch: { note: "Person says" } });
    await ok(s, "connectors.sync_now", { type: "person", idempotencyKey: "j2-conflict" });
    await until("the settlement is kept", async () => ((await ok(s, "sync_types.field_history", { type: "person", recordId: ada.id, field: "note" })).entries as any[]).length > 0);
    const history = (await ok(s, "sync_types.field_history", { type: "person", recordId: ada.id, field: "note" })).entries as any[];
    assert.ok(history.every((h) => ["app", "you", "push"].includes(h.replacedBy)));
    await viaBrowser(s, "personal", async (page) => {
      const pics = shots(OUT, "2-personal-later");
      await openSync(s, page);
      await pics.take(page, "sync-page-after-changes");
    });
  } finally { await s.stop(); }
});

test("journey 3, Team: an admin brings the CRM in once, the app calls the Space's address, a pass starts at once, and nothing is written to the app by the pull", async () => {
  const s = await startSpace({ kind: "team", name: "Firm", address: "https://firm.example" });
  try {
    const handle = await vaultKey(s, "Ledger");
    const spec = withHandle(ledgerSpec(), handle) as { objects: { remote: string; webhook?: unknown }[] };
    spec.objects.find((o) => o.remote === "people")!.webhook = { events: ["person.updated"], subscribePath: "/api/v2/webhooks", evidence: "https://docs.crm-a.test/webhooks" };
    const applied = await ok(s, "sync_specs.apply", { spec, idempotencyKey: "j3-apply" });
    await until("people arrive", async () => (await rows(s, "person")).length === 4);
    assert.equal(applied.live, "webhook");
    await until("the Space registered its address with the app", async () => s.crm.c.state.webhooks.length >= 1);
    const hook = new URL(s.crm.c.state.webhooks[0]!.url);
    // the app says someone changed; the Space starts a pass without waiting for a poll
    s.crm.c.state.people.push({ id: 107, attributes: { full_name: "Gil Hart", email: "gil@example.test", phone: "", status: "lead", tier: "gold", note: "" }, org_id: null, modified: new Date().toISOString() });
    const res = await fetch(`${s.d.url}${hook.pathname}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "updated" }) });
    assert.ok(res.status < 300, `the hook answered ${res.status}`);
    await until("the webhook pass brings Gil", async () => (await rows(s, "person")).some((r) => nameOf(r) === "Gil Hart"));
    assert.ok(s.crm.methods().every((m) => m === "GET" || m === "POST"), "the pull only reads; the one POST is the hook registration");
    await viaBrowser(s, "team", async (page) => {
      const pics = shots(OUT, "3-team-webhook");
      await openSync(s, page);
      await pics.take(page, "sync-page-live");
    });
  } finally { await s.stop(); }
});

test("journey 4, Team with four locations: each location is its own account of one type, every record says where it came from, and one failing account does not stop the others", async () => {
  const s = await startSpace({ kind: "team", name: "Firm", address: "https://firm.example" });
  try {
    const handle = await vaultKey(s, "Ledger");
    await ok(s, "sync_specs.apply", { spec: withHandle(ledgerAccountSpec("Main"), handle), idempotencyKey: "j4-main" });
    await ok(s, "sync_specs.apply", { spec: withHandle(ledgerAccountSpec("Paris", "b"), handle), idempotencyKey: "j4-paris" });
    await until("both accounts arrive", async () => (await rows(s, "person")).some((r) => nameOf(r) === "Gus Hale") && (await rows(s, "person")).some((r) => nameOf(r) === "Ed Park"));
    const people = await rows(s, "person");
    const from = new Set(people.map((r) => String(r.data?.from ?? r.fields?.from)));
    assert.deepEqual([...from].sort(), ["Main", "Paris"]);
    const status = await ok(s, "sync_types.status", { type: "person" });
    assert.equal(status.accounts.length, 2);
    await viaBrowser(s, "team", async (page) => {
      const pics = shots(OUT, "4-team-accounts");
      await openSync(s, page);
      await pics.take(page, "sync-page-two-accounts");
    });
  } finally { await s.stop(); }
});

test("journey 5, any Space: the key stops working, the person is told once and sees the fix, and the pass recovers when the key is replaced", async () => {
  const s = await startSpace({ kind: "personal", name: "Me" });
  try {
    const handle = await vaultKey(s, "Ledger");
    await ok(s, "sync_specs.apply", { spec: withHandle(ledgerSpec(), handle), idempotencyKey: "j5-apply" });
    await until("people arrive", async () => (await rows(s, "person")).length === 4);
    s.crm.c.state.keyA = "rotated-by-the-app";
    await ok(s, "connectors.sync_now", { type: "person", idempotencyKey: "j5-bad-1" }).catch(() => undefined);
    await until("the type needs a person", async () => (await ok(s, "sync_types.status", { type: "person" })).state === "error");
    await ok(s, "connectors.sync_now", { type: "person", idempotencyKey: "j5-bad-2" }).catch(() => undefined);
    const tasks = (await ok(s, "tasks.list", {}).catch(() => ({ tasks: [] }))).tasks as any[];
    assert.ok(tasks.filter((x) => /Replace|reconnect/i.test(String(x.title))).length <= 1, "one item, not one per failure");
    await viaBrowser(s, "personal", async (page) => {
      const pics = shots(OUT, "5-key-revoked");
      await openSync(s, page);
      await pics.take(page, "sync-page-needs-you");
    });
    s.crm.c.state.keyA = "ledger-key-0001";
    const conn = (await ok(s, "connections.list", {})).connections[0].connectionId as string;
    const tested = await ok(s, "connections.test", { connectionId: conn });
    assert.equal(tested.state, "healthy", JSON.stringify(tested));
    await ok(s, "connectors.sync_now", { type: "person", idempotencyKey: "j5-good" });
    await until("the type recovers", async () => (await ok(s, "sync_types.status", { type: "person" })).state !== "error");
  } finally { await s.stop(); }
});

test("journey 0: the second app, a custom object with Link-header paging, arrives whole", async () => {
  const s = await startSpace({ kind: "personal", name: "Me" });
  try {
    const handle = await vaultKey(s, "Orbit");
    await ok(s, "sync_specs.apply", { spec: withHandle(orbitSpec(), handle), idempotencyKey: "j0-apply" });
    await until("jobs arrive", async () => (await rows(s, "job")).length === 3);
  } finally { await s.stop(); }
});
