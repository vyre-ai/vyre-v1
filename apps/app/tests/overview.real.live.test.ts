// The project Overview in the real app against a real daemon (lane l-editor): the Client account page with its real data. Three unpaid invoices are made through the real create path, the page's
// "Unpaid" block shows the server's own sum of their amounts, and changing one record and adding another changes the number the person sees. Shots (paper and graphite, wide and phone) go to VYRE_OVERVIEW_SHOTS.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { applyInput } from "../src/places/records/typeedit/model.ts";

const PASSWORD = "fixture password 123";

test("Overview, real data: an Unpaid block sums real invoices, and the number follows the records", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const shots = process.env["VYRE_OVERVIEW_SHOTS"] ?? "/tmp/vyre-overview-shots"; fs.mkdirSync(shots, { recursive: true });
  const errs: string[] = [];
  try {
    const owner = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await owner.newPage();
    page.on("pageerror", (e) => errs.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 2500)); });
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Olivia Owner"); await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill(PASSWORD); await page.getByTestId("claim-confirm").fill(PASSWORD);
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click(); await dismissOnboarding(page);
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);
    let n = 0;
    const call = async (cap: string, data: Record<string, unknown>): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await owner.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data: { idempotencyKey: `ov-${cap}-${++n}`, ...data } });
      const body = await r.json();
      assert.equal(r.status(), 200, `${cap}: ${JSON.stringify(body).slice(0, 500)}`);
      return body.data;
    };
    // the Invoice record type, made the way the Records sheet makes one: a diff, then an apply on its preview
    const ops = [
      { op: "type.create", type: "invoice", def: { title: "Invoice", plural: "Invoices", icon: "table", label: "internal", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }] } },
      { op: "field.add", type: "invoice", field: "amount", def: { title: "Amount", type: "money", required: false } },
      { op: "field.add", type: "invoice", field: "status", def: { title: "Status", type: "choice", required: false, options: { choices: [{ key: "sent", title: "Sent" }, { key: "paid", title: "Paid" }, { key: "overdue", title: "Overdue" }] } } },
    ];
    const preview = await call("schema.diff", { ops });
    assert.deepEqual(preview.problems, []);
    await call("schema.apply", applyInput(preview, ops as never) as unknown as Record<string, unknown>);
    const money = (amount: number): { amount: number; currency: string } => ({ amount, currency: "USD" });
    const made = [
      await call("records.create", { type: "invoice", fields: { name: "INV-104", amount: money(2400), status: "sent" } }),
      await call("records.create", { type: "invoice", fields: { name: "INV-105", amount: money(1250), status: "sent" } }),
      await call("records.create", { type: "invoice", fields: { name: "INV-106", amount: money(900), status: "sent" } }),
      await call("records.create", { type: "invoice", fields: { name: "INV-103", amount: money(600), status: "paid" } }),
    ];
    const types = (await call("schema.types.list", {})).types as Array<{ key: string }>;
    const type = (types.find((x) => /project|matter/.test(x.key)) ?? types[0]!).key;
    const project = await call("projects.create", { type, title: "Rivera account", overviewTemplate: "tpl_client_account" });
    const pid = project.projectId as string;
    await call("projects.overview", { projectId: pid });

    const open = async (size: "wide" | "phone", tag: string, skin: "paper" | "graphite" = "paper"): Promise<string> => {
      // the way the projects walk gets there: the shell first, then the project (a row on a wide screen, the link on a phone)
      await page.goto(`${web.origin}/chat?skin=${skin}`, { waitUntil: "load" });
      if (size === "phone") { await page.getByTestId("mobile-shell").waitFor({ timeout: 30_000 }); await page.goto(`${web.origin}/chat?skin=${skin}#subject=project:${pid}`, { waitUntil: "load" }); }
      else { await page.getByTestId("shell").waitFor({ timeout: 30_000 }); await page.getByTestId("head-projects").waitFor({ timeout: 20_000 }); await page.getByTestId(`row-pj:${pid}`).click(); }
      await page.getByTestId("project-page").waitFor({ timeout: 25_000 }).catch(async (e: Error) => {
        const ids = await page.evaluate(() => [...document.querySelectorAll("[data-testid]")].map((x) => x.getAttribute("data-testid")).slice(0, 60));
        fs.writeFileSync(path.join(shots, `debug-${tag}-${size}.txt`), `${page.url()}\n${JSON.stringify(ids)}\n${errs.join("\n---\n")}\n${(await page.locator("body").innerText()).slice(0, 2000)}`);
        await page.screenshot({ path: path.join(shots, `debug-${tag}-${size}.png`) });
        throw new Error(`no project page: ${e.message.slice(0, 60)}`);
      });
      await page.waitForTimeout(1200); await page.getByTestId("tab-overview").click({ force: true, timeout: 10_000 }).catch(async (e: Error) => {
        const ids = await page.evaluate(() => [...document.querySelectorAll("[data-testid]")].map((x) => x.getAttribute("data-testid")).slice(0, 60));
        await page.getByTestId("state-details").click({ timeout: 2000 }).catch(() => undefined);
        const cause = await page.getByTestId("state-cause").innerText({ timeout: 2000 }).catch(() => "");
        fs.writeFileSync(path.join(shots, `debug-${tag}-${size}.txt`), cause + "\n" + errs.join("\n---\n") + "\n" + (await page.locator("body").innerText()).slice(0, 3000));
        await page.screenshot({ path: path.join(shots, `debug-${tag}-${size}.png`) });
        throw new Error(`no overview tab at ${page.url()}: ${JSON.stringify(ids)} errors=${JSON.stringify(errs.slice(0, 3))} / ${e.message.slice(0, 60)}`);
      });
      await page.getByTestId("project-overview").waitFor({ timeout: 20_000 });
      await page.locator("[data-testid=live-metric] [data-testid=live-number]").first().waitFor({ timeout: 20_000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(shots, `overview-real-${tag}-${size}-${skin}.png`) });
      return (await page.locator("[data-testid=live-metric] [data-testid=live-number]").first().innerText()).trim();
    };
    // 2400 + 1250 + 900 of the three that are sent; the paid one is not counted
    assert.equal(await open("wide", "1-three-unpaid"), "$4,550");
    assert.equal(await open("wide", "1-three-unpaid", "graphite"), "$4,550");
    assert.match(await page.locator("[data-testid=live-metric] [data-testid=live-metric-line]").first().innerText(), /unpaid across 3 invoices/);
    // one record changes: the number follows it
    await call("records.update", { type: "invoice", recordId: made[2].record.id, patch: { amount: money(2900) } });
    assert.equal(await open("wide", "2-one-changed"), "$6,550");
    assert.equal(await open("wide", "2-one-changed", "graphite"), "$6,550");
    // a fourth unpaid invoice is added
    await call("records.create", { type: "invoice", fields: { name: "INV-107", amount: money(450), status: "sent" } });
    assert.equal(await open("wide", "3-one-added"), "$7,000");
    assert.match(await page.locator("[data-testid=live-metric] [data-testid=live-metric-line]").first().innerText(), /unpaid across 4 invoices/);
    assert.equal(await open("wide", "3-one-added", "graphite"), "$7,000");
    // a euro invoice: the currencies are reported apart, never added into one number
    await call("records.create", { type: "invoice", fields: { name: "INV-108", amount: { amount: 900, currency: "EUR" }, status: "sent" } });
    assert.equal(await open("wide", "4-two-currencies"), "$7,000 and \u20AC900");
    assert.match(await page.locator("[data-testid=live-metric] [data-testid=live-metric-line]").first().innerText(), /unpaid across 5 invoices/);
    assert.equal(await open("wide", "4-two-currencies", "graphite"), "$7,000 and \u20AC900");
    // the same page on a phone
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await open("phone", "5-phone"), "$7,000 and \u20AC900");
    assert.equal(await open("phone", "5-phone", "graphite"), "$7,000 and \u20AC900");
    assert.deepEqual(errs, [], "no page errors");
  } finally { await browser.close(); web.close(); await space.stop(); }
});
