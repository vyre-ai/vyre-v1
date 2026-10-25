// from vyre 0.6.9 relay/node/main.js@57ce975b8
// @ts-check
// The self-hosted relay as one container's entry. Plain HTTP and WebSocket: put TLS in front (relay/README.md).
//
//   VYRE_RELAY_PORT       relay port (default 8080; 0 turns the relay off)
//   VYRE_RELAY_HOST       bind address (default 0.0.0.0 inside the container; publish the port on 127.0.0.1 or behind your proxy)
//   VYRE_TUNNEL_DIRECTORY the directory's origin that says which route serves a public host (turns the Publish tunnel on; needs VYRE_RELAY_SECRET)
//   VYRE_RELAY_SECRET     the shared secret (32+ characters) the directory expects from this relay on GET /v1/tunnel/resolve
//   VYRE_TUNNEL_TLS_PORT / VYRE_TUNNEL_HTTP_PORT   the public passthrough and redirect ports (default 443 and 80)
//   VYRE_TRUST_PROXY=1    take the client address from the proxy's x-forwarded-for
// The relay holds no state on disk: routes live in memory and a restart makes every box reconnect, which they do by themselves.
import { createRelay } from "./server.js";
import { directoryResolve } from "./resolve.js";

const env = process.env;
const host = env.VYRE_RELAY_HOST || "0.0.0.0";
const num = (/** @type {string | undefined} */ v, /** @type {number} */ d) => (v === undefined || v === "" ? d : Number(v));
const log = (/** @type {string} */ m) => console.log(`${new Date().toISOString()} ${m}`);
const stops = [];
const relayPort = num(env.VYRE_RELAY_PORT, 8080);
if (relayPort > 0) {
  const trust = env.VYRE_TRUST_PROXY === "1";
  const tunnelDir = env.VYRE_TUNNEL_DIRECTORY, secret = env.VYRE_RELAY_SECRET || "";
  if (tunnelDir && secret.length < 32) { log("VYRE_RELAY_SECRET must be at least 32 characters when VYRE_TUNNEL_DIRECTORY is set"); process.exit(1); }
  // Which route serves this public host: the directory says (declared app or share hosts of a box that is not suspended), or nothing.
  const resolve = directoryResolve({ base: tunnelDir || "", secret });
  const relay = createRelay({ ...(tunnelDir ? { tunnel: { resolve } } : {}), log, clientAddress: req => (trust && String(req.headers["x-forwarded-for"] || "").split(",").pop()?.trim()) || String(req.socket.remoteAddress || "") });
  log(`relay on ${await relay.listen(relayPort, host)}`);
  if (tunnelDir) { const t = await relay.listenTunnel({ tlsPort: num(env.VYRE_TUNNEL_TLS_PORT, 443), httpPort: num(env.VYRE_TUNNEL_HTTP_PORT, 80), host }); log(`publish tunnel: tls ${t.tls}, http ${t.http}`); }
  stops.push(() => relay.close());
}
if (!stops.length) { log("nothing to run: VYRE_RELAY_PORT is 0"); process.exit(1); }
const stop = async () => { for (const f of stops) { try { await f(); } catch { /* going down */ } } process.exit(0); };
process.on("SIGTERM", stop); process.on("SIGINT", stop);
