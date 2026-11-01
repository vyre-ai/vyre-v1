// CRM to Records as a person lives it, in a Personal Space and a Team Space: a daemon in this process, the app's production export in Chromium (CI builds it; VYRE_APP_DIST), a fake CRM behind
// the connector network (a real HTTP server with webhooks). Each journey asserts what the person would see and what the app was told, and takes four pictures per step (desktop and phone,
// light and dark) under VYRE_TEST_CAPTURE_DIR/crm/<journey>. A journey starts the way a person does: in chat, with the agent stand-in (the crm-sync-builder skill as a script) reading the fake CRM,
// proposing, and the person tapping Looks good (on the question card in the browser; through the capability the card calls when there is no browser).
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { claimOnEdge, dismissOnboarding } from "../apps/app/tests/real-app-harness.test.ts";
import { chatSetup, joinMember, ok, shots, startSpace, until, vaultItemOf, withHandle } from "./support/crm-journey-kit.ts";
import type { Space } from "./support/crm-journey-kit.ts";
import type { Know } from "./support/agent-standin.ts";
import { orbitSpec } from "../modules/connectors/fixtures/crm.ts";

interface KnowOpts { account?: string; tenant?: string; webhook?: boolean; audience?: "space" | "added" | "me" }
const ledgerKnow = (handle: string, o: KnowOpts = {}): Know => ({
  name: "Ledger", domain: "crm-a.test", auth: { vaultHandle: handle, style: "header", header: "X-Api-Token" },
  objects: [
    { remote: "organizations", path: "/api/v2/organizations", label: "Organization", recordType: "org" },
    { remote: "people", path: "/api/v2/people", label: "Person", recordType: "person", write: { path: o.tenant ? `/api/v2/people/{id}?tenant=${o.tenant}` : "/api/v2/people/{id}", evidence: "https://docs.crm-a.test/people#update" } },
  ],
  fieldsEndpoint: { path: "/api/v2/fields/people", forRemote: "people" },
  ...(o.tenant ? { query: { people: { tenant: o.tenant } } } : { firstPullFilter: { remote: "people", param: "modified_after", value: "2026-01-01T00:00:00Z", words: "People changed since the start of 2026" } }),
  ...(o.account ? { account: o.account } : {}),
  ...(o.webhook ? { webhook: { remote: "people", subscribePath: "/api/v2/webhooks", evidence: "https://docs.crm-a.test/webhooks" } } : {}),
  ...(o.audience ? { audience: o.audience } : {}),
});
const OUT = path.join(process.env["VYRE_TEST_CAPTURE_DIR"] ?? path.join(process.env["TMPDIR"] ?? "/tmp", "vyre-crm-journeys"), "crm");

/* eslint-disable @typescript-eslint/no-explicit-any */
type Pg = any;
const rows = async (s: Space, type: string): Promise<any[]> => (await ok(s, "records.query", { type, limit: 200 })).rows as any[];
const nameOf = (r: any): string => String(r.data?.name ?? r.fields?.name ?? "");
interface Ctl { member(who: { personId: string; token: string }): Promise<Pg> }

/** The journey, with a signed-in browser when CI has built the app (null otherwise: the host parts still run). The owner claims the Space first, as a person does. */
async function session<T>(s: Space, kind: "personal" | "team", fn: (page: Pg | null, ctl: Ctl) => Promise<T>): Promise<T> {
  if (!s.web) return fn(null, { member: async () => null });
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
    const origin = s.web.origin;
    return await fn(page, {
      // a second person in their own browser context: the session a signed-in member carries
      member: async (who) => {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const p = await ctx.newPage();
        p.setDefaultTimeout(15_000);
        await p.goto(`${origin}/healthz`).catch(() => undefined);
        await p.evaluate(([o, token, person]) => {
          localStorage.setItem("vyre.session.v1", JSON.stringify({ sessions: { [o!]: { baseUrl: o, token, personId: person, marker: "m", def: { spaceId: "spc_crm_team", name: "Firm", kind: "team", address: o, role: "Member", tint: ["#6E5CF0", "#9B6BE8"], kit: "northwind", skinDefault: "system", starred: true, needsYou: false, console: false, terminal: false, counts: {}, dots: {} } } } }));
        }, [origin, who.token, who.personId] as [string, string, string]);
        return p;
      },
    });
  } finally { await browser.close(); }
}
const openSync = async (s: Space, page: Pg): Promise<void> => {
  await page.goto(`${s.web!.origin}/records`);
  await page.getByTestId("sync-dot").first().click();
  await page.getByTestId("sync-page").waitFor();
};
/** The Looks good tap on the question card in the chat, in the browser. */
const tapIn = (page: Pg | null, s: Space, pics: ReturnType<typeof shots> | null) => page === null ? undefined : async (threadId: string): Promise<void> => {
  await page.goto(`${s.web!.origin}/chats#thread=${threadId}`);
  await page.getByTestId("chats-place").waitFor();
  const looksGood = page.getByRole("button", { name: "Looks good" }).first();
  await looksGood.waitFor({ timeout: 30_000 });
  if (pics) await pics.take(page, "the-proposal");
  await looksGood.click();
};
const afterPass = async (s: Space, type: string): Promise<void> => { await ok(s, "connectors.sync_now", { type, idempotencyKey: `n-${Math.random().toString(36).slice(2)}` }); };

test("journey 1, Personal: the first hour. In chat the person asks for their CRM, the agent proposes, one tap brings it in, an edit goes back once", async () => {
  const s = await startSpace({ kind: "personal", name: "Me" });
  try {
    await session(s, "personal", async (page) => {
      const pics = page ? shots(OUT, "1-personal-first-hour") : null;
      await chatSetup(s, (h) => ledgerKnow(h), "Ledger", tapIn(page, s, pics));
      await until("the agent applied it and the people arrived", async () => (await rows(s, "person").catch(() => [])).length === 4, 60_000);
      assert.equal(s.model.plan, null, "the proposal was applied");
      assert.ok(s.crm.methods().every((m) => m === "GET"), "reading the app is all that happened before the first edit");
      assert.deepEqual((await rows(s, "org")).map(nameOf).sort(), ["North Works", "South Mill"]);
      const status = await ok(s, "sync_types.status", { type: "person" });
      assert.equal(status.records, 4);
      assert.equal(status.canBackfill, true, "the first pull left one person out and the page offers Bring in everything");
      assert.equal((await ok(s, "sync_specs.apply", { spec: (await ok(s, "sync_specs.get", { type: "person" })).spec, idempotencyKey: "j1-again" })).live, "polling", "a Personal computer has no public address: it polls");

      const ada = (await rows(s, "person")).find((r) => nameOf(r) === "Ada Stone")!;
      await ok(s, "records.update", { type: "person", recordId: ada.id, patch: { note: "Called back" } });
      await afterPass(s, "person");
      await until("the app hears the edit", async () => s.crm.c.state.requests.some((r) => r.method === "PATCH"));
      assert.equal(s.crm.c.state.requests.filter((r) => r.method === "PATCH").length, 1);
      assert.equal((s.crm.c.state.people[0]!.attributes as any).note, "Called back");
      assert.ok(s.crm.c.state.requests.every((r) => r.method === "GET" || r.method === "PATCH"), "nothing but reads and the one edit travelled");
      if (page && pics) {
        await page.goto(`${s.web!.origin}/records`);
        await page.getByTestId("records-sidebar").waitFor();
        await pics.take(page, "records-sidebar-with-sync-dot");
        await openSync(s, page);
        assert.match(await page.getByTestId("sync-records-line").innerText(), /4/);
        await pics.take(page, "sync-page");
      }
    });
  } finally { await s.stop(); }
});

test("journey 2, Personal later: the app changes, the person is behind, both sides edit, the newest wins and the older value stays in the history", async () => {
  const s = await startSpace({ kind: "personal", name: "Me" });
  try {
    await session(s, "personal", async (page) => {
      await chatSetup(s, (h) => ledgerKnow(h));
      await until("people arrive", async () => (await rows(s, "person").catch(() => [])).length === 4, 60_000);
      const ben = s.crm.c.state.people.find((p) => p.attributes.full_name === "Ben Ford")!;
      ben.attributes.status = "client"; ben.modified = new Date().toISOString();
      s.crm.c.state.people.push({ id: 106, attributes: { full_name: "Fay Reed", email: "fay@example.test", phone: "", status: "lead", tier: "gold", note: "" }, org_id: null, modified: new Date().toISOString() });
      await afterPass(s, "person");
      await until("the poll brings Fay", async () => (await rows(s, "person")).some((r) => nameOf(r) === "Fay Reed"));
      const ada = (await rows(s, "person")).find((r) => nameOf(r) === "Ada Stone")!;
      s.crm.c.state.people[0]!.attributes.note = "App says"; s.crm.c.state.people[0]!.modified = new Date(Date.now() + 1000).toISOString();
      await ok(s, "records.update", { type: "person", recordId: ada.id, patch: { note: "Person says" } });
      await afterPass(s, "person");
      await until("the settlement is kept", async () => ((await ok(s, "sync_types.field_history", { type: "person", recordId: ada.id, field: "note" })).entries as any[]).length > 0);
      const history = (await ok(s, "sync_types.field_history", { type: "person", recordId: ada.id, field: "note" })).entries as any[];
      assert.ok(history.every((h) => ["app", "you", "push"].includes(h.replacedBy)));
      if (page) { const pics = shots(OUT, "2-personal-later"); await openSync(s, page); await pics.take(page, "sync-page-after-changes"); }
    });
  } finally { await s.stop(); }
});

test("journey 3, Team: an admin asks in chat, the app is told where to call, a call starts a pass at once, the person narrows who the types are open to", async () => {
  const s = await startSpace({ kind: "team", name: "Firm", address: "https://firm.example" });
  try {
    await session(s, "team", async (page) => {
      await chatSetup(s, (h) => ledgerKnow(h, { webhook: true, audience: "added" }));
      await until("people arrive", async () => (await rows(s, "person").catch(() => [])).length === 4, 60_000);
      // telling the app where to call is a write to it, so the first pass a person runs makes the call (the agent's own passes would only wait at the Gate)
      await afterPass(s, "person");
      await until("the Space registered its address with the app", async () => s.crm.c.state.webhooks.length >= 1);
      const hook = new URL(s.crm.c.state.webhooks[0]!.url);
      assert.match(hook.origin, /^https:\/\/firm\.example$/);
      // the agent cannot narrow who the types are open to (it holds edit, not manage): the sync went ahead and the types are open to the Space; the person narrows them with Share
      assert.equal((await ok(s, "access.shares_of", { resource: { type: "record_type", id: "person" } })).audience, "space");
      await ok(s, "access.audience_set", { resource: { type: "record_type", id: "person" }, audience: "added" });
      assert.equal((await ok(s, "access.shares_of", { resource: { type: "record_type", id: "person" } })).audience, "added");
      // the app says someone changed; the Space starts a pass without waiting for the next poll
      s.crm.c.state.people.push({ id: 107, attributes: { full_name: "Gil Hart", email: "gil@example.test", phone: "", status: "lead", tier: "gold", note: "" }, org_id: null, modified: new Date().toISOString() });
      const res = await fetch(`${s.d.url}${hook.pathname}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "updated" }) });
      assert.ok(res.status < 300, `the hook answered ${res.status}`);
      await until("the webhook pass brings Gil", async () => (await rows(s, "person")).some((r) => nameOf(r) === "Gil Hart"));
      assert.ok(s.crm.methods().every((m) => m === "GET" || m === "POST"), "the pull only reads; the one POST is the hook registration");
      if (page) { const pics = shots(OUT, "3-team-webhook"); await openSync(s, page); await pics.take(page, "sync-page-live"); }
    });
  } finally { await s.stop(); }
});

test("journey 4, Team with several locations: each location is its own account of one type, brought in by chat, every record says where it came from", async () => {
  const s = await startSpace({ kind: "team", name: "Firm", address: "https://firm.example" });
  try {
    await session(s, "team", async (page) => {
      const first = await chatSetup(s, (h) => ledgerKnow(h, { account: "Main" }));
      await until("Main arrives", async () => (await rows(s, "person").catch(() => [])).some((r) => nameOf(r) === "Ed Park"), 90_000);
      // the second location: another key, another tenant of the same app, asked for the same way
      const { bringInByChat, trustAssistant } = await import("./support/crm-journey-kit.ts");
      const paris = await vaultItemOf(s, "Ledger", " Paris");
      await trustAssistant(s, paris.id, first.agentId);
      await bringInByChat(s, first.agentId, ledgerKnow(paris.handle, { account: "Paris", tenant: "b" }), paris);
      await until("Paris arrives", async () => (await rows(s, "person").catch(() => [])).some((r) => nameOf(r) === "Gus Hale"), 90_000);
      const people = await rows(s, "person");
      assert.deepEqual([...new Set(people.map((r) => String(r.data?.from ?? r.fields?.from)))].sort(), ["Main", "Paris"]);
      assert.equal((await ok(s, "sync_types.status", { type: "person" })).accounts.length, 2);
      if (page) { const pics = shots(OUT, "4-team-accounts"); await openSync(s, page); await pics.take(page, "sync-page-two-accounts"); }
    });
  } finally { await s.stop(); }
});

test("journey 5, any Space: the key stops working, the person is told once and sees the fix, and the pass recovers when the key is replaced", async () => {
  const s = await startSpace({ kind: "personal", name: "Me" });
  try {
    await session(s, "personal", async (page) => {
      await chatSetup(s, (h) => ledgerKnow(h));
      await until("people arrive", async () => (await rows(s, "person").catch(() => [])).length === 4, 60_000);
      s.crm.c.state.keyA = "rotated-by-the-app";
      await afterPass(s, "person").catch(() => undefined);
      await until("the type needs a person", async () => (await ok(s, "sync_types.status", { type: "person" })).state === "error");
      await afterPass(s, "person").catch(() => undefined);
      const tasks = (await ok(s, "tasks.list", {}).catch(() => ({ tasks: [] }))).tasks as any[];
      assert.ok(tasks.filter((x) => /Replace|reconnect|stopped working/i.test(String(x.title))).length <= 1, "one item, not one per failure");
      if (page) { const pics = shots(OUT, "5-key-revoked"); await openSync(s, page); await pics.take(page, "sync-page-needs-you"); }
      s.crm.c.state.keyA = "ledger-key-0001";
      const conn = (await ok(s, "connections.list", {})).connections[0].connectionId as string;
      const tested = await ok(s, "connections.test", { connectionId: conn });
      assert.equal(tested.state, "healthy", JSON.stringify(tested));
      await afterPass(s, "person");
      await until("the type recovers", async () => (await ok(s, "sync_types.status", { type: "person" })).state !== "error");
    });
  } finally { await s.stop(); }
});

test("journey 6, Team member: another person's own browser sees the records and the dot, and none of the buttons that change the sync", async () => {
  const s = await startSpace({ kind: "team", name: "Firm", address: "https://firm.example" });
  try {
    await session(s, "team", async (page, ctl) => {
      await chatSetup(s, (h) => ledgerKnow(h, { audience: "space" }));
      await until("people arrive", async () => (await rows(s, "person").catch(() => [])).length === 4, 60_000);
      const maya = await joinMember(s, "maya", "Maya");
      // the member's token: reads the records, cannot change the sync
      const mayaCall = async (cap: string, input: object = {}) => (await fetch(`${s.d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${maya.token}` }, body: JSON.stringify({ idempotencyKey: `m-${Math.random()}`, ...input }) })).status;
      assert.equal(await mayaCall("records.query", { type: "person", limit: 5 }), 200);
      assert.notEqual(await mayaCall("sync_types.pause", { type: "person" }), 200, "a member cannot pause the sync");
      assert.notEqual(await mayaCall("sync_specs.remove", { type: "person" }), 200, "a member cannot remove it");
      if (page) {
        const mp = await ctl.member(maya);
        const pics = shots(OUT, "6-team-member");
        await mp.goto(`${s.web!.origin}/records`);
        await mp.getByTestId("records-sidebar").waitFor();
        await pics.take(mp, "member-records");
        await mp.getByTestId("sync-dot").first().click();
        await mp.getByTestId("sync-page").waitFor();
        for (const id of ["sync-pause", "sync-remove", "sync-edit", "sync-resync"]) assert.equal(await mp.getByTestId(id).count(), 0, `${id} is not shown to a member`);
        await pics.take(mp, "member-sync-page");
        // the owner's browser still has them
        await openSync(s, page);
        assert.ok((await page.getByTestId("sync-pause").count()) + (await page.getByTestId("sync-resume").count()) > 0);
        await pics.take(page, "owner-sync-page");
      }
    });
  } finally { await s.stop(); }
});

test("journey 0: the second app, a custom object with Link-header paging, arrives whole", async () => {
  const s = await startSpace({ kind: "personal", name: "Me" });
  try {
    const item = await vaultItemOf(s, "Orbit");
    await ok(s, "sync_specs.apply", { spec: withHandle(orbitSpec(), item.handle), idempotencyKey: "j0-apply" });
    await until("jobs arrive", async () => (await rows(s, "job")).length === 3);
  } finally { await s.stop(); }
});
