// The steps that need a model which calls tools, run through the real capabilities: a daemon in this process (test/support/eco-live.ts) whose model vendor is the scripted session of
// test/support/live.ts (it runs the real tool session: tool_search, then the tool). The owner is claimed through the API like a person's claim, the browser then opens the real app on that session.
//   crew in a plain chat: the lead calls crew_start; a teammate writes its files in its own work folder; one result card arrives; Merge lands it.
//   held email draft: the lead calls mail_send; the Gate holds it; Needs you shows the draft; Send approves and the mail goes out.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export async function provisionScripted(dist) {
  void dist;
  const REPO = process.cwd();
  const imp = (p) => import(path.join(REPO, p));
  const { boot, scriptedModel, waitFor, KEY, hostLog } = await imp("test/support/eco-live.ts");
  const { loadConfig } = await imp("host/src/daemon/config.ts");
  const { makeBundle } = await imp("client/src/crypto/keys.ts");
  const { holdKeyOnOwnNode } = await imp("client/src/gateway/local-key.ts");
  const { workFolder } = await imp("modules/engine/sandbox.ts");
  const state = { lead: "", owner: "", dir: "", box: "", rec: "" };
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id !== state.lead) {
      // a teammate of the crew: writes its work into its own folder, then says so
      const work = workFolder(state.dir, state.owner, input.threadId, input.agent.id);
      await waitFor(async () => (fs.existsSync(path.join(work, ".git")) ? true : null), 20_000);
      fs.writeFileSync(path.join(work, "dark-mode.txt"), "toggle: on\n");
      fs.writeFileSync(path.join(work, "dark-mode.test.txt"), "test: toggle is on\n");
      yield { type: "text", text: "Added the dark mode toggle and a test. The test passes." };
      return;
    }
    const ask = String(input.trigger?.body ?? "");
    if (/build dark mode/.test(ask)) {
      yield* run("tool_search", { query: "crew teammate" });
      yield* run("crew_start", { threadId: input.threadId, idempotencyKey: "fh-crew-start", title: "Dark mode", brief: "Add a dark mode toggle and a test." });
      yield { type: "text", text: "I started Ember on the dark mode toggle. You will get one card when it is done." };
    } else if (/send the letter/.test(ask)) {
      yield* run("tool_search", { query: "send an email" });
      yield* run("mail_send", { mailboxId: state.box, to: [{ address: "dana@fox.test", name: "Dana Fox", contactId: state.rec }], subject: "Your engagement letter", text: "Dear Dana, the letter is attached. Please sign by Friday.", contactId: state.rec, idempotencyKey: "fh-send" });
      yield { type: "text", text: "I drafted the letter. It waits for your approval." };
    } else if (input.trigger?.author?.kind === "agent") {
      yield { type: "text", text: "Ember is done. The branch is ready for you to merge." };
    } else {
      yield { type: "text", text: "Hello. I am your assistant." };
    }
  });
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-fh-scripted-")));
  const PASSWORD = "first hour scripted 7731";
  console.log("scripted: const d = await boot(");
  const d = await boot(dir, model, { config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_fh", "--space-name", "First Hour Co"], {}, "1.2.3") });
  state.dir = d.paths.root;
  const code = /claim\/([^#]+)/.exec(d.claim.url)[1];
  const spaceId = /s=([^&]+)/.exec(d.claim.url)[1];
  const made = await makeBundle(PASSWORD, "first-hour-recovery-code-1", { spaceId });
  const { personKey, ...rest } = made;
  console.log("scripted: const claimed = await fetch");
  const claimed = await fetch(`${d.url}/v1/identity/claim_owner`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, spaceId, displayName: "Maya Chen", username: "maya", password: PASSWORD, deviceName: "walk", deviceClass: "desktop", keys: { personKeyByPassword: rest.personKeyByPassword, personKeyByRecovery: rest.personKeyByRecovery, publicKey: rest.publicKey, privateKeyWrapped: rest.privateKeyWrapped, spaceKeys: rest.spaceKeys } }) });
  assert.equal(claimed.status, 200, await claimed.clone().text());
  const token = (await claimed.json()).data.session.token;
  console.log("scripted: assert.equal(await holdKeyOnOw");
  assert.equal(await holdKeyOnOwnNode(d.url, token, personKey), true);
  let n = 0;
  const api = async (cap, input = {}) => {
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ idempotencyKey: `fhs-${++n}`, ...input }) });
    const b = await r.json();
    assert.equal(r.status, 200, `${cap}: ${r.status} ${JSON.stringify(b).slice(0, 240)}`);
    return b.data;
  };
  console.log("scripted: const folder =");
  const folder = (await api("vault.folders.create", { name: "Accounts", scope: "mine" })).folder.id;
  const flow = await api("providers.subscription_start", { providerKey: "claude-code" });
  await api("vault.item.put", { folderId: folder, name: "Maya_Claude", kind: "ai_subscription", fields: [{ key: "setup_token", value: KEY, secret: true }] });
  console.log("scripted: const provider =");
  const provider = (await api("providers.subscription_complete", { flowId: flow.flowId })).provider.id;
  await api("providers.set_space_use", { providerId: provider, allow: true });
  await api("engine.pool.status", {});
  console.log("scripted: const me =");
  const me = (await api("identity.whoami", {})).principal.id;
  state.owner = me;
  console.log("scripted: state.lead = await");
  state.lead = await waitFor(async () => { await d.hooks?.pump?.(); const r = await api("agents.assistant_of", { personId: me }); return typeof r.agentId === "string" ? r.agentId : null; }, 40_000);
  for (const flowName of ["team", "personal", "member"]) await api("spaces.onboarding.seen", { flow: flowName }).catch(() => undefined);
  console.log("scripted: state.rec =");
  state.rec = (await api("records.create", { type: "contact", fields: { name: "Dana Fox", email: "dana@fox.test" } })).record.id;
  state.box = (await api("mail.mailbox.create", { kind: "shared", address: "hello@firsthour.test", title: "Hello", privacy: "space" })).mailbox.id;
  console.log("scripted: const marker =");
  const marker = (await api("spaces.get", {})).space.fingerprint;
  const session = { baseUrl: "", token, personId: me, marker, def: { spaceId, name: "First Hour Co", kind: "team", address: "", role: "Owner", tint: ["#6E5CF0", "#9B6BE8"], kit: "northwind", skinDefault: "system", starred: true, needsYou: false, console: true, terminal: false, counts: {}, dots: {} } };
  const space = { url: d.url, token, space: spaceId, dir, claim: null, stop: async () => { await d.stop(); } };
  return { space, session, daemon: d, state: { ...state, api, waitFor, hostLog, state } };
}

export const scriptedSteps = [
  { id: "open-the-real-app", owner: "l-entry", critical: true, run: async (S) => {
    await S.page.goto(`${S.web.origin}/chat`, { waitUntil: "load" });
    await S.page.getByTestId("shell").waitFor({ timeout: 40000 });
  } },
  // the crew: asked in a plain chat, one card, Merge. Chat opened by link; the card by its test id.
  { id: "start-a-crew-in-a-plain-chat", owner: "l-crews", run: async (S) => {
    const { api, waitFor, hostLog, state } = S.state;
    const chat = (await api("chat.start", { kind: "chat", agentIds: [state.lead], title: "Build the site" })).thread.threadId;
    await api("chat.post", { threadId: chat, body: "build dark mode", mentions: [{ kind: "agent", id: state.lead }] });
    await waitFor(async () => { const jobs = (await api("engine.crew.list", { threadId: chat })).jobs; return jobs[0] && jobs[0].state !== "working" ? true : null; }, 60000, () => hostLog(S.daemon));
    const jobId = (await api("engine.crew.list", { threadId: chat })).jobs[0].jobId;
    await S.page.goto(`${S.web.origin}/chat#subject=thread:${chat}`, { waitUntil: "load" });
    const card = S.page.getByTestId(`crew-card-${jobId}`);
    await card.waitFor({ timeout: 40000 });
    assert.match(await card.innerText(), /Ember finished Dark mode/);
    await S.shot("crew-card");
    await card.getByText("Merge", { exact: true }).first().click({ timeout: 10000 });
    await S.page.getByText(/Merged/).first().waitFor({ timeout: 20000 });
  } },
  // the held email: the agent's send is held by the Gate, the draft shows in Needs you, Send approves and the mail goes out.
  { id: "hold-and-approve-an-email-draft", owner: "l-gate", run: async (S) => {
    const { api, waitFor, hostLog, state } = S.state;
    const chat = (await api("chat.start", { kind: "chat", agentIds: [state.lead], title: "Engagement letter" })).thread.threadId;
    await api("threads.set_mode", { threadId: chat, mode: "auto" });
    await api("chat.post", { threadId: chat, body: "send the letter", mentions: [{ kind: "agent", id: state.lead }] });
    const hold = await waitFor(async () => { await S.daemon.hooks?.pump?.(); return (await api("gate.holds.list", { states: ["held"] })).holds?.find((h) => h.capName === "mail.send") ?? null; }, 40000, () => hostLog(S.daemon));
    await S.page.goto(`${S.web.origin}/chat#screen=tasks.needs-you`, { waitUntil: "load" });
    await S.page.getByText("Your engagement letter", { exact: false }).first().waitFor({ timeout: 30000 });
    await S.shot("held-draft");
    await S.page.getByRole("button", { name: "Send", exact: true }).first().click({ timeout: 10000 });
    await waitFor(async () => { const m = (await api("mail.message.list", { mailboxId: state.box })).messages; return m.some((x) => x.direction === "out") ? true : null; }, 30000, () => hostLog(S.daemon));
    void hold;
  } },
];
