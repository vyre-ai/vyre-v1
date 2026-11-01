// The shared parts of the CRM to Records journeys (test/crm.journey1.live.test.ts to journey3): the Ledger the agent reads, the signed-in browser session, the Looks good tap.
// CRM to Records as a person lives it, in a Personal Space and a Team Space: a daemon in this process, the app's production export in Chromium (CI builds it; VYRE_APP_DIST), a fake CRM behind
// the connector network (a real HTTP server with webhooks). Each journey asserts what the person would see and what the app was told, and takes four pictures per step (desktop and phone,
// light and dark) under VYRE_TEST_CAPTURE_DIR/crm/<journey>. A journey starts the way a person does: in chat, with the agent stand-in (the crm-sync-builder skill as a script) reading the fake CRM,
// proposing, and the person tapping Looks good (on the question card in the browser; through the capability the card calls when there is no browser).
import path from "node:path";
import { claimOnEdge, dismissOnboarding } from "../../apps/app/tests/real-app-harness.test.ts";
import { ok, shots } from "./crm-journey-kit.ts";
import type { Space } from "./crm-journey-kit.ts";
import type { Know } from "./agent-standin.ts";

export interface KnowOpts { account?: string; tenant?: string; webhook?: boolean; audience?: "space" | "added" | "me" }
export const ledgerKnow = (handle: string, o: KnowOpts = {}): Know => ({
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
export const OUT = path.join(process.env["VYRE_TEST_CAPTURE_DIR"] ?? path.join(process.env["TMPDIR"] ?? "/tmp", "vyre-crm-journeys"), "crm");

/* eslint-disable @typescript-eslint/no-explicit-any */
type Pg = any;
export const rows = async (s: Space, type: string): Promise<any[]> => (await ok(s, "records.query", { type, limit: 200 })).rows as any[];
export const nameOf = (r: any): string => String(r.data?.name ?? r.fields?.name ?? "");
export interface Ctl { member(who: { personId: string; token: string }): Promise<Pg> }

/** The journey, with a signed-in browser when CI has built the app (null otherwise: the host parts still run). The owner claims the Space first, as a person does. */
export async function session<T>(s: Space, kind: "personal" | "team", fn: (page: Pg | null, ctl: Ctl) => Promise<T>): Promise<T> {
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
export const openSync = async (s: Space, page: Pg): Promise<void> => {
  await page.goto(`${s.web!.origin}/records`);
  await page.getByTestId("sync-dot").first().click();
  await page.getByTestId("sync-page").waitFor();
};
/** The Looks good tap on the question card in the chat, in the browser. */
export const tapIn = (page: Pg | null, s: Space, pics: ReturnType<typeof shots> | null) => page === null ? undefined : async (threadId: string): Promise<void> => {
  await page.goto(`${s.web!.origin}/chats#thread=${threadId}`);
  await page.getByTestId("chats-place").waitFor();
  const looksGood = page.getByRole("button", { name: "Looks good" }).first();
  await looksGood.waitFor({ timeout: 30_000 });
  if (pics) await pics.take(page, "the-proposal");
  await looksGood.click();
};
export const afterPass = async (s: Space, type: string): Promise<void> => { await ok(s, "connectors.sync_now", { type, idempotencyKey: `n-${Math.random().toString(36).slice(2)}` }); };

