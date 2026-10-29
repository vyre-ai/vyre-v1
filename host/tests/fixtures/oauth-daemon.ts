// A booted daemon for browser tests that need a disposable OAuth provider: run as its own process (node host/tests/fixtures/oauth-daemon.ts <data dir>), so a test in another layer starts it instead of importing the
// host. It prints one JSON line {"url","control"} when ready. The control address answers GET /state and takes POST /expect {code,challenge} and POST /expire (the access token ends at the app).
// Callers "Bearer owner" and anyone else are the seeded Owner and Member. The provider is the connector network seam, so the daemon, connector pipeline and Vault are real.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { bootCore, CORE_SPACE } from "../../../fixtures/seed/core/index.ts";
import { oauthProvider } from "../../../fixtures/oauth-provider.ts";
import { startDaemon } from "../../src/daemon/daemon.ts";
import { loadConfig } from "../../src/daemon/config.ts";
import { fakePlatform } from "../../src/platform/index.ts";

const dir = process.argv[2];
if (!dir) throw new Error("usage: oauth-daemon.ts <data dir>");
const core = bootCore();
core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE");
fs.copyFileSync(core.file, path.join(dir, "events.db"));
core.close();
const provider = oauthProvider();
const d = await startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "https://configured.fixture.test"], {}, "1.2.3"), platform: fakePlatform(),
  session: (headers) => ({ space: CORE_SPACE, principal: { kind: "person", id: headers.authorization === "Bearer owner" ? "usr_olivia" : "usr_noah" }, device: "fixture" }),
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  connectorNetwork: provider.network,
});
const control = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url ?? "/", "http://control");
    if (req.method === "POST" && url.pathname === "/expect") { const j = JSON.parse(body) as { code: string; challenge: string }; provider.expect(j.code, j.challenge); }
    else if (req.method === "POST" && url.pathname === "/expire") provider.expired.add(provider.access);
    const state = { seen: provider.seen, revoked: provider.revoked, refreshes: provider.refreshes, issued: provider.issued, access: provider.access, refresh: provider.refresh };
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(state));
  });
});
await new Promise<void>((r) => control.listen(0, "127.0.0.1", r));
console.log(JSON.stringify({ url: d.url, control: `http://127.0.0.1:${(control.address() as { port: number }).port}` }));
const stop = async (): Promise<void> => { control.close(); await d.stop(); process.exit(0); };
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
