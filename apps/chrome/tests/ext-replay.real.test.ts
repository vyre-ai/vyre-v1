// A saved skill replayed with the real chrome_* tools (src/agent) on a real Chromium page: the stand-in for the model reads SKILL.md's replay.json top to bottom and makes the call each step
// names, finding elements in a fresh chrome_snapshot by role and name. The skill is the one a recording becomes (src/worker/skill.js). The Vault's login goes in through handles: the page gets the
// value, the "model" never does, and a step marked "ask first" waits for a yes. Skipped where no Chromium is installed.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { buildSkill, inputsOf } from "../src/worker/skill.js";
import { findChrome, rig, LOGIN, SECRET } from "./e2e/agent-rig.ts";
import { NEW, PORTAL } from "./e2e/show-watch.ts";

const found = await findChrome();

function serve() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    res.writeHead(200, { "content-type": "text/html" });
    res.end(u.pathname === "/new" ? NEW : PORTAL);
  });
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) })));
}

const refOf = (tree: string, role: string, name: string) => {
  const line = tree.split("\n").find((l) => l.includes(`${role} "${name}"`));
  assert.ok(line, `${role} "${name}" is in the snapshot:\n${tree}`);
  return /\[ref=(e\d+)\]/.exec(line!)![1]!;
};

test("an agent replays a saved skill with the real chrome_* tools: sign-in through the Vault's handles, an input asked for, a step that asks first", { skip: !found && "no Chromium on this machine", timeout: 60_000 }, async () => {
  const srv = await serve();
  const browser = await found!.chromium.launch({ executablePath: found!.exe, args: ["--no-sandbox", "--disable-gpu"] });
  const r = await rig(browser, "light", { idleMs: 3000 });
  try {
    const at = (p: string) => `${srv.url}${p}`;
    const steps: any[] = [
      { id: "s1", kind: "open", url: at("/portal"), host: "127.0.0.1", at: 1 },
      { id: "s2", kind: "signin", url: at("/portal"), host: "127.0.0.1", at: 2 },
      { id: "s3", kind: "type", url: at("/new"), host: "127.0.0.1", target: { role: "textbox", name: "Name" }, value: "Daniel Okafor", at: 3 },
      { id: "s4", kind: "type", url: at("/new"), host: "127.0.0.1", target: { role: "textbox", name: "Email" }, value: "dokafor@okaforinjury.com", at: 4 },
      { id: "s5", kind: "click", url: at("/new"), host: "127.0.0.1", target: { role: "button", name: "Save" }, ask: true, at: 5 },
    ];
    const rec: any = { id: "rec_1", name: "Add a contact to Acme", startedAt: 0, steps, inputs: [] };
    rec.inputs = inputsOf(steps).map((i: any) => (i.key === "email" ? { ...i, mode: "fixed" } : i));
    const skill = buildSkill(rec);
    const replay = JSON.parse(skill.files["replay.json"]!);
    assert.equal(JSON.stringify(skill).includes(SECRET), false);

    const given: Record<string, string> = { name: "Priya Raman" };
    const asked: string[] = [];
    for (const step of replay.steps) {
      if (step.askFirst) asked.push(step.say); // the agent says what it is about to do and waits for the person's yes; the test person says yes
      // chrome_open refuses a computer's own address (agents browse the public web only), so the fixture page is opened by the rig; every other step is the real tool
      if (step.tool === "chrome_open") { await r.page.goto(step.args.url); continue; }
      const snap = await r.call("chrome_snapshot");
      if (step.tool === "vault_signin") {
        // vault_use gave the handle #Acme; the fields go in as handles and the filler puts the values in the page
        await r.call("chrome_type", { ref: refOf(snap.tree, "textbox", "Email"), text: "#Acme.username" });
        await r.call("chrome_type", { ref: refOf(snap.tree, "textbox", "Password"), text: "#Acme.password" });
        await r.call("chrome_click", { ref: refOf(snap.tree, "button", "Sign in") });
        continue;
      }
      const ref = refOf(snap.tree, step.find.role, step.find.name);
      if (step.tool === "chrome_type") assert.equal((await r.call("chrome_type", { ref, text: step.input ? given[step.input]! : step.text })).ok, true);
      else if (step.tool === "chrome_click") assert.equal((await r.call("chrome_click", { ref })).ok, true);
      else assert.fail(`unknown tool ${step.tool}`);
    }
    assert.deepEqual(asked, ['Click the button "Save"']);
    assert.equal(r.fillCalls(), 2, "the Vault filled the login name and the password");
    assert.match(await r.page.textContent("#done") ?? "", /^Saved Priya Raman <dokafor@okaforinjury\.com>$/);
    assert.equal((await r.page.inputValue("#m")), "dokafor@okaforinjury.com");
    void LOGIN;
  } finally { await r.close(); await browser.close(); await srv.close(); }
});
