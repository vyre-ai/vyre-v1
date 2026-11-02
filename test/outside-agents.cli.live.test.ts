// The claim in the connect sheet, proven with the real Claude Code CLI against a booted daemon: the one line adds the server, `claude mcp login` walks discovery, registration and PKCE by itself, the browser step is scripted (a person's
// Allow, then the tab following the redirect), and the CLI ends up connected. No Claude account is involved: this is the MCP server's own sign-in. Set VYRE_CLAUDE_BIN to the CLI; without it the test says so and skips.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootAgentGateSpace, LIVE_FOR_GATE_REPLY } from "../golden/steps/07-agent-gate.ts";
import { expectStatus } from "../golden/steps/02-space.ts";

const BIN = process.env["VYRE_CLAUDE_BIN"] ?? "";

/** Never spawnSync here: the daemon runs in this process, and a blocked loop answers nobody. */
function run(args: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(BIN, args, { env, cwd });
    let stdout = "", stderr = "";
    p.stdout.on("data", (b: Buffer) => { stdout += b.toString(); });
    p.stderr.on("data", (b: Buffer) => { stderr += b.toString(); });
    p.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("Claude Code connects with the one line from the sheet", { skip: BIN === "" ? "VYRE_CLAUDE_BIN is not set" : false, timeout: 120_000 }, async () => {
  const s = await bootAgentGateSpace([...LIVE_FOR_GATE_REPLY, "mcp", "audit", "spaces"]);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-cc-"));
  const opened = path.join(home, "opened.txt");
  const browser = path.join(home, "browser.sh");
  fs.writeFileSync(browser, `#!/bin/sh\nprintf '%s\\n' "$1" >> ${opened}\n`, { mode: 0o755 });
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, BROWSER: browser, CLAUDE_CONFIG_DIR: path.join(home, ".claude"), DISABLE_AUTOUPDATER: "1", TERM: "xterm" };
  for (const k of ["SSH_CLIENT", "SSH_CONNECTION", "SSH_TTY", "CI"]) delete env[k];   // the CLI takes those for a headless session and waits for a pasted URL instead of listening on its callback
  try {
    const owner = s.signedIn("usr_olivia");
    const link = expectStatus(await s.call("mcp.connected.link", owner, {}), 200, "mcp.connected.link");
    assert.match(link.url, /\/mcp$/);
    const words = String(link.claudeCode).split(" ");
    assert.deepEqual(words.slice(0, 5), ["claude", "mcp", "add", "--transport", "http"], "the sheet's line");
    const added = await run(words.slice(1).concat(["--scope", "user"]), env, home);
    assert.equal(added.status, 0, added.stderr);

    const before = await run(["mcp", "list"], env, home);
    console.log(`mcp list before: ${before.stdout.trim()}`);
    assert.match(before.stdout, /vyre/);
    assert.match(before.stdout, /[Nn]eeds auth|authenticat/, "the 401 reads as sign-in, not as a broken server");

    // it wants a terminal: `script` gives it one
    const login = spawn("script", ["-qefc", `${BIN} mcp login vyre`, "/dev/null"], { env, cwd: home, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    login.stdout.on("data", (b: Buffer) => { out += b.toString(); });
    login.stderr.on("data", (b: Buffer) => { out += b.toString(); });
    const ended = new Promise<number | null>((r) => login.on("close", r));
    let url = "";
    for (let i = 0; i < 300 && url === ""; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const seen = fs.existsSync(opened) ? fs.readFileSync(opened, "utf8") : "";
      url = /https?:\/\/\S+oauth\/authorize\S+/.exec(seen)?.[0] ?? /https?:\/\/\S+oauth\/authorize\S+/.exec(out)?.[0] ?? "";
    }
    assert.ok(url, `the CLI found the sign-in by itself: ${out.slice(0, 800)}`);
    const asked = new URL(url);
    console.log(`client asked: ${asked.searchParams.get("client_id")} redirect ${asked.searchParams.get("redirect_uri")} method ${asked.searchParams.get("code_challenge_method")} resource ${asked.searchParams.get("resource")}`);
    assert.equal(asked.searchParams.get("code_challenge_method"), "S256");
    assert.equal(asked.searchParams.get("resource"), link.url);

    // the tab
    const page = await fetch(url);
    assert.equal(page.status, 200, await page.clone().text());
    const html = await page.text();
    const data = JSON.parse(/var d=(\{.*?\}),\$=/.exec(html)![1]!) as { request: string; proof: string; name: string };
    console.log(`the tab says: ${data.name}`);
    // the person
    expectStatus(await s.call("mcp.oauth.allow", owner, { requestId: data.request }), 200, "mcp.oauth.allow");
    // the tab collects and follows the redirect to the CLI's own callback
    const w = (await (await fetch(`${s.d.url}/oauth/wait`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request: data.request, proof: data.proof }) })).json()) as { status: string; redirect: string };
    assert.equal(w.status, "allowed");
    console.log(`login so far: ${out.trim().slice(-500)} exit ${String(login.exitCode)}`);
    const back = await fetch(w.redirect);
    assert.equal(back.status, 200, `the CLI's callback took the code: ${await back.clone().text()}`);
    const code = await Promise.race([ended, new Promise<string>((r) => setTimeout(() => r("timeout"), 30_000))]);
    console.log(`login said: ${out.trim().slice(-300)}`);
    assert.equal(code, 0, out);

    const after = await run(["mcp", "list"], env, home);
    console.log(`mcp list after: ${after.stdout.trim()}`);
    assert.match(after.stdout, /vyre.*Connected/s, `${after.stdout}${after.stderr}`);
    const agents = expectStatus(await s.call("mcp.connected.list", owner, {}), 200, "mcp.connected.list").agents as Array<{ agentId: string; clientName: string; calls: number }>;
    assert.equal(agents.length, 1);
    console.log(`joined as: ${agents[0]!.clientName}`);
  } finally {
    await s.stop();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
