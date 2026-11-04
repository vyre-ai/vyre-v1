// @nocache  (starts real processes)
// A CLI that echoes its environment never gets a held secret back out: not in a text, not in the error built from its stderr, for Claude Code, Codex and Grok. The secret is what the GitHub broker handed the session.
import test from "node:test";
import assert from "node:assert/strict";
import { CLI_ADAPTERS, createCliDriver } from "../src/drivers/cli/index.ts";
import { forgetSecrets, holdSecret, redact } from "../src/drivers/cli/redact.ts";
import { collect, driverDeps, newSpy, specOf, turnOf } from "../fixtures/golden-streams/rig.ts";

const SECRET = "ghs_walkTOKEN0123456789abcdefABCDEF";   // secret-scan: fake

test("redact: held secrets are replaced whole, only while they live, and short strings are never held", () => {
  forgetSecrets();
  holdSecret(SECRET, 10_000);
  holdSecret("short", 10_000);
  assert.equal(redact(`a ${SECRET} b ${SECRET}`, 5_000), "a [token] b [token]");
  assert.equal(redact("short words stay", 5_000), "short words stay");
  assert.equal(redact(SECRET, 20_000), SECRET, "after its expiry nothing is held");
  forgetSecrets();
});

for (const id of ["claude_code", "codex", "grok"] as const) {
  test(`${id}: a process that echoes its environment shows [token] in every text and error, never the token`, async () => {
    forgetSecrets();
    holdSecret(SECRET, Date.now() + 60_000);
    const spy = newSpy();
    const session = await createCliDriver(CLI_ADAPTERS[id], driverDeps(spy, { env: () => ({ GH_TOKEN: SECRET, GITHUB_TOKEN: SECRET }) })).open(specOf());
    try {
      const events = await collect(session.send(turnOf("echoenv")));
      const all = JSON.stringify(events);
      assert.equal(all.includes(SECRET), false, "the token is in no event");
      assert.match(all, /\[token\]/);
      assert.equal(JSON.stringify(spy.envs).includes(SECRET), true, "the process itself did get it");
    } finally { await session.close(); forgetSecrets(); }
  });
}
