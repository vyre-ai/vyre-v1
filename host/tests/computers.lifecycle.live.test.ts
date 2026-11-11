// @heavy docker
// The agent Computer's own lifecycle on a booted daemon (P-L2_25, spec 2.7), one of three tests that replace computers.live.test.ts, split by behaviour (the others: computers.home.live.test.ts, computers.control.live.test.ts).
// Here: a caller without the token is refused; an agent is given a computer that is asleep until pressed; it is woken and shows a real screen picture; the desktop around the browser (window manager, dock, sandboxed Chromium,
// Vyre for Chrome pinned by policy); it sleeps again and is removed with its container gone. The Files home and the take-over are in the other two. Runs only with VYRE_HEAVY_DOCKER=1.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { boot, call, docker, ensureImage, finish, seededDir, skip } from "./computers.kit.ts";

test("computers live: an agent's computer on a booted daemon is asleep until woken, shows a screen frame, and sleeps again", { skip }, async () => {
  await ensureImage();
  const dir = seededDir();
  const d = await boot(dir);
  let computerId = "";
  try {
    assert.deepEqual(d.seams?.missing, [], "no live module is left without its driver");
    assert.ok(d.seams?.wired.includes("setComputerHost"), "the computers seam is wired");

    // a caller without the token is refused, whatever the computer is
    const refused = await call(d, "computers.list", {}, "not-a-token");
    assert.ok(refused.status === 401 || refused.status === 403, `refused without a valid token, got ${refused.status}`);

    const made = await call(d, "agents.create", { name: "Desk", role: "You work at a computer.", idempotencyKey: "computers-live-agent" });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    const agentId = made.data.agent.agentId as string;

    const health = await call(d, "computers.health", {});
    assert.equal(health.status, 200, JSON.stringify(health.data));

    const prov = await call(d, "computers.provision", { agentId, idempotencyKey: "computers-live-provision" });
    assert.equal(prov.status, 200, JSON.stringify(prov.data));
    computerId = prov.data.computer.computerId as string;
    assert.equal(prov.data.computer.state, "asleep", "a computer is asleep until someone presses it");

    const woke = await call(d, "computers.wake", { computerId });
    assert.equal(woke.status, 200, JSON.stringify(woke.data));
    assert.equal(woke.data.computer.state, "working");

    const shot = await call(d, "computers.screenshot", { computerId });
    assert.equal(shot.status, 200, JSON.stringify(shot.data));
    assert.ok(typeof shot.data.fileId === "string" && shot.data.fileId.length > 0, "the picture is stored as a file");
    assert.ok(shot.data.width > 0 && shot.data.height > 0, `a real frame: ${shot.data.width}x${shot.data.height}`);

    // the desktop around the browser: the window manager and the dock run, and the dock holds Chrome, Terminal and Files and nothing else
    const box = `vyre-comp-${computerId.replace(/^cmt_/, "")}`;
    let procs = "";
    for (let i = 0; i < 40 && !(/openbox/.test(procs) && /tint2/.test(procs)); i++) {
      procs = (await docker(["exec", box, "ps", "-eo", "comm"], 30_000)).out;
      if (!(/openbox/.test(procs) && /tint2/.test(procs))) await new Promise<void>((r) => setTimeout(r, 500));
    }
    assert.match(procs, /openbox/, `the window manager runs: ${procs}`);
    assert.match(procs, /tint2/, `the dock runs: ${procs}`);
    const rc = (await docker(["exec", box, "cat", "/home/agent/.config/vyre-desktop/tint2rc"], 30_000)).out;
    assert.deepEqual([...rc.matchAll(/launcher_item_app = .*\/(\w+)\.desktop/g)].map((m) => m[1]), ["chrome", "terminal", "files"], "the dock is Chrome, Terminal and Files only");
    const files = (await docker(["exec", box, "cat", "/home/agent/.config/vyre-desktop/files.desktop"], 30_000)).out;
    assert.match(files, /pcmanfm .*\/home\/agent\/Vyre/, "Files opens the agent's own Vyre Files folder");
    // Chromium runs sandboxed: no --no-sandbox flag, and its child processes live in their own user namespace (the sandbox is active, not just allowed)
    const args = (await docker(["exec", box, "ps", "-eo", "args"], 30_000)).out;
    const chromium = args.split("\n").filter((l) => /chromium/.test(l));
    assert.ok(chromium.length > 0, "Chromium runs");
    assert.ok(!chromium.some((l) => /--no-sandbox/.test(l)), `Chromium has no --no-sandbox flag: ${chromium.slice(0, 2).join(" | ")}`);
    const ns = (await docker(["exec", box, "sh", "-c", "own=$(readlink /proc/1/ns/user); n=0; for p in $(pgrep -f -- --type=); do l=$(readlink /proc/$p/ns/user 2>/dev/null); [ -n \"$l\" ] && [ \"$l\" != \"$own\" ] && n=$((n+1)); done; echo sandboxed=$n"], 30_000)).out;
    const inNs = Number(/sandboxed=(\d+)/.exec(ns)?.[1] ?? "0");
    assert.ok(inNs > 0, `Chromium's child processes run in their own user namespace: ${ns}`);
    // Vyre for Chrome is loaded (its service worker runs) and pinned to the toolbar by policy
    // the extension's service worker starts a moment after the browser does, later on a loaded host: wait for it, up to 40 s, and assert the same thing
    let status = await docker(["exec", "-u", "10001", box, "/opt/agentd/ctl", "status", "{}"], 30_000);
    const extOf = (out: string) => (JSON.parse(out.trim().split("\n").find((l) => l.startsWith("{")) ?? "{}") as { extension?: { configured?: boolean; workers?: number } }).extension;
    for (let i = 0; i < 80 && (extOf(status.out)?.workers ?? 0) < 1; i++) { await new Promise<void>((r) => setTimeout(r, 500)); status = await docker(["exec", "-u", "10001", box, "/opt/agentd/ctl", "status", "{}"], 30_000); }
    const ext = extOf(status.out);
    assert.equal(ext?.configured, true, `the extension is in the image: ${status.out}`);
    assert.ok((ext?.workers ?? 0) >= 1, `the extension's worker runs: ${status.out}`);
    const policy = (await docker(["exec", box, "cat", "/etc/chromium/policies/managed/vyre.json"], 30_000)).out;
    assert.match(policy, /"toolbar_pin":"force_pinned"/, "the extension is pinned to the toolbar");
    assert.match(policy, /"BrowserSignin":0/, "the browser never offers to sign in");
    assert.match(policy, /"SyncDisabled":true/, "the browser never syncs");
    // a real frame of the desktop, kept for the lead to look at (the wallpaper, the browser and the dock)
    const shotDir = process.env["VYRE_SHOT_DIR"];
    if (shotDir) {
      await new Promise<void>((r) => setTimeout(r, 3_000));
      const frame = await docker(["exec", "-u", "10001", box, "/opt/agentd/ctl", "screenshot", "{}"], 60_000);
      const png = (JSON.parse(frame.out.trim().split("\n").find((l) => l.startsWith("{")) ?? "{}") as { png?: string }).png;
      assert.ok(png, "agentd answered a picture");
      fs.mkdirSync(shotDir, { recursive: true });
      fs.writeFileSync(path.join(shotDir, "P-L2_31-computer-desktop.png"), Buffer.from(png!, "base64"));
    }

    const slept = await call(d, "computers.sleep", { computerId });
    assert.equal(slept.status, 200, JSON.stringify(slept.data));
    assert.equal(slept.data.computer.state, "asleep");

    // remove: the call succeeds and the container is gone
    const removed = await call(d, "computers.remove", { computerId });
    assert.equal(removed.status, 200, JSON.stringify(removed.data));
    const left = await docker(["ps", "-aq", "--filter", `name=^${box}$`], 30_000);
    assert.equal(left.out.trim(), "", `the container is removed: ${left.out}`);
    computerId = "";
  } finally {
    await finish(d, computerId);
  }
});
