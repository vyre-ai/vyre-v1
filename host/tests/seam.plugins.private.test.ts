// The plugins host reads a private GitHub repository with a token from the person's own GitHub: the token comes from the Vault filler by handle, goes to git in its environment as an extra header, and is
// in no argument and no address. A fake git records what it was given.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cloneTokens, createPluginsHost } from "../src/seams/plugins.ts";

function fakeGit(dir: string): { git: string; log: string } {
  const log = path.join(dir, "git.log");
  const git = path.join(dir, "git");
  fs.writeFileSync(git, `#!/bin/sh
echo "ARGS: $@" >> ${log}
echo "HEADER: $GIT_CONFIG_VALUE_0" >> ${log}
for last; do :; done
if [ "$1" = "-c" ]; then mkdir -p "$last" && printf -- '---\\nname: private-skill\\ndescription: x\\n---\\nBody\\n' > "$last/SKILL.md"; exit 0; fi
if [ "$1" = "rev-parse" ]; then echo 1234567890123456789012345678901234567890; exit 0; fi
`, { mode: 0o755 });
  return { git, log };
}

test("a private repository is cloned with the token behind the handle, in the environment and nowhere else; the token is forgotten after", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-gitfake-"));
  try {
    const { git, log } = fakeGit(dir);
    const host = createPluginsHost({ git, fillToken: (h) => { if (h !== "#fill_ok") return false; cloneTokens.set(h, "ghs_SECRETTOKEN"); return true; } });
    const out = await host.fetchTree({ kind: "git", url: "https://github.com/acme/private-skill", tokenHandle: "#fill_ok" });
    assert.equal(out.revision, "1234567890123456789012345678901234567890");
    assert.ok("SKILL.md" in out.files);
    const text = fs.readFileSync(log, "utf8");
    assert.equal(text.includes("ghs_SECRETTOKEN"), false, "the token is in no argument");
    assert.match(text, /HEADER: Authorization: Basic /);
    assert.equal(Buffer.from(/Basic (\S+)/.exec(text)![1]!, "base64").toString(), "x-access-token:ghs_SECRETTOKEN");
    assert.equal(cloneTokens.has("#fill_ok"), false, "forgotten once used");
    await assert.rejects(host.fetchTree({ kind: "git", url: "https://github.com/acme/private-skill", tokenHandle: "#fill_gone" }), /could not be used/);
    await assert.rejects(host.fetchTree({ kind: "git", url: "https://example.com/acme/x", tokenHandle: "#fill_ok" }), /only reads github\.com/);
    await assert.rejects(createPluginsHost({ git }).fetchTree({ kind: "git", url: "https://github.com/acme/x", tokenHandle: "#fill_ok" }), /could not be used/);
    // a public read sends no header
    fs.writeFileSync(log, "");
    await host.fetchTree({ kind: "git", url: "https://github.com/acme/public-skill" });
    assert.match(fs.readFileSync(log, "utf8"), /HEADER: \n/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
