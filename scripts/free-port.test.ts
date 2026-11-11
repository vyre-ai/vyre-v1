// A test helper must not pick a "free" port, close it, and bind it later. Between the close and the bind another process on the machine can be handed the same port (a walk's boot takes seconds, a busy build host
// has many ephemeral listeners): the bind then fails, in a place nobody catches, and the daemon the walk already started keeps the process alive until the watchdog kills it.
// Hold the socket instead: listen on port 0 and keep the server (or put an edge on port 0 first, start the daemon on 0 and tell it the edge's address, as test/support/mail-browser.ts does).
// This guard fails on the pattern: a function that listens on port 0 and, in the same callback, closes the server and hands the port number on. The places below are the ones that must keep it, each with why.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** file (repo relative) -> why it may keep the pattern. */
export const KEPT: Record<string, string> = {
  "apps/app/tests/real-app-harness.test.ts": "bootFreshSpace(publishLocal): the daemon binds the port itself and must be told its own address before it starts; the boot is tried again on another port when the bind fails (and the failed try's daemon is killed)",
  "host/tests/compute.stream.live.test.ts": "the port goes straight into startStreamServer in the next statement (product code that binds a given port and builds its own address from it); the gap is one tick",
  "agent/tests/sandbox.net.heavy.test.ts": "the port is handed to a sandboxed program that binds it itself",
  "modules/engine/tests/access.heavy.test.ts": "the port is handed to sshd, which binds it itself",
  "modules/esign/tests/documenso.heavy.test.ts": "the port is handed to a Documenso container, which binds it itself",
  "sandbox/tests/bridge-status.test.ts": "the port is handed to the bridge process under test, which binds it itself",
};

const SKIP = new Set(["node_modules", ".git", "dist", ".expo", "target", "walks-evidence", "shots-evidence"]);
function* sources(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* sources(p);
    else if (/\.(ts|tsx|mjs)$/.test(e.name)) yield p;
  }
}

/** Where a file listens on port 0 and, within the same callback, closes and resolves a bare port number. */
export function givenBack(text: string): number[] {
  const lines: number[] = [];
  for (const m of text.matchAll(/listen\(\s*0\b/g)) {
    const near = text.slice(m.index, m.index! + 260);
    if (/\.close\(/.test(near) && /\b(?:resolve|r|ok|done)\(\s*\w+\s*\)/.test(near)) lines.push(text.slice(0, m.index).split("\n").length);
  }
  return lines;
}

test("the guard sees the pattern it exists to stop, and not a helper that keeps its server", () => {
  assert.deepEqual(givenBack('const p = await new Promise<number>((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); }); });'), [1]);
  assert.deepEqual(givenBack('await new Promise<void>((r) => server.listen(0, "127.0.0.1", r)); const port = server.address().port;'), []);
});

test("no test helper picks a free port, closes it and binds it later, except where listed with a reason", () => {
  const found: string[] = [];
  for (const file of sources(root)) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (rel === "scripts/free-port.test.ts") continue;
    if (givenBack(fs.readFileSync(file, "utf8")).length > 0) found.push(rel);
  }
  const unlisted = found.filter((f) => !(f in KEPT));
  assert.deepEqual(unlisted, [], `these files pick a port, close it and bind it later (hold the socket instead, or list the file in KEPT with the reason): ${unlisted.join(", ")}`);
  const stale = Object.keys(KEPT).filter((f) => !found.includes(f));
  assert.deepEqual(stale, [], `listed in KEPT but no longer has the pattern, so remove it from the list: ${stale.join(", ")}`);
});
