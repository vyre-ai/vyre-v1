// r40: Caddy's guard in the server compose leaves only when its shared namespace has lost its network card, never on silence from vyred (a slow start must not restart Caddy). The behaviour was run
// against a stub vyred on a Docker host (slow start of 90 s: no restart; a vyred restart: the route answers again in 15 s); this keeps the file from drifting back to a port watch.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

for (const f of [
  "images/vyred/compose.server.yml",
  "scripts/install/linux/install.sh",
  "scripts/install/macos/install.sh",
]) {
  test(`${f}: Caddy's guard watches its namespace's network card and never a port of vyred`, () => {
    const text = fs.readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
    assert.match(text, /\[ -e \/sys\/class\/net\/eth0 \]/);
    assert.doesNotMatch(text, /nc -z/);
    assert.match(text, /restart: unless-stopped/);
  });
}
