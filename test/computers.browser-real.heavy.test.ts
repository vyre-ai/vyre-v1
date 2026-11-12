// The real Space browser (f-wire, 12 Nov): an agent with no old desktop, in an engine turn, opens a page served from this computer in its own profile of the real Space browser image (Chromium in a
// container), reads it with chrome_snapshot, and the chat gets the live card with the page's picture. Needs Docker and the image (VYRE_HEAVY_DOCKER=1, VYRE_SPACE_BROWSER_IMAGE built from
// images/space-browser). With the web export (VYRE_APP_DIST) it also takes the picture of the card in the app.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { makeBundle } from "../client/src/crypto/keys.ts";
import { holdKeyOnOwnNode } from "../client/src/gateway/local-key.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { boot, hostLog, scriptedModel, stop, waitFor, KEY } from "./support/eco-live.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1" && !!process.env["VYRE_SPACE_BROWSER_IMAGE"];
const PASSWORD = "real browser password 7731";

test("an agent's turn opens a page in its own profile of the real Space browser, reads it, and the chat shows the card with the page's picture", { skip: ON ? false : "needs VYRE_HEAVY_DOCKER=1 and VYRE_SPACE_BROWSER_IMAGE", timeout: 600_000 }, async () => {
  // the page the agent opens: served from this computer, reached from the container through the Docker bridge
  const page = http.createServer((_q, r) => { r.writeHead(200, { "content-type": "text/html" }); r.end("<!doctype html><title>Harbor Quotes</title><body style=\"background:#2b5fd9;color:#fff;font:32px sans-serif\"><h1>Harbor Quotes pricing</h1><p>Two weeks, $4,180.</p></body>"); });
  await new Promise<void>((r) => page.listen(0, "0.0.0.0", r));
  const port = (page.address() as { port: number }).port;
  const url = `http://${process.env["VYRE_BRIDGE_HOST"] ?? "172.17.0.1"}:${port}/pricing`;
  let agent = "";
  const said: string[] = [];
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id === agent && /pricing/.test(input.trigger?.body ?? "")) {
      yield* run("tool_search", { query: "chrome open" });
      said.push(JSON.stringify(yield* run("chrome_open", { url })).slice(0, 1500));
      yield* run("tool_search", { query: "chrome snapshot" });
      said.push(JSON.stringify(yield* run("chrome_snapshot", {})).slice(0, 3000));
      yield { type: "text", text: "The pricing page is open." };
    }
  });
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-browser-real-")));
  const d = await boot(dir, model, { config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_fresh", "--space-name", "Real Co"], {}, "1.2.3") });
  try {
    const code = /claim\/([^#]+)/.exec(d.claim!.url)![1]!;
    const spaceId = /s=([^&]+)/.exec(d.claim!.url)![1]!;
    const made = await makeBundle(PASSWORD, "browser-real-recovery-code-1", { spaceId });
    const claimed = await fetch(`${d.url}/v1/identity/claim_owner`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, spaceId, displayName: "Maya Chen", username: "maya", password: PASSWORD, deviceName: "real", deviceClass: "desktop", keys: { personKeyByPassword: made.personKeyByPassword, personKeyByRecovery: made.personKeyByRecovery, publicKey: made.publicKey, privateKeyWrapped: made.privateKeyWrapped, spaceKeys: made.spaceKeys ?? [] } }) });
    assert.equal(claimed.status, 200, await claimed.clone().text());
    const token = ((await claimed.json()) as { data: { session: { token: string } } }).data.session.token;
    assert.equal(await holdKeyOnOwnNode(d.url, token, made.personKey), true);
    const api = async (cap: string, input: unknown): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
      const body = (await r.json()) as { data?: unknown };
      assert.equal(r.status, 200, `${cap}: ${r.status} ${JSON.stringify(body)}`);
      return body.data;
    };
    const folder = (await api("vault.folders.create", { idempotencyKey: "r-folder", name: "Accounts", scope: "mine" })).folder.id as string;
    const flow = await api("providers.subscription_start", { idempotencyKey: "r-flow", providerKey: "claude-code" });
    await api("vault.item.put", { idempotencyKey: "r-item", folderId: folder, name: "Maya_Claude", kind: "ai_subscription", fields: [{ key: "setup_token", value: KEY, secret: true }] });
    const provider = (await api("providers.subscription_complete", { flowId: flow.flowId })).provider.id as string;
    await api("providers.set_space_use", { idempotencyKey: "r-spaceuse", providerId: provider, allow: true });
    agent = (await api("agents.create", { name: "Scout", role: "You browse the web for the team.", idempotencyKey: "r-agent" })).agent.agentId as string;
    const threadId = (await api("chat.start", { kind: "chat", agentIds: [agent], title: "Pricing check", idempotencyKey: "r-chat" })).thread.threadId as string;
    await api("chat.post", { threadId, body: "Open the pricing page", mentions: [{ kind: "agent", id: agent }], idempotencyKey: "r-ask" });
    await waitFor(async () => { await d.hooks?.pump?.(); return said.length >= 2 ? true : null; }, 300_000, () => `${said.join("\n")}\n${hostLog(d)}`);
    assert.doesNotMatch(said[0]!, /"ok":false/, `chrome_open: ${said[0]}`);
    assert.match(said[1]!, /Harbor Quotes pricing/, `chrome_snapshot reads the page: ${said[1]}`);
    // the step keeps a real picture of the page, and the chat's card points at it
    const steps = (await api("computers.browser.timeline", { agentId: agent })).steps as Array<{ caption: string; frameFileId?: string }>;
    const shot = steps.find((s) => s.frameFileId);
    assert.ok(shot, `a step has its picture: ${JSON.stringify(steps)}`);
    const png = await api("files.read", { fileId: shot!.frameFileId, as: "base64" });
    const bytes = Buffer.from(String(png.base64), "base64");
    assert.ok(bytes.length > 2_000 && bytes.subarray(1, 4).toString() === "PNG", `the picture is a real PNG of the page (${bytes.length} bytes)`);
    const out = process.env["VYRE_TEST_CAPTURE_DIR"];
    if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, "browser-real-step.png"), bytes); }
    const card = await waitFor(async () => (((await api("chat.messages.list", { threadId })).messages as Array<{ blocks?: Array<{ type: string; data?: { fileId?: string; agentId?: string } }> }>).flatMap((m) => m.blocks ?? []).find((b) => b.type === "browser_screenshot") ?? null), 30_000, () => hostLog(d));
    assert.equal(card.data?.agentId, agent);
    assert.ok(card.data?.fileId, "the card carries the page's picture");
  } finally { await stop(d); page.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
