// @tsx
// Owner ruling (3 Nov), in the real app: Ada (owner) connects Claude Code as "Simba (Claude Code)" and it posts in a public channel. Noah, a member, signed in through the sign-in screen on
// the production export, opens the channel and sees the post credited to "Ada Archer (Agent)"; the agent's own name is nowhere on his screen. Ada sees "Simba (Claude Code)".
// Pictures go to VYRE_TEST_CAPTURE_DIR (default shots-evidence/agent-credit). Needs VYRE_APP_DIST (the production web export) and a Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeBundle, wipe } from "../client/src/crypto/keys.ts";
import { bootFreshSpace, dismissOnboarding, edge } from "../apps/app/tests/real-app-harness.test.ts";
import { Client, signIn } from "./support/outside-client.ts";

const PASSWORD = "correct horse battery staple 9";
const OUT = process.env["VYRE_TEST_CAPTURE_DIR"] ?? "shots-evidence/agent-credit";
type Json = any;   // eslint-disable-line @typescript-eslint/no-explicit-any

test("Noah's channel view credits Simba's post to Ada Archer (Agent), never Simba; Ada sees Simba", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { t.skip("VYRE_APP_DIST is not set: the shots job runs this after the production export"); return; }
  const pw = await import("playwright-core");
  const chromium = pw.chromium ?? (pw as unknown as { default: typeof pw }).default.chromium;
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  if (!fs.existsSync(exe)) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail(`no Chromium at ${exe}`); t.skip("no Chromium on this machine"); return; }

  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  try {
    const post = async (cap: string, input: unknown, token?: string | null): Promise<{ status: number; body: Json }> => {
      const r = await fetch(`${space.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) });
      return { status: r.status, body: await r.json() };
    };
    const keysFor = async (password: string): Promise<Record<string, unknown>> => {
      const made = await makeBundle(password, "recovery-code-for-the-test", { spaceId: space.space });
      const { personKey, ...rest } = made;
      wipe(personKey);
      return { personKeyByPassword: rest.personKeyByPassword, personKeyByRecovery: rest.personKeyByRecovery, publicKey: rest.publicKey, privateKeyWrapped: rest.privateKeyWrapped, spaceKeys: rest.spaceKeys };
    };
    const code = decodeURIComponent(new URL(space.claim!).pathname.split("/").pop() ?? "");
    const claimed = await post("identity.claim_owner", { code, spaceId: space.space, username: "ada", displayName: "Ada Archer", password: PASSWORD, deviceName: "Setup", deviceClass: "desktop", keys: await keysFor(PASSWORD) });
    assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
    const ada = claimed.body.data.session.token as string;
    let n = 0;
    const api = async (token: string, cap: string, input: Record<string, unknown> = {}): Promise<Json> => {
      const r = await post(cap, { idempotencyKey: `ac-${++n}`, ...input }, token);
      assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.body)}`);
      return r.body.data;
    };
    const member = ((await api(ada, "access.roles.list")).roles as Json[]).find((r) => r.name === "Member")!.id;
    const invite = await api(ada, "members.invites.create", { role: member });
    const joined = await post("members.accept", { code: decodeURIComponent(new URL(invite.link).pathname.split("/").pop() ?? ""), username: "noah", displayName: "Noah Park", password: PASSWORD, deviceName: "Setup", deviceClass: "desktop", keys: await keysFor(PASSWORD) });
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
    const noahId = joined.body.data.personId as string;

    // Ada connects Claude Code through /mcp: it becomes Simba (Claude Code), hers alone
    const flow = { d: { url: space.url }, call: (cap: string, token: string | null, body?: unknown) => post(cap, body ?? {}, token) } as unknown as Parameters<typeof signIn>[0];
    const c = new Client(`${space.url}/mcp`, {}, "Simba (Claude Code)");
    const { agentId: simba } = await signIn(flow, c, ada);
    await c.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.1" } });
    const channel = (await api(ada, "channels.create", { name: "launch", visibility: "public", memberIds: [noahId], agentIds: [simba] })).channel;
    const said = await c.tool("chat_post", { threadId: channel.mainThreadId, body: "The pricing page draft is up.", idempotencyKey: "simba-post" });
    assert.equal(said.json.result?.isError ?? false, false, JSON.stringify(said.json).slice(0, 400));

    const open = async (username: string): Promise<Json> => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });
      const page = await ctx.newPage();
      await page.goto(`${web.origin}/chat`, { waitUntil: "load" });
      await page.getByTestId("si-user").waitFor({ timeout: 20_000 });
      await page.getByTestId("si-user").fill(username);
      await page.getByTestId("si-password").fill(PASSWORD);
      await page.getByTestId("next").click();
      await dismissOnboarding(page);
      return page;
    };
    const toChannel = async (page: Json): Promise<void> => {
      await page.getByText("launch", { exact: true }).first().click({ timeout: 20_000 });
      await page.getByText("The pricing page draft is up.").first().waitFor({ timeout: 20_000 });
    };

    const N = await open("noah");
    await toChannel(N);
    await N.getByText("Ada Archer (Agent)").first().waitFor({ timeout: 20_000 });
    await N.screenshot({ path: path.join(OUT, "noah-channel.png") });
    assert.equal(await N.getByText(/Simba/).count(), 0, "the agent's own name is nowhere on Noah's screen");

    const A = await open("ada");
    await toChannel(A);
    await A.getByText("Simba (Claude Code)").first().waitFor({ timeout: 20_000 });
    await A.screenshot({ path: path.join(OUT, "ada-channel.png") });
  } finally {
    await browser.close();
    web.close();
    await space.stop();
    fs.rmSync(space.dir, { recursive: true, force: true });
  }
});
