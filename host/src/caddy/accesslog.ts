// Caddy's access log for deployed sites (r42-sites-run): one JSON line per finished request, sent over a loopback TCP connection to a listener in this process, which hands it to the sites
// module (requests and response time on a site's Overview, the Requests log). Caddy reaches this process at 127.0.0.1 already (the routes' forward auth), so the listener binds there and nowhere else.
// The request's headers (cookies, tokens) and the response's are removed by Caddy before the line leaves it, and the sites module keeps only the path, never the query.
import net from "node:net";
import { CaddyError } from "./admin.ts";
import type { CaddyAdmin } from "./admin.ts";
import { SERVER } from "./routes.ts";

export const ACCESS_LOGGER = "vyre";
export const ACCESS_LOG = "vyre_access";
/** The longest line taken: a client cannot make a connection hold memory with a line that never ends. */
export const MAX_LINE = 16 * 1024;
/** Caddy holds one connection; a handful is room for a restart, and no more are taken. */
export const MAX_CONNECTIONS = 8;

type Json = Record<string, unknown>;

/** A read of a part of the config that is not there: Caddy answers 404 for a missing key but 400 "invalid traversal path" when a parent of it is missing too (found against a real Caddy). */
async function read(admin: CaddyAdmin, path: string): Promise<unknown | undefined> {
  try {
    return await admin.get(path);
  } catch (e) {
    if (e instanceof CaddyError && (e.status === 400 || e.status === 404) && /traversal/.test(e.body)) return undefined;
    throw e;
  }
}

/** The config Caddy needs to write access lines to `port` on this machine: the log, and the vyre server's switch for logging its requests under that name. */
export function accessLogConfig(port: number): { log: Json; server: Json } {
  return {
    log: {
      writer: { output: "net", address: `tcp/127.0.0.1:${port}`, dial_timeout: "2s", soft_start: true },
      encoder: {
        format: "filter",
        wrap: { format: "json" },
        fields: { "request>headers": { filter: "delete" }, resp_headers: { filter: "delete" } },
      },
      include: [`http.log.access.${ACCESS_LOGGER}`],
    },
    server: { default_logger_name: ACCESS_LOGGER },
  };
}

/** Make Caddy write access lines to `port`. Reads first and writes only what differs, so calling it every minute costs one read; a Caddy that restarted, or a new port after this process restarted, is put right. */
export async function ensureAccessLog(admin: CaddyAdmin, port: number): Promise<"set" | "same"> {
  const want = accessLogConfig(port);
  let changed = false;
  const logPath = `/config/logging/logs/${ACCESS_LOG}`;
  const serverPath = `/config/apps/http/servers/${SERVER}/logs`;
  // Caddy hands back its own normalised copy of what it was given (found against a real Caddy: it adds defaults), so "the same" is judged on the parts this writes
  const same = (have: unknown, value: Json): boolean => {
    const h = have as Json;
    if (typeof h !== "object" || h === null) return false;
    return Object.entries(value).every(([k, v]) =>
      typeof v === "object" && v !== null && !Array.isArray(v)
        ? same(h[k], v as Json)
        : JSON.stringify(h[k]) === JSON.stringify(v),
    );
  };
  const put = async (path: string, value: Json): Promise<void> => {
    const have = await read(admin, path);
    if (have !== undefined && same(have, value)) return;
    await admin.call(have === undefined ? "PUT" : "PATCH", path, value);
    changed = true;
  };
  // the log must exist before the server names it
  await ensureLogging(admin);
  await put(logPath, want.log);
  await put(serverPath, want.server);
  return changed ? "set" : "same";
}

async function ensureLogging(admin: CaddyAdmin): Promise<void> {
  if ((await read(admin, "/config/logging/logs")) === undefined) {
    if ((await read(admin, "/config/logging")) === undefined) await admin.call("PUT", "/config/logging", { logs: {} });
    else await admin.call("PUT", "/config/logging/logs", {});
  }
}

export interface AccessSink {
  port: number;
  close(): Promise<void>;
}

/** The listener Caddy writes to: lines in, one call of `onLine` for each. Loopback only. A connection that sends a line longer than MAX_LINE is closed. */
export function startAccessSink(onLine: (line: string) => void): Promise<AccessSink> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((sock) => {
    if (sockets.size >= MAX_CONNECTIONS) return void sock.destroy();
    sockets.add(sock);
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("data", (chunk: string) => {
      buf += chunk;
      let i = buf.indexOf("\n");
      while (i >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line !== "") {
          try {
            onLine(line);
          } catch {
            /* one bad line does not stop the rest */
          }
        }
        i = buf.indexOf("\n");
      }
      if (buf.length > MAX_LINE) sock.destroy();
    });
    sock.on("error", () => undefined);
    sock.on("close", () => sockets.delete(sock));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const a = server.address();
      if (!a || typeof a === "string") return reject(new Error("no port"));
      resolve({
        port: a.port,
        close: () =>
          new Promise<void>((done) => {
            for (const s of sockets) s.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}
