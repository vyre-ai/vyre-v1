// Vyre for Chrome inside each profile, paired with the Space as that agent (owner decision 6 Nov). The extension talks to "the Vyre app" through the native messaging host `run.vyre.bridge`
// (apps/chrome/src/worker/native/host.js), which finds a daemon from a data folder and relays over loopback HTTP. Here the daemon is browserd: each profile gets a data folder of its own
// (VYRE_DATA_DIR in that browser's environment) with a vyred.json that points at browserd's loopback bridge and an admin.token that names the profile, and the bridge is the same protocol module
// the daemon serves (lib/chrome-bridge.ts, vendored beside this file). What the extension may do here is what an agent's computer lets it (apps/chrome/src/computer/identity.js):
//   hello                 the one Space the profile's agent works in, so the extension knows where it is signed in
//   vault.items.match     which of the agent's Vault items fit a page (names and field keys, never values), asked of the host over the profile's fill channel
//   vault.use             a handle to one of them
//   vault.fill            one #Handle.field into one browser ref: browserd asks the host for that value and pushes it to the page's field once, never storing it
// and agent.optin is sent (mode "computer") as soon as the Space is known, so the extension accepts the Space's agent as the one that drives this browser.
// Nothing here reads a secret except for the one value being pushed; nothing is written to disk but the loopback address and a token that opens nothing outside this container.
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { join } from "node:path";
import type { ChromeOptions } from "../../agent-computer/agentd/chrome.ts";
import type { Vault } from "../../agent-computer/agentd/vault.ts";
import { createChromeBridge } from "./vendor/chrome-bridge.ts";
import type { ChromeBridge } from "./vendor/chrome-bridge.ts";

export interface BridgeProfile {
  id: string;
  vault: Vault;
  agentId: string | undefined;
  spaceId: string | undefined;
}

export interface BridgeHubOptions {
  /** The data volume; each profile's bridge folder is `<root>/profiles/<id>/bridge`. */
  root: string;
  /** Loopback port. 0 picks one. */
  port: number;
  profile(id: string): BridgeProfile;
  log(m: string): void;
}

export interface BridgeHub {
  /** The browser options that pair one profile's browser with this bridge: written before the browser starts. */
  prepare(profileId: string): ChromeOptions;
  /** The profile's agent works in this Space (and has a Vault channel): tell the extension, once per change. */
  pair(profileId: string): void;
  state(profileId: string): { connected: number; hello: boolean; optin: boolean };
  address(): string;
  close(): void;
}

interface Rec { id: string; token: string; bridge: ChromeBridge; hello: boolean; optedIn: string | null }

export async function createBridgeHub(o: BridgeHubOptions): Promise<BridgeHub> {
  const byToken = new Map<string, Rec>();
  const byProfile = new Map<string, Rec>();

  function recOf(id: string): Rec {
    let r = byProfile.get(id);
    if (r) return r;
    const p = o.profile(id);
    const token = randomBytes(24).toString("hex");
    const rec: Rec = { id, token, hello: false, optedIn: null, bridge: null as unknown as ChromeBridge };
    rec.bridge = createChromeBridge({
      token,
      async op(op) {
        if (op === "hello") {
          rec.hello = true;
          const space = p.spaceId;
          return { version: "1", spaces: space ? [{ id: space, name: "Space", webUrl: "" }] : [], active: space ?? null, locked: false, signedIn: Boolean(space) && p.vault.hasChannel() };
        }
        if (op === "space.select") return { active: p.spaceId ?? null };
        const e = new Error("The browser of an agent does not do that.") as Error & { code: string };
        e.code = "not_available";
        throw e;
      },
      async invoke(capability, input) {
        if (capability === "vault.items.match" || capability === "vault.use") return p.vault.invoke(capability, input);
        if (capability === "vault.fill") {
          const target = input["target"] as { kind?: unknown; ref?: unknown } | undefined;
          if (typeof input["handle"] !== "string" || !target || target.kind !== "browser" || typeof target.ref !== "string") throw Object.assign(new Error("Say which handle field goes to which element."), { code: "bad_request" });
          const v = await p.vault.value(input["handle"]);
          // the value goes to the extension once, for the one ref it handed out; nothing here keeps it
          const sent = rec.bridge.push({ type: "fill", ref: target.ref, value: v.value });
          return { filled: sent > 0 };
        }
        throw Object.assign(new Error(`The browser of an agent may not call ${capability}.`), { code: "not_allowed" });
      },
      onEvent: () => undefined,
    });
    byToken.set(token, rec);
    byProfile.set(id, rec);
    return rec;
  }

  const server: Server = createServer((req, res) => {
    const auth = req.headers["authorization"];
    const rec = typeof auth === "string" && auth.startsWith("Bearer ") ? byToken.get(auth.slice(7)) : undefined;
    if (!rec) { res.writeHead(401, { "content-type": "application/json" }).end('{"error":{"code":"unauthorized"}}'); return; }
    if (!rec.bridge.handle(req as never, res as never)) res.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(o.port, "127.0.0.1", () => resolve()); });
  const port = (server.address() as { port: number }).port;
  o.log(`bridge on 127.0.0.1:${port}`);

  return {
    prepare(profileId) {
      const rec = recOf(profileId);
      const dir = join(o.root, "profiles", profileId, "bridge");
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(join(dir, "vyred.json"), JSON.stringify({ url: `http://127.0.0.1:${port}`, pid: process.pid, roles: ["space"] }));
      writeFileSync(join(dir, "admin.token"), rec.token, { mode: 0o600 });
      chmodSync(join(dir, "admin.token"), 0o600);
      return { env: { VYRE_DATA_DIR: dir } };
    },
    pair(profileId) {
      const rec = recOf(profileId);
      const space = o.profile(profileId).spaceId;
      if (!space || rec.optedIn === space) return;
      rec.optedIn = space;
      rec.bridge.optIn([space], "computer");
    },
    state(profileId) {
      const rec = byProfile.get(profileId);
      return rec ? { connected: rec.bridge.connected, hello: rec.hello, optin: rec.optedIn !== null } : { connected: 0, hello: false, optin: false };
    },
    address: () => `http://127.0.0.1:${port}`,
    close() { server.close(); for (const r of byProfile.values()) r.bridge.closeStreams(); },
  };
}
