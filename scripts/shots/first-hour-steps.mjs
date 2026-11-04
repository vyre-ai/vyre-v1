// The steps of the first-hour walk (scripts/shots/first-hour.mjs). Each step: { id, owner (the lane that fixes it), critical?, run(S) } and throws when what a person would see is not there.
import assert from "node:assert/strict";
import net from "node:net";

const KEY = "sk-test-fixture-0123456789abcdef"; // secret-scan: fake
export const KEY_FIXTURE = KEY;
export const field = (S) => S.page.getByTestId("composer-field").first();

export async function claim(S, name, username) {
  const { page } = S;
  await page.goto(S.claimOnEdge(S.space.claim, S.web.origin), { waitUntil: "load", timeout: 60000 });
  await page.getByTestId("claim-name").fill(name); await page.getByTestId("claim-username").fill(username);
  await page.getByTestId("claim-password").fill(S.PW); await page.getByTestId("claim-confirm").fill(S.PW);
  await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click();
  await S.dismissOnboarding(page);
  await page.getByTestId("shell").waitFor({ timeout: 30000 });
}

export const connectModel = async (S, team) => {
  const p = await S.api("providers.add", { providerKey: "openai", connection: "api_key", apiKey: KEY, scope: "mine" });
  if (team) await S.api("providers.set_space_use", { providerId: p.provider.id, allow: true });
  const assistant = (await S.api("agents.list", {})).agents[0];
  await S.api("agents.update", { agentId: assistant.agentId, patch: { model: "gpt-4o-mini" } });
  S.state.assistant = assistant;
};

export const personalSteps = [
  { id: "claim-and-sign-in", owner: "l-entry", critical: true, run: (S) => claim(S, "Pia Personal", "pia") },
  { id: "first-chat-reply", owner: "l-chat", run: async (S) => {
    await connectModel(S, false);
    S.vendor.script.push({ text: "Hello Pia. I am your assistant." });
    if (process.env.FH_SLOW) { const cdp = await S.context.newCDPSession(S.page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.FH_SLOW) }); }
    await S.page.goto(`${S.web.origin}/chat`, { waitUntil: "load" });
    await field(S).waitFor({ timeout: 30000 });
    await field(S).fill("Hello, who are you?"); await field(S).press("Enter");
    await S.page.getByText("I am your assistant", { exact: false }).first().waitFor({ timeout: 30000 });
  } },
  { id: "add-a-vault-key", owner: "l-vault", run: async (S) => {
    await S.page.goto(`${S.web.origin}/vault`, { waitUntil: "load" });
    await S.page.getByTestId("vault-place").waitFor({ timeout: 30000 });
    await S.page.waitForTimeout(800);
    await S.page.keyboard.press("Control+n");   // the Vault's own Add shortcut; its Add button is the "+" in the list header
    await S.page.getByTestId("add-search").fill("MY_SERVICE_KEY=abc123secretvalue");
    await S.page.getByTestId("add-name").waitFor();
    await S.page.waitForFunction(() => document.querySelector('[data-testid="add-save"]')?.getAttribute("aria-disabled") !== "true", null, { timeout: 15000 });
    await S.page.getByTestId("add-save").click();
    await S.page.getByText("My service key", { exact: true }).first().waitFor({ timeout: 15000 });
  } },
  { id: "lock-and-unlock-with-cmd-l", owner: "l-backup", run: async (S) => {
    await S.page.goto(`${S.web.origin}/chat`, { waitUntil: "load" });
    await S.page.getByTestId("shell").waitFor({ timeout: 30000 });
    await S.page.waitForTimeout(1500);
    await S.page.keyboard.press("Control+l");
    await S.page.getByText("Sign-ins locked", { exact: false }).first().waitFor({ timeout: 10000 });
    await S.shot("locked");
    await S.page.keyboard.press("Control+l");
    const pw = S.page.locator("input[type=password]").first();
    await pw.waitFor({ timeout: 10000 });
    await S.shot("unlock-sheet");
    await pw.fill(S.PW); await pw.press("Enter");
    await S.page.getByText("Sign-ins locked", { exact: false }).first().waitFor({ state: "detached", timeout: 15000 });
  } },
];

const settle = (S) => S.page.waitForTimeout(700);
personalSteps.push(
  { id: "make-an-agent-and-a-face", owner: "l-chat", run: async (S) => {
    await S.page.goto(`${S.web.origin}/chat#screen=chats.agent-form`, { waitUntil: "load" });
    await S.page.getByTestId("agent-form").waitFor({ timeout: 30000 });
    await S.page.getByTestId("agent-name").fill("Scout");
    await S.page.getByTestId("agent-does").fill("Reads incoming mail and tells me what matters").catch(() => {});
    await S.shot("agent-form-filled");
    const shuffle = S.page.getByTestId("agent-shuffle");
    assert.ok(await shuffle.count() > 0, "the agent form has a face control (agent-shuffle)");
    await shuffle.click();
    await settle(S);
    await S.page.getByTestId("agent-save").click();
    // saving opens the new agent's own chat with its page beside it, and its row joins the sidebar
    await S.page.getByTestId("chats-sidebar").getByText("Scout", { exact: true }).first().waitFor({ timeout: 20000 });
  } }
);

personalSteps.push(
  // UI: the Notes page composer. The note must then show in the list.
  { id: "make-a-note", owner: "l-notes", run: async (S) => {
    await S.page.goto(`${S.web.origin}/chat#screen=chats.notes`, { waitUntil: "load" });
    await S.page.getByTestId("notes-page").waitFor({ timeout: 30000 });
    await S.page.getByTestId("take-closed").click({ timeout: 15000 });
    const body = S.page.getByTestId("take-body").first();
    await body.waitFor({ timeout: 10000 });
    await body.click(); await S.page.waitForTimeout(600);   // typing in the first moments after the editor opens loses its first letters (reported)
    await S.page.keyboard.type("Call the county clerk about the Rivera filing");
    await S.shot("note-open");
    await S.page.getByRole("button", { name: "Close", exact: true }).first().click({ timeout: 5000 });   // Close files the note
    await S.page.getByText("Call the county clerk about the Rivera filing", { exact: true }).first().waitFor({ timeout: 15000 });
  } },
  // API then UI: the task is made with tasks.create (the Tasks quick-add has no stable test id); the Tasks page must list it.
  { id: "make-a-task", owner: "l-tasks", run: async (S) => {
    await S.api("tasks.create", { title: "Send the Rivera engagement letter", assigned: { kind: "person", id: JSON.parse(await S.page.evaluate(() => localStorage.getItem("vyre.session.v1"))).sessions[S.web.origin].personId } });
    await S.page.goto(`${S.web.origin}/chat#screen=tasks.my-work`, { waitUntil: "load" });
    await S.page.getByText("Send the Rivera engagement letter", { exact: false }).first().waitFor({ timeout: 20000 });
  } },
  // API then UI: a goal with a finish line for the assistant (goals.create), then its own page.
  { id: "make-a-goal", owner: "l-goals", run: async (S) => {
    const assistant = (await S.api("agents.list", {})).agents.find((a) => a.name === "Assistant") ?? (await S.api("agents.list", {})).agents[0];
    const made = await S.api("goals.create", { title: "Answer every new inquiry within a day", finish: { kind: "owner", line: "Every new inquiry has an answer within a day" }, deadline: Date.now() + 7 * 86400000, leadAgentId: assistant.agentId });
    const goalId = made.goal.goalId ?? made.goal.id;
    await S.page.goto(`${S.web.origin}/chat#screen=goals.page&goalId=${goalId}`, { waitUntil: "load" });
    await S.page.getByTestId("goal-page").waitFor({ timeout: 30000 });
    await S.page.getByText("Answer every new inquiry", { exact: false }).first().waitFor({ timeout: 10000 });
  } },
);

/** A tiny IMAP server that accepts any login: the fake provider the Inbox connects to (the daemon, vault and mail module are real). */
function fakeImap() {
  const logins = [];
  let conns = 0;
  const server = net.createServer((sock) => {
    conns++; logins.conns = conns;
    sock.write("* OK IMAP4rev1 fake ready\r\n");
    let buf = "";
    sock.on("data", (b) => {
      buf += b.toString();
      for (let i = buf.indexOf("\r\n"); i >= 0; i = buf.indexOf("\r\n")) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        const [tag, cmd = "", ...rest] = line.split(" ");
        const c = cmd.toUpperCase();
        if (c === "CAPABILITY") sock.write(`* CAPABILITY IMAP4rev1 ID\r\n${tag} OK done\r\n`);
        else if (c === "ID") sock.write(`* ID NIL\r\n${tag} OK done\r\n`);
        else if (c === "LOGIN") { logins.push((rest[0] ?? "").replace(/^"|"$/g, "")); sock.write(`${tag} OK [CAPABILITY IMAP4rev1] logged in\r\n`); }
        else if (c === "LOGOUT") { sock.write(`* BYE\r\n${tag} OK bye\r\n`); sock.end(); }
        else sock.write(`${tag} OK done\r\n`);
      }
    });
    sock.on("error", () => undefined);
  });
  return new Promise((resolve) => server.listen(0, "0.0.0.0", () => resolve({ port: server.address().port, logins, close: () => server.close() })));
}

personalSteps.push(
  // UI: Inbox shows the Connect a channel tiles while nothing is connected; Other email (IMAP) against a fake IMAP server; the sheet ends signed in and the Inbox is no longer the empty state.
  { id: "connect-inbox", owner: "l-inbox", run: async (S) => {
    const imap = await fakeImap();
    try {
      await S.page.goto(`${S.web.origin}/mail`, { waitUntil: "load" });
      await S.page.getByTestId("connect-imap").click({ timeout: 30000 });
      await S.page.getByTestId("connect-mailbox").waitFor({ timeout: 10000 });
      await S.page.getByLabel("Email address", { exact: true }).fill("pia@example.test");
      await S.page.getByLabel("Server", { exact: true }).fill(process.env.FH_IMAP_HOST ?? "127.0.0.1");
      await S.page.getByLabel("Port", { exact: true }).fill(String(imap.port));
      await S.page.getByLabel(/^(App password|Password)$/).fill("app-password-fixture");
      if ((await S.page.getByTestId("connect-secure").innerText()).includes(": on")) await S.page.getByTestId("connect-secure").click();
      await S.shot("connect-sheet");
      await S.page.getByRole("button", { name: /^(Connect|Add|Continue|Connecting)/ }).last().click({ timeout: 10000 });
      await S.page.getByTestId("connect-mailbox").waitFor({ state: "detached", timeout: 20000 }).catch(async (e) => { const { DatabaseSync } = await import("node:sqlite"); let why = ""; try { why = JSON.stringify(new DatabaseSync(`${S.space.dir}/logs.db`, { readOnly: true }).prepare("SELECT level, cap, msg, attrs FROM logs WHERE cap LIKE '%mail%' OR msg LIKE '%mail%' OR msg LIKE '%vault%' ORDER BY id DESC LIMIT 4").all()).slice(0, 900); } catch (x) { why = `(no log: ${x.message})`; }
        throw new Error(`log ${why} | the connect sheet stayed open (fake IMAP saw ${imap.logins.conns ?? 0} connections, logins ${JSON.stringify(imap.logins)}): ${e.message.split("\n")[0]}`); });
      assert.ok(imap.logins.some((u) => u.includes("pia@example.test")), `the daemon logged in to the fake IMAP server (connections: ${imap.logins.conns ?? 0})`);
    } finally { imap.close(); }
  } },
);
