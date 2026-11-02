// One HTTP request to a port on a computer, by address. The Space uses it for a computer on its own machine and a node uses it for one of its own: the site's code is never in this process, only its bytes pass.
import http from "node:http";

export interface PortRequest { method: string; path: string; headers: Record<string, string>; body?: Uint8Array | undefined }
export interface PortSink { head(status: number, headers: Record<string, string>): void; data(chunk: Buffer): void; end(): void; fail(reason: string): void }

const PORT_MS = 30_000;

export function dialPort(address: string, port: number, r: PortRequest, sink: PortSink, timeoutMs = PORT_MS): void {
  const headers = { ...r.headers, ...(r.body?.length ? { "content-length": String(r.body.length) } : {}) };
  const req = http.request({ host: address, port, method: r.method, path: r.path, headers, timeout: timeoutMs }, (res) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers)) if (typeof v === "string") out[k] = v;
    sink.head(res.statusCode ?? 502, out);
    res.on("data", (c: Buffer) => sink.data(c));
    res.on("end", () => sink.end());
    res.on("error", () => sink.fail("the response was cut"));
  });
  req.on("timeout", () => req.destroy(new Error("the port did not answer in time")));
  req.on("error", (e) => sink.fail(e.message));
  req.end(r.body?.length ? Buffer.from(r.body) : undefined);
}
