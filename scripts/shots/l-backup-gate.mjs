// The notifications slot from the REAL gate: the production export, a booted fresh Space, the owner claimed through the claim screens, a second member (Dana Whitfield) who joins with real key bundles,
// replies under the owner's message and hands the owner a task to approve. The owner's top bar is then shot (the quiet line, the "+N" popover) in paper and graphite, wide and phone.
// Run on the build box from the worktree:  node scripts/shots/l-backup-gate.mjs <out-dir> [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-l-backup/gate-shots";
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } = await import(path.join(REPO, "apps/app/tests/real-app-harness.test.ts"));
const { makeBundle } = await import(path.join(REPO, "client/src/crypto/keys.ts"));
const dist = path.join(REPO, "apps/app/dist");
if (!args.includes("--skip-export")) {
  fs.rmSync(dist, { recursive: true, force: true });
  execSync((await import(path.join(process.cwd(), "scripts/shots/expo-cmd.mjs"))).exportCmd(process.cwd()), { cwd: path.join(REPO, "apps/app"), stdio: "inherit", env: exportEnv() });
  execSync(`node scripts/shots/registry-hash-in-bundle.mjs ${dist}`, { cwd: REPO, stdio: "inherit" });
}
fs.mkdirSync(out, { recursive: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");

const PW = "correct horse battery 9";
let n = 0;
const call = async (url, token, cap, input = {}) => {
  const r = await fetch(`${url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ idempotencyKey: `gate-${++n}`, ...input }) });
  const b = await r.json();
  if (r.status !== 200) throw new Error(`${cap}: ${r.status} ${JSON.stringify(b)}`);
  return b.data ?? b;
};

const space = await bootFreshSpace();
const web = await edge(dist, space.url);
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const SIZES = { wide: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
try {
  // the owner claims the Space on the claim screens, as a person does
  const c = await browser.newContext({ viewport: SIZES.wide });
  const p = await c.newPage();
  const cerrs = [];
  p.on("pageerror", (e) => cerrs.push(`pageerror: ${String(e).slice(0, 600)}`));
  p.on("console", (m) => { if (m.type() === "error") cerrs.push(`console: ${m.text().slice(0, 600)}`); });
  await p.goto(claimOnEdge(space.claim, web.origin), { waitUntil: "load", timeout: 60000 });
  await p.getByTestId("claim-name").fill("Olivia Owner");
  await p.getByTestId("claim-username").fill("olivia");
  await p.getByTestId("claim-password").fill(PW);
  await p.getByTestId("claim-confirm").fill(PW);
  await p.getByTestId("claim-next").click();
  await p.getByTestId("claim-saved").click();
  await p.getByTestId("claim-create").click();
  await dismissOnboarding(p).catch(async (e) => { await p.screenshot({ path: path.join(out, "claim-failed.png") }); await p.getByText("Details").click().catch(() => {}); console.log("CLAIM ERRORS", cerrs.join(" || ").slice(0, 2500), "BODY", (await p.locator("body").innerText()).slice(0, 1500)); throw e; });
  const raw = await p.evaluate(() => localStorage.getItem("vyre.session.v1"));
  await c.close();
  const owner = Object.values(JSON.parse(raw).sessions)[0];

  // Dana joins with real key bundles
  const roles = (await call(space.url, space.token, "access.roles.list")).roles;
  const inv = await call(space.url, space.token, "members.invites.create", { role: roles.find((r) => r.name === "Member").id });
  const code = decodeURIComponent(new URL(inv.link).pathname.split("/").pop());
  const made = await makeBundle(PW, "recovery-code-for-the-shot", { spaceId: space.space });
  const keys = { personKeyByPassword: made.personKeyByPassword, personKeyByRecovery: made.personKeyByRecovery, publicKey: made.publicKey, privateKeyWrapped: made.privateKeyWrapped, spaceKeys: made.spaceKeys };
  const acc = await fetch(`${space.url}/v1/members/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, username: "dana", displayName: "Dana Whitfield", password: PW, deviceName: "Dana's PC", deviceClass: "desktop", keys }) });
  if (acc.status !== 200) throw new Error(`accept: ${await acc.text()}`);
  const dana = (await acc.json()).data;

  await call(space.url, owner.token, "notifications.rules.set", { workingHours: null }).catch((e) => console.log("rules", String(e).slice(0, 120)));
  const ch = (await call(space.url, owner.token, "channels.create", { name: "intake", visibility: "public", memberIds: [owner.personId, dana.personId], agentIds: [] })).channel;
  const said = (await call(space.url, owner.token, "chat.post", { threadId: ch.mainThreadId, body: "Who takes the Rivera intake?" })).message.messageId;
  const thread = (await call(space.url, dana.token, "chat.thread", { threadId: ch.mainThreadId, messageId: said })).thread.threadId;
  await call(space.url, dana.token, "chat.post", { threadId: thread, body: "I can take it. Calling at 3." });
  // an approval: a task Dana does and the owner approves
  const task = (await call(space.url, owner.token, "tasks.create", { title: "Send the Rivera engagement letter", assigned: { kind: "person", id: dana.personId }, approver: { kind: "person", id: owner.personId } })).task;
  await call(space.url, dana.token, "tasks.submit", { taskId: task.id, summary: "Drafted it" });
  let list = [];
  for (let i = 0; i < 30; i++) { list = (await call(space.url, owner.token, "notifications.list", { unseenOnly: true })).notifications; if (list.some((x) => x.kind.startsWith("reply")) && list.some((x) => x.kind.startsWith("approval") || x.kind === "task.turn")) break; await new Promise((r) => setTimeout(r, 500)); }
  console.log("owner notifications:", list.map((x) => `${x.kind}|${x.level}|${x.title}`).join(" ; "));

  for (const skin of ["paper", "graphite"]) for (const [size, vp] of Object.entries(SIZES)) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
    const seed = await ctx.newPage();
    await seed.goto(`${web.origin}/home?skin=${skin}`, { waitUntil: "load", timeout: 60000 });
    await seed.evaluate((v) => localStorage.setItem("vyre.session.v1", v), raw);
    await seed.close();
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errs.push(`console: ${m.text()}`); });
    page.on("response", async (r) => { if (r.status() >= 400 && new URL(r.url()).pathname.startsWith("/v1/")) console.log(`HTTP ${r.status()} ${new URL(r.url()).pathname} body=${(await r.text().catch(() => "")).slice(0, 220)} req=${(r.request().postData() ?? "").slice(0, 120)}`); });
    await page.goto(`${web.origin}/chat?skin=${skin}`, { waitUntil: "load", timeout: 60000 });
    await dismissOnboarding(page).catch(async (e) => { await page.screenshot({ path: path.join(out, `failed-${skin}-${size}.png`) }); await page.getByText("Details").click().catch(() => {}); console.log("PAGE ERRORS", errs.join(" || ").slice(0, 1500), "BODY", (await page.locator("body").innerText()).slice(0, 1200)); throw e; });
    const slot = await page.getByTestId(size === "phone" ? "notice-bell" : "notice-slot").first().waitFor({ timeout: 20000 }).then(() => true, () => false);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(out, `gate-slot-${skin}-${size}.png`) });
    const open = page.getByTestId(size === "phone" ? "notice-bell" : "notice-more").first();
    await open.click({ timeout: 5000 }).catch(() => console.log("no popover opener at", skin, size));
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(out, `gate-popover-${skin}-${size}.png`) });
    console.log(`shot ${skin} ${size} slot=${slot}${errs.length ? " errors=" + errs.join(" | ").slice(0, 300) : ""}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close();
  await space.stop();
  fs.rmSync(space.dir, { recursive: true, force: true });
}
process.exit(0);
