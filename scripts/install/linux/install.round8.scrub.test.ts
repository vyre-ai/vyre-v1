// Round 8 of the installer: the failed-update log never keeps the claim link or a code or token. Fixtures: install.round8-kit.test.ts. (One of the files split from install.round8.test.ts, each well under the fast runner's 30 s cap.)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SERVER, read, tmp, SAME, world, releases, updateWorld, runUpdate, withFetchStub } from "./install.round8-kit.test.ts";

test("the failed-update log and the printed reason never carry the one-time claim link or anything shaped like a code or token; the log is the owner's alone", () => {
  const dir = tmp();
  try {
    const text = read(SERVER);
    const env = updateWorld(dir, world(dir, { running: true, ...SAME }));
    const newScript = text.replace(/^check_quiet\(\) \{/m, () => `check_quiet() { [ "$(cur_version)" != 1.1.0 ] || return 1; check_quiet_real; }\ncheck_quiet_real() {`);
    releases(dir, { old: withFetchStub(text), new: newScript });
    const link = "http://0.0.0.0:8420/claim/clm_zQhbYAT9gnUS4XM1B0VgJvigDonqEd2V#fp=37587f6372506e16&s=spc_proof";
    fs.writeFileSync(path.join(dir, "server.log"), [
      "vyred-1  | vyred 1.1.0 space spc_proof listening on http://0.0.0.0:8420",
      `vyred-1  | Claim this Space as its owner (one time, valid 24 hours): ${link}`,
      "vyred-1  | vyred: setup code VYRE-ABCD-EFGH was refused",
      "vyred-1  | vyred: provider failed with token=Zx9fakefakefakefakefakefake0001 and key_abcdefghijklmnop",
      `vyred-1  | vyred: error ${link}`,
    ].join("\n") + "\n");
    const r = runUpdate(dir, env);
    assert.equal(r.status, 4, r.stderr + r.stdout);
    const log = path.join(dir, "state/update-1.1.0-failed.log");
    const kept = read(log);
    for (const s of [r.stdout, r.stderr, kept]) {
      assert.doesNotMatch(s, /Claim this Space|clm_|VYRE-ABCD-EFGH|Zx9fake|key_abcdefghijklmnop/, s);
    }
    assert.match(kept, /listening on/, "the rest of the log is kept");
    assert.match(r.stdout, /The new version said: vyred: .*\[removed\]/, "the reason line is printed, scrubbed");
    assert.equal(fs.statSync(log).mode & 0o077, 0, "0600");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
