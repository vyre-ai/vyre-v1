// The real-app walk for Add people and agents (lane l-addsheet), on box B with no reinstall: the lane's own exported apps/app/dist and the shared node_modules. A booted daemon with a scripted model;
// a group chat in a project (about a record, in the project's folder). The owner opens the chat and the Add sheet, adds Mia with Include earlier messages on, and the walk asserts the footer names the
// REAL folder and record and that Mia then reads from the start over the API; it pokes an agent from its Here now row and asserts the reply says "Poked by". Every shot goes through the crash guard.
//   node --import tsx scripts/shots/l-addsheet-walk.mts [out-dir]      (after: cd apps/app && /root/export-slot.sh ../../node_modules/.bin/expo export --platform web --output-dir dist)
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const R = process.cwd();
const eco = await import(R + "/test/support/eco-live.ts");
const h = await import(R + "/apps/app/tests/real-app-harness.test.ts");
const { guardCrashes } = await import(R + "/apps/app/tests/crash-guard.ts");
const { CORE_SPACE } = await import(R + "/fixtures/seed/core/index.ts");
const require = createRequire(R + "/package.json");
const { chromium } = require("playwright-core");
const out = process.argv[2] ?? "/root/wt/tmp-l-addsheet/walk-shots";
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
setTimeout(() => { console.log("WATCHDOG"); process.exit(9); }, 900000).unref();

const WHO = ["usr_olivia", "usr_mia"];
const failures: string[] = [];
const check = (ok: boolean, what: string): void => { console.log(ok ? "OK  " : "FAIL", what); if (!ok) failures.push(what); };
const model = eco.scriptedModel(async function* () { yield { type: "text", text: "Here is where it stands: the retainer is drafted and waiting on Mia." }; });

console.log("step boot");
const ownerToken = { v: "" };
const d = await eco.boot(eco.seededDir(), model, {
  vault: undefined,
  session: (headers: Record<string, string | undefined>) => {
    const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
    const id = t === ownerToken.v ? "usr_olivia" : t;
    return WHO.includes(id) ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "addsheet-walk" } : null;
  },
});
ownerToken.v = d.token;
const api = async (who: string, cap: string, input: unknown): Promise<any> => {
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify(input) });
  const b = (await r.json()) as any; if (r.status !== 200) console.log("API", who, cap, r.status, JSON.stringify(b).slice(0, 300)); return b.data ?? b;
};
const list = async (who: string, threadId: string): Promise<any[]> => { await d.hooks?.pump?.(); return (await api(who, "chat.messages.list", { threadId })).messages ?? []; };
const until = async (f: () => Promise<boolean>, what: string, ms = 60000): Promise<boolean> => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await new Promise((r) => setTimeout(r, 250)); } console.log("NEVER", what); return false; };

await eco.connect(d);
const agentId = (await api("usr_olivia", "agents.create", { name: "Intake", role: "You help the team.", idempotencyKey: "aw-agent" })).agent.agentId as string;
const keys = await api("usr_olivia", "vault.folders.create", { idempotencyKey: "aw-ai", name: "AI accounts", scope: "shared" });
const acct = await api("usr_olivia", "providers.add", { idempotencyKey: "aw-acct", providerKey: "anthropic", connection: "api_key", apiKey: `${eco.KEY}A`, name: "Team AI", scope: "shared", folderId: keys.folder.id });
await api("usr_olivia", "agents.update", { agentId, patch: { accountPolicy: "key", accountKey: acct.provider.handle }, idempotencyKey: "aw-upd" });

// a project with its own folder, a record linked to it, and a group chat in it that is about that record
const client = await api("usr_olivia", "projects.create", { type: "project", title: "Rivera file", idempotencyKey: "aw-client" });
const project = await api("usr_olivia", "projects.create", { type: "project", title: "Rivera engagement", idempotencyKey: "aw-project" });
const ov = await api("usr_olivia", "projects.overview", { projectId: project.projectId });
const clientRecord = (await api("usr_olivia", "projects.overview", { projectId: client.projectId })).project.recordId as string;
await api("usr_olivia", "projects.links.link", { projectId: project.projectId, kind: "record", ref: clientRecord });
const folderName = (await api("usr_olivia", "files.folder.get", { folderId: ov.project.folderId })).folder.name as string;
const chat = (await api("usr_olivia", "chat.start", { kind: "chat", agentIds: [agentId], title: "Rivera retainer chat", scopeType: "project", scopeId: project.projectId, folderId: ov.project.folderId, recordId: clientRecord, idempotencyKey: "aw-chat" })).thread.threadId as string;
await api("usr_olivia", "chat.post", { threadId: chat, body: "The retainer figure is 40000 dollars.", idempotencyKey: "aw-early" });
console.log("PROJECT FOLDER", folderName, "| RECORD", "Rivera file");

{ const { DatabaseSync } = await import("node:sqlite"); const db = new DatabaseSync(d.paths.modules);
  for (const [id, name] of [["usr_mia", "Mia Torres"], ["usr_olivia", "Olivia Grant"]]) { try { db.prepare(`INSERT OR IGNORE INTO identity_accounts (person_id, username, name, verifier, created_at) VALUES (?, ?, ?, 'test', ?)`).run(id, id.slice(4), name, Date.now()); } catch (e) { console.log("acct", String(e).slice(0, 100)); } }
  db.close(); }

console.log("step edge");
const web = await h.edge(R + "/apps/app/dist", d.url);
const origin = web.origin;
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const guards = new Map<any, any>();
let crashed = 0;
async function open(who: string, o: { mode?: "light" | "dark"; w?: number; hh?: number } = {}) {
  const ctx = await browser.newContext({ viewport: { width: o.w ?? 1440, height: o.hh ?? 900 }, colorScheme: o.mode ?? "light", deviceScaleFactor: 1 });
  const sp = await api(who, "spaces.get", {});
  const s = { ...h.ownerSession({ url: d.url, token: who, space: CORE_SPACE, dir: "", stop: async () => undefined, claim: null }, origin), token: who, personId: who, marker: sp?.space?.fingerprint, username: who.slice(4) };
  (s.def as any).name = "Northwind"; (s.def as any).role = who === "usr_olivia" ? "Owner" : "Member"; (s.def as any).console = false;
  await ctx.addInitScript((val: string) => { try { if (!localStorage.getItem("vyre.session.v1")) localStorage.setItem("vyre.session.v1", val); } catch {} }, JSON.stringify({ sessions: { [origin]: s } }));
  const page = await ctx.newPage();
  const guard = guardCrashes(page);
  guards.set(page, guard);
  page.on("pageerror", (e: Error) => console.log("PAGEERROR", e.message.slice(0, 300)));
  await page.goto(origin + "/chat", { waitUntil: "load" });
  for (let i = 0; i < 3; i++) {
    await page.getByText("Continue", { exact: true }).click({ timeout: 1500 }).catch(() => undefined);
    await page.getByTestId("onboarding-close").click({ timeout: 2500 }).catch(() => undefined);
    await page.getByText("Finish later", { exact: true }).click({ timeout: 1500 }).catch(() => undefined);
  }
  await page.getByText("Hide", { exact: true }).first().click({ timeout: 1500 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  await page.getByText("Rivera retainer chat", { exact: true }).first().click({ timeout: 15000 }).catch((e: any) => console.log("nochat", String(e).slice(0, 160)));
  await page.getByText("The retainer figure is 40000").first().waitFor({ timeout: 15000 }).catch(() => console.log("nomessage"));
  await guard.check("after opening the chat");
  return { ctx, page };
}
const shot = async (page: any, name: string): Promise<void> => {
  await page.waitForTimeout(700);
  try { await guards.get(page)?.check(`before ${name}`); } catch (e) { crashed++; console.log("CRASH", String(e instanceof Error ? e.message : e).slice(0, 300)); }
  await page.screenshot({ path: path.join(out, `${name}.png`) }); console.log("shot", name);
};
const openSheet = async (page: any, phone: boolean): Promise<void> => {
  if (phone) { await page.getByTestId("composer-attach").click({ timeout: 8000 }); await page.getByTestId("row-plus-people").click({ timeout: 8000 }); }
  else { await page.getByTestId("participants-button").click({ timeout: 8000 }); await page.getByTestId("people-footer").click({ timeout: 8000 }); }
  await page.getByTestId("add-sheet").waitFor({ timeout: 10000 });
  await guards.get(page)?.check("after opening the Add sheet");
};

try {
  for (const mode of ["light", "dark"] as const) for (const [w, hh, tag] of [[1440, 900, "1440"], [390, 844, "390"]] as const) {
    const phone = w < 640;
    const { page, ctx } = await open("usr_olivia", { mode, w, hh });
    await openSheet(page, phone);
    await shot(page, `real-sheet-empty-${mode}-${tag}`);
    // (2) Mia, with Include earlier messages on: the footer names the real folder and the record
    await page.getByTestId("as-search").fill("Mia");
    await page.getByTestId("as-row-person:usr_mia").click({ timeout: 8000 });
    await page.getByTestId("as-earlier").click({ timeout: 8000 });
    await guards.get(page)?.check("after picking Mia");
    const footer = (await page.getByTestId("as-line-std").innerText()).replace(/\s+/g, " ").trim();
    console.log("FOOTER", mode, tag, footer);
    check(footer === `They'll see the whole chat, its files folder ${folderName}, and records in Rivera file.`, `real footer (${mode} ${tag}): ${footer}`);
    check(!footer.includes("Rivera retainer chat"), `the footer never uses the chat's own name (${mode} ${tag})`);
    await shot(page, `real-sheet-earlier-${mode}-${tag}`);
    await page.getByTestId("as-cancel").click({ timeout: 8000 });
    await ctx.close();
  }
  // (3) Poke an agent from its Here now row in the sheet; the reply says Poked by
  for (const mode of ["light", "dark"] as const) for (const [w, hh, tag] of [[1440, 900, "1440"], [390, 844, "390"]] as const) {
    const { page, ctx } = await open("usr_olivia", { mode, w, hh });
    await openSheet(page, w < 640);
    const poke = page.getByTestId(`as-here-poke-${agentId}`);
    check((await poke.count()) === 1, `Poke is on the agent's Here now row (${mode} ${tag})`);
    check((await page.getByTestId("as-here-poke-usr_mia").count()) === 0, `no Poke on a person's row (${mode} ${tag})`);
    if (mode === "light" && tag === "1440") {
      await poke.click({ timeout: 8000 });
      const replied = await until(async () => (await list("usr_olivia", chat)).some((m: any) => (m.blocks ?? []).some((b: any) => b.type === "poked")), "the poked reply", 90000);
      check(replied, "the agent's reply carries the poked block");
      await page.getByTestId("as-cancel").click({ timeout: 8000 });
      const marked = await page.getByText(/Poked by/).first().waitFor({ timeout: 20000 }).then(() => true, () => false);
      check(marked, "the reply shows Poked by on screen");
      const text = await page.getByText(/Poked by/).first().innerText().catch(() => "");
      console.log("POKED MARK", text);
      await shot(page, `real-poked-${mode}-${tag}`);
    } else { await shot(page, `real-sheet-here-${mode}-${tag}`); await page.getByTestId("as-cancel").click({ timeout: 8000 }); }
    await ctx.close();
  }
  // (2, last) Mia is added with Include earlier messages on, and reads from the start
  { const { page, ctx } = await open("usr_olivia", { mode: "light" });
    await openSheet(page, false);
    await page.getByTestId("as-search").fill("Mia");
    await page.getByTestId("as-row-person:usr_mia").click({ timeout: 8000 });
    await page.getByTestId("as-earlier").click({ timeout: 8000 });
    await page.getByTestId("as-add").click({ timeout: 8000 });
    const seen = await until(async () => (await list("usr_mia", chat)).some((m: any) => /40000/.test(m.body ?? "")), "Mia reads from the start", 20000);
    check(seen, "Mia, added with earlier messages, reads the first message");
    await ctx.close(); }
} catch (e) { console.log("WALK FAILED", e); failures.push(String(e).slice(0, 200)); }
console.log(failures.length === 0 && crashed === 0 ? "WALK PASSED" : `WALK FAILED: ${failures.length} check(s), ${crashed} crash(es)`);
await browser.close(); web.close(); await eco.stop(d); process.exit(failures.length === 0 && crashed === 0 ? 0 : 1);
