// A test Space's outside world for the artifact host's self-check (host/src/daemon/daemon.ts checkArtifactHost): the host's name reaches the daemon, with that name in Host, the way DNS, Caddy and a
// certificate would carry it; every other address answers like the Caddy admin API stand-in. A Space whose artifact host is not reached this way hands out no artifact address, and says so.
import http from "node:http";
import type { FetchFn } from "../src/platform/probes.ts";

export function reachingFetch(artifactHost: string, daemonUrl: () => string): FetchFn {
  return (url, init) => {
    const u = new URL(url);
    if (u.hostname !== artifactHost.replace(/:\d+$/, ""))
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve('{"apps":{"http":{}}}'),
      });
    return new Promise((resolve, reject) => {
      const d = new URL(daemonUrl());
      const r = http.request(
        {
          host: d.hostname,
          port: d.port,
          path: `${u.pathname}${u.search}`,
          method: init?.method ?? "GET",
          headers: { ...(init?.headers ?? {}), host: u.host },
        },
        (res) => {
          const c: Buffer[] = [];
          res.on("data", (x: Buffer) => c.push(x));
          res.on("end", () =>
            resolve({
              ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
              status: res.statusCode ?? 0,
              headers: { get: (n) => String(res.headers[n.toLowerCase()] ?? "") || null },
              text: () => Promise.resolve(Buffer.concat(c).toString("utf8")),
            }),
          );
        },
      );
      r.on("error", reject);
      r.end();
    });
  };
}
