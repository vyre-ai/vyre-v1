// The two made-up CRMs of modules/connectors/fixtures/crm.ts behind one real HTTP server on a loopback port. A request names the CRM it is for in x-fake-host (crm-a.test or
// crm-b.test), so the connectors module sees https addresses on its declared domains while the bytes travel over a real socket, with real headers (the Link header included).
import http from "node:http";
import { crm } from "../../modules/connectors/fixtures/crm.ts";

export interface FakeCrm {
  c: ReturnType<typeof crm>;
  /** What the connectors module calls as ctx.http: rewrites an https://crm-x.test address to the loopback server. */
  fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; text(): Promise<string>; link?: string }>;
  methods(): string[];
  close(): Promise<void>;
}

export async function startFakeCrm(): Promise<FakeCrm> {
  const c = crm();
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (x: Buffer) => chunks.push(x));
    req.on("end", () => {
      const host = String(req.headers["x-fake-host"] ?? "");
      const raw = Buffer.concat(chunks).toString("utf8");
      const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)]));
      const r = c.handle({ method: req.method ?? "GET", url: `https://${host}${req.url}`, headers, ...(raw ? { body: JSON.parse(raw) as unknown } : {}) });
      res.writeHead(r.status, { "content-type": "application/json", ...(r.headers ?? {}) });
      res.end(r.body === undefined ? "" : JSON.stringify(r.body));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  return {
    c,
    async fetch(url, init) {
      const u = new URL(url);
      const res = await fetch(`http://127.0.0.1:${port}${u.pathname}${u.search}`, {
        method: init?.method ?? "GET", headers: { ...(init?.headers ?? {}), "x-fake-host": u.hostname }, ...(init?.body !== undefined ? { body: init.body } : {}),
      });
      const text = await res.text();
      const link = res.headers.get("link");
      return { status: res.status, text: async () => text, ...(link ? { link } : {}) };
    },
    methods: () => c.state.requests.map((r) => r.method),
    close: () => new Promise<void>((ok) => { server.closeAllConnections(); server.close(() => ok()); }),
  };
}
