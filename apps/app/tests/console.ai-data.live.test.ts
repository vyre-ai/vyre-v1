// Production web export against a fresh claimed Team Space. Every assertion crosses the real gateway and reads the mutation back.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createCapCaller } from "../../../client/src/gateway/index.ts";
import { routes } from "../../../generated/routes.ts";
import { bootFreshSpace, claimOnEdge, edge } from "./real-app-harness.test.ts";

test("production Console AI/Data: policies, spend, Gate, review, incidents, holds, export and typed schema persist", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { t.skip("VYRE_APP_DIST is required for production browser evidence"); return; }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  if (!fs.existsSync(exe)) assert.fail(`Chromium is required at ${exe}`);
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const captureDir = process.env["VYRE_TEST_CAPTURE_DIR"];
  const capture = async (name: string): Promise<void> => { if (captureDir) { fs.mkdirSync(captureDir, { recursive: true }); await page.screenshot({ path: `${captureDir}/${name}.png`, fullPage: true }); } };
  const errors: string[] = [], refused: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => { if (response.url().includes("/v1/") && response.status() >= 400) void response.text().then((body) => refused.push(`${response.status()} ${new URL(response.url()).pathname}: ${body.slice(0, 180)}`)); });
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("AI Data Owner"); await page.getByTestId("claim-username").fill("aidata");
    await page.getByTestId("claim-password").fill("fixture password 123"); await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click();
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(() => { const saved = JSON.parse(localStorage.getItem("vyre.session.v1")!); const origin = (globalThis as unknown as { location: { origin: string } }).location.origin; return saved.sessions?.[origin]?.token ?? saved.token; });
    const api = createCapCaller({ baseUrl: web.origin, token: () => token, routes: async () => routes });
    const open = async (screen: string, marker: string, pageId?: string): Promise<void> => {
      const pageArg = pageId ? `&page=${pageId}` : "";
      await page.goto(`${web.origin}/console#screen=${screen}${pageArg}`, { waitUntil: "load" });
      await page.getByTestId("console").waitFor({ timeout: 20_000 });
      await page.locator(marker).waitFor({ timeout: 20_000 });
    };

    await open("console.ai-models", '[data-testid="console-models"]');
    await page.getByRole("button", { name: "Accounts agents may use", exact: true }).click(); await page.getByRole("menuitem", { name: "Company accounts only", exact: true }).click();
    await page.getByTestId("models-policy-review").click(); await page.getByTestId("models-policy-apply").click(); await page.getByText("AI policy saved", { exact: true }).waitFor();
    assert.equal((await api("engine.policy.get", {}) as { allowedAccounts: string }).allowedAccounts, "company");
    await capture("models-policy");
    t.diagnostic("PASS Models policy mutation and readback");

    await open("console.ai-spend", '[data-testid="console-ai-spend"]');
    await page.getByRole("button", { name: "Edit limits", exact: true }).click(); await page.getByLabel("Per day ($)", { exact: true }).fill("3.5");
    await page.getByRole("button", { name: "Review limit changes", exact: true }).click(); await page.getByRole("button", { name: "Apply limits", exact: true }).click(); await page.getByText("Limits updated", { exact: true }).waitFor();
    assert.equal((await api("engine.spend.get", { scope: "space" }) as { caps: { dayMicros?: number } }).caps.dayMicros, 3_500_000);
    t.diagnostic("PASS Spend cap mutation and readback");

    await open("gate.rules", '[data-testid="console"]');
    await page.getByText(/Send a message · medium risk/i).click(); await page.getByRole("button", { name: "Decision", exact: true }).click(); await page.getByRole("menuitem", { name: "Require approval", exact: true }).click();
    await page.getByTestId("gate-rule-review").click(); await page.getByTestId("gate-rule-apply").click(); await page.getByText("Gate rule saved", { exact: true }).waitFor();
    assert.equal((await api("gate.rules.list", { scope: "space" }) as { rules: { act: string; mode: string }[] }).rules.find((rule) => rule.act === "send")?.mode, "hold");
    t.diagnostic("PASS Gate mutation and readback");

    await open("console.logging", '[data-testid="console-ai-logging"]');
    await page.getByRole("button", { name: "Detail kept for each turn", exact: true }).click(); await page.getByRole("menuitem", { name: "Steps and tool input/output", exact: true }).click(); await page.getByText("Logging policy updated", { exact: true }).waitFor();
    assert.equal((await api("settings.get", { key: "engine.logging" }) as { row: { value: string } }).row.value, "steps_and_tool_io");
    t.diagnostic("PASS Logging mutation and readback");

    await open("console.ai-review", '[data-testid="console-ai-review"]');
    await page.getByLabel("Percent of turns", { exact: true }).fill("25"); await page.getByRole("button", { name: "Review sampling change", exact: true }).click(); await page.getByRole("button", { name: "Apply sampling", exact: true }).click(); await page.getByText("Review sampling updated", { exact: true }).waitFor();
    assert.equal((await api("settings.get", { key: "engine.review_sampling" }) as { row: { value: { percent: number } } }).row.value.percent, 25);
    t.diagnostic("PASS Review sampling mutation and readback");

    await open("console.ai-incidents", '[data-testid="console-ai-incidents"]');
    await page.getByLabel("Title", { exact: true }).fill("Browser AI incident"); await page.getByLabel("Opening note", { exact: true }).fill("Opened by production proof"); await page.getByRole("button", { name: "Open incident", exact: true }).click();
    await page.getByText("Browser AI incident", { exact: true }).first().waitFor();
    const incident = (await api("engine.incidents.list", { state: ["open"], limit: 100 }) as { incidents: { incidentId: string; title: string }[] }).incidents.find((row) => row.title === "Browser AI incident"); assert.ok(incident);
    await page.getByTestId("object-action-assign").click(); await page.getByRole("button", { name: "Owner", exact: true }).click();
    const principals = (await api("access.principals.list", { kind: "person", limit: 100 }) as { principals: { id: string; name: string }[] }).principals; const owner = principals[0]; assert.ok(owner, "the claimed Space exposes its owner principal");
    const ownerMenu = await page.getByRole("menuitem").allTextContents(); t.diagnostic(`Incident owner evidence: principals=${JSON.stringify(principals.map((person) => `${person.id}:${person.name}`))} menu=${JSON.stringify(ownerMenu)}`); assert.ok(ownerMenu.includes(owner.name), "the assignment menu names the live owner principal");
    await page.getByRole("menuitem", { name: owner.name, exact: true }).click(); await page.getByTestId("object-sheet").getByRole("button", { name: "Assign owner", exact: true }).click(); await page.getByText("Incident assigned", { exact: true }).waitFor();
    await page.getByLabel("Resolution or note", { exact: true }).fill("Verified note"); await page.getByRole("button", { name: "Add note", exact: true }).click(); await page.getByText("Note added", { exact: true }).waitFor();
    await page.getByTestId("object-more").click(); await page.getByRole("menuitem", { name: "Resolve incident", exact: true }).click(); await page.getByTestId("object-confirm-go").click(); await page.getByText("Incident resolved", { exact: true }).waitFor();
    const resolved = await api("engine.incident.get", { incidentId: incident.incidentId }) as { incident: { state: string; ownerId?: string; notes: { text: string }[] } };
    assert.equal(resolved.incident.state, "resolved"); assert.equal(resolved.incident.ownerId, owner.id); assert.ok(resolved.incident.notes.some((note) => note.text === "Verified note"));
    await capture("incidents-resolved");
    t.diagnostic("PASS Incident open, named assignment, note, resolve and readback");

    await open("governance.holds", 'text="Place a hold"', "holds");
    const holdSection = page.getByTestId("section-Place a hold");
    await page.getByLabel("Find a person, file, folder, channel or thread", { exact: true }).fill(owner.name); await holdSection.getByRole("button", { name: "Search", exact: true }).click();
    await holdSection.getByRole("button", { name: "Target", exact: true }).click(); await page.getByRole("menuitem", { name: `${owner.name} · person`, exact: true }).click();
    await page.getByLabel("Reason", { exact: true }).fill("Production browser release proof"); await page.getByRole("button", { name: "Review hold", exact: true }).click(); await page.getByRole("button", { name: "Place hold", exact: true }).click(); await page.getByText("Hold placed", { exact: true }).waitFor();
    const held = (await api("governance.holds.list", { kind: "person", limit: 100 }) as { holds: { target: { id: string }; reason: string }[] }).holds.find((hold) => hold.reason === "Production browser release proof"); assert.ok(held);
    await capture("person-hold-placed");
    await page.getByText(owner.name, { exact: true }).first().click(); await page.getByRole("button", { name: "Release hold", exact: true }).click(); await page.getByText("Hold released", { exact: true }).waitFor();
    assert.ok(!(await api("governance.holds.list", { kind: "person", limit: 100 }) as { holds: { target: { id: string } }[] }).holds.some((hold) => hold.target.id === held.target.id));
    t.diagnostic("PASS Person hold place, readback, release and readback");

    await open("governance.erase", 'text="Find a person"', "erase");
    await page.getByLabel("Name", { exact: true }).fill(owner.name); await page.getByRole("button", { name: "Find data", exact: true }).click(); await page.getByText("Erase preview", { exact: true }).waitFor(); await page.getByText("Preview expires", { exact: true }).waitFor();
    assert.equal((await api("governance.erase.list", { limit: 100 }) as { erasures: unknown[] }).erasures.length, 0, "previewing a real person must not start erasure");
    await capture("erase-person-preview"); t.diagnostic("PASS Erase real-Person finding without apply");

    await open("console.ai-spend", '[data-testid="ai-policy-export"]', "aipolicy");
    const exportResponse = page.waitForResponse((response) => response.url().includes("/v1/engine/use_policy/export") && response.status() === 200);
    await page.getByTestId("ai-policy-export").click();
    const exportBody = await (await exportResponse).json() as { data: { fileId: string } };
    const exported = exportBody.data;
    await page.getByTestId("file-viewer").waitFor({ timeout: 20_000 });
    const file = await api("files.viewer_data", { fileId: exported.fileId }) as { file: { name: string; mime: string }; text?: string };
    assert.match(file.file.name, /^AI use policy .*\.md$/); assert.equal(file.file.mime, "text/markdown"); assert.match(file.text ?? "", /^# AI use policy/m); assert.match(file.text ?? "", /Allowed accounts: company accounts only/i);
    await capture("ai-policy-export");

    await open("console.schema", '[data-testid="console-schema"]', "schema");
    await page.getByRole("button", { name: "Create record type", exact: true }).click(); await page.getByLabel("Type key", { exact: true }).fill("browser_ai_data"); await page.getByLabel("Singular title", { exact: true }).fill("Browser AI datum"); await page.getByLabel("Plural title", { exact: true }).fill("Browser AI data");
    await page.getByTestId("schema-preview").click(); await page.getByRole("button", { name: "Apply exact preview", exact: true }).click(); await page.getByText("Schema updated", { exact: true }).waitFor();
    assert.ok((await api("schema.describe", {}) as { types: { key: string }[] }).types.some((type) => type.key === "browser_ai_data"));
    await page.getByText("Browser AI datum", { exact: true }).first().click(); await page.getByRole("button", { name: "Add field", exact: true }).click();
    await page.getByLabel("Field key", { exact: true }).fill("risk_score"); await page.getByLabel("Field title", { exact: true }).fill("Risk score"); await page.getByRole("button", { name: "Field type", exact: true }).click(); await page.getByRole("menuitem", { name: "Number", exact: true }).click();
    await page.getByTestId("schema-preview").click(); await page.getByRole("button", { name: "Apply exact preview", exact: true }).click(); await page.getByText("Schema updated", { exact: true }).waitFor();
    const typed = (await api("schema.describe", {}) as { types: { key: string; fields: { key: string; type: string }[] }[] }).types.find((type) => type.key === "browser_ai_data"); assert.equal(typed?.fields.find((field) => field.key === "risk_score")?.type, "number");
    await capture("schema-typed-field");

    await open("console.labels", '[data-testid="console-labels"]', "labels");
    await page.getByText("Restricted", { exact: true }).click(); await page.getByRole("button", { name: "Resource", exact: true }).click(); await page.getByRole("menuitem", { name: "Browser AI datum", exact: true }).click(); await page.getByTestId("label-set").click(); await page.getByText("Label updated", { exact: true }).waitFor();
    assert.equal((await api("schema.describe", {}) as { types: { key: string; label: string }[] }).types.find((type) => type.key === "browser_ai_data")?.label, "restricted");
    await capture("sensitivity-label");

    const retention = await api("governance.retention.get", {}) as { kinds: { key: string; title: string; value: string; default: string }[] };
    const recordRetention = retention.kinds.find((row) => row.key === "records"); assert.ok(recordRetention);
    await open("governance.retention", 'text="Retention policies"', "retention");
    await page.getByText(recordRetention.title, { exact: true }).first().click();
    await page.getByLabel("Retention duration", { exact: true }).fill("90d");
    await page.getByRole("button", { name: "Review change", exact: true }).click();
    await page.getByRole("button", { name: "Apply rule", exact: true }).click();
    await page.getByText("Retention rule updated", { exact: true }).waitFor();
    assert.equal((await api("governance.retention.get", {}) as typeof retention).kinds.find((row) => row.key === "records")?.value, "90d");
    await capture("retention-policy");
    await page.getByRole("button", { name: "Reset to default…", exact: true }).click();
    await page.getByRole("button", { name: "Confirm reset", exact: true }).click();
    await page.getByText("Retention reset", { exact: true }).waitFor();
    assert.equal((await api("governance.retention.get", {}) as typeof retention).kinds.find((row) => row.key === "records")?.value, recordRetention.default);
    t.diagnostic("PASS Retention mutation, reset and readback");

    assert.deepEqual(errors, []); assert.deepEqual(refused, []);
  } catch (error) {
    const failureDir = captureDir ?? "/tmp/vyre-console-ai-lifecycle"; fs.mkdirSync(failureDir, { recursive: true });
    await page.screenshot({ path: `${failureDir}/failure.png`, fullPage: true }).catch(() => undefined);
    fs.writeFileSync(`${failureDir}/failure.txt`, `${await page.locator("body").innerText().catch(() => "No DOM text")}${refused.length ? `\n\nRefused:\n${refused.join("\n")}` : ""}`);
    throw error;
  } finally { await context.close(); await browser.close(); web.close(); await space.stop(); fs.rmSync(space.dir, { recursive: true, force: true }); }
});
