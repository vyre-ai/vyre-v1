// engine-setup.ts: connecting a Claude, Codex or Grok sign-in starts Vyre's install of that engine on this computer in the background, when it is not here and there is a build for this computer. An API
// key needs no program; a program already here, or an installer that is off, starts nothing.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installOnConnect } from "../engine-setup.ts";

function rig(o: { supported?: string[]; here?: string[]; fail?: boolean } = {}) {
  const asked: string[] = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-connect-"));
  for (const p of o.here ?? []) fs.writeFileSync(path.join(dir, p), "#!/bin/sh\n", { mode: 0o755 });
  const installer = { supported: (p: string) => (o.supported ?? ["claude", "codex", "grok"]).includes(p), ensure: async (p: string) => { asked.push(p); if (o.fail) throw new Error("offline"); return `/e/${p}`; } };
  return { asked, installer, probe: { platform: "linux" as const, env: { PATH: dir }, enginesRoot: null } };
}

test("a sign-in for an engine this computer lacks starts its install at once, without waiting for it", async () => {
  for (const [key, program] of [["codex", "codex"], ["claude-code", "claude"], ["grok", "grok"]] as const) {
    const r = rig();
    assert.deepEqual(installOnConnect(key, { installer: r.installer, probe: r.probe }), [program]);
    assert.deepEqual(r.asked, [program]);
  }
  const logged: string[] = [];
  const failing = rig({ fail: true });
  assert.deepEqual(installOnConnect("codex", { installer: failing.installer, probe: failing.probe, log: (m) => logged.push(m) }), ["codex"], "the event is answered at once; the install fails later, in the log");
  await new Promise((r) => setImmediate(r));
  assert.equal(logged.length, 1);
});

test("an API key, a program already here, a computer with no build, or an installer that is off start nothing", () => {
  for (const key of ["anthropic", "openai", "xai", "local", undefined, "toString"]) {
    const r = rig();
    assert.deepEqual(installOnConnect(key, { installer: r.installer, probe: r.probe }), [], String(key));
    assert.deepEqual(r.asked, []);
  }
  const here = rig({ here: ["codex"] });
  assert.deepEqual(installOnConnect("codex", { installer: here.installer, probe: here.probe }), []);
  const none = rig({ supported: [] });
  assert.deepEqual(installOnConnect("grok", { installer: none.installer, probe: none.probe }), []);
  assert.deepEqual(installOnConnect("grok", { installer: null, probe: none.probe }), [], "a test daemon has no installer");
  assert.deepEqual([...here.asked, ...none.asked], []);
});
