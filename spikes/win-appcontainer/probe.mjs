// Runs INSIDE the AppContainer (spikes/win-appcontainer/run.ps1). One probe per run, named by argv[2]; the answer is one JSON line in argv[3] (a file in the granted folder).
import fs from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";
const [mode, out, arg] = process.argv.slice(2);
const done = (r) => { fs.writeFileSync(out, JSON.stringify({ mode, ...r }) + "\n"); process.exit(0); };
const connect = (target, ms = 4000) => new Promise((ok) => {
  const c = net.connect(target);
  const t = setTimeout(() => { c.destroy(); ok({ ok: false, error: "timeout" }); }, ms);
  let got = "";
  c.setEncoding("utf8").on("data", (d) => { got += d; }).on("close", () => { clearTimeout(t); ok(got !== "" ? { ok: true, got } : { ok: false, error: "closed" }); });
  c.on("error", (e) => { clearTimeout(t); ok({ ok: false, error: e.code ?? e.message }); });
});
try {
  if (mode === "host-loopback") done(await connect({ host: "127.0.0.1", port: Number(arg) }));
  else if (mode === "pipe") done(await connect(arg));
  else if (mode === "same-process-loopback") {
    const s = net.createServer((c) => c.end("hi")).listen(0, "127.0.0.1", async () => done(await connect({ host: "127.0.0.1", port: s.address().port })));
    s.on("error", (e) => done({ ok: false, error: `listen ${e.code}` }));
  } else if (mode === "cross-process-loopback") {
    const s = net.createServer((c) => c.end("hi")).listen(0, "127.0.0.1", () => {
      const child = spawn(process.execPath, ["--preserve-symlinks", "--preserve-symlinks-main", process.argv[1], "host-loopback", out + ".child", String(s.address().port)], { stdio: "ignore" });
      child.on("exit", () => { try { done({ child: JSON.parse(fs.readFileSync(out + ".child", "utf8")) }); } catch (e) { done({ ok: false, error: `child wrote nothing: ${e.message}` }); } });
      child.on("error", (e) => done({ ok: false, error: `spawn ${e.code}` }));
    });
    s.on("error", (e) => done({ ok: false, error: `listen ${e.code}` }));
  } else if (mode === "spawn") {
    // which ways of starting a child work inside the container
    const { spawnSync } = await import("node:child_process");
    const cmd = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\cmd.exe`;
    const tries = {
      nodeSync: () => spawnSync(process.execPath, ["--version"], { encoding: "utf8" }),
      nodeSyncDetached: () => spawnSync(process.execPath, ["--version"], { encoding: "utf8", detached: true }),
      cmdSync: () => spawnSync(cmd, ["/c", "echo", "hi"], { encoding: "utf8" }),
      cmdSyncDetached: () => spawnSync(cmd, ["/c", "echo", "hi"], { encoding: "utf8", detached: true }),
      nodeSyncHidden: () => spawnSync(process.execPath, ["--version"], { encoding: "utf8", windowsHide: true }),
    };
    const r = {};
    for (const [k, f] of Object.entries(tries)) { try { const x = f(); r[k] = x.error ? `${x.error.code} ${x.error.syscall ?? ""}` : `exit ${x.status} ${String(x.stdout).trim()}`; } catch (e) { r[k] = `threw ${e.code ?? e.message}`; } }
    done({ ok: true, ...r });
  } else if (mode === "listen") {
    // stays up, answering "hi"; writes its port to `out`
    const s = net.createServer((c) => c.end("hi")).listen(0, "127.0.0.1", () => fs.writeFileSync(out, String(s.address().port)));
    setTimeout(() => process.exit(0), 120_000);
  } else if (mode === "internet") {
    try { const r = await fetch("https://api.anthropic.com/", { signal: AbortSignal.timeout(6000) }); done({ ok: true, status: r.status }); } catch (e) { done({ ok: false, error: String(e.cause?.code ?? e.message) }); }
  } else if (mode === "read") {
    try { done({ ok: true, got: fs.readFileSync(arg, "utf8").slice(0, 40) }); } catch (e) { done({ ok: false, error: e.code }); }
  } else if (mode === "write") {
    try { fs.writeFileSync(arg, "x"); done({ ok: true }); } catch (e) { done({ ok: false, error: e.code }); }
  } else if (mode === "list") {
    try { done({ ok: true, got: fs.readdirSync(arg).slice(0, 5) }); } catch (e) { done({ ok: false, error: e.code }); }
  } else done({ ok: false, error: "unknown mode" });
} catch (e) { done({ ok: false, error: String(e) }); }
