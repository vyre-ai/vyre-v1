// What the sites module needs of the machine (a site is a route): where a target is, whether its port answers, and its log. A computer on a node is reached over the node's own socket; one on this machine by its
// container address. With no computer, a port is on this machine, which is allowed only where the daemon runs on the person's own computer: in a container (a server) that would be vyred's own network.
import fs from "node:fs";
import path from "node:path";
import { dialPort } from "./port-fetch.ts";
import type { PortRequest, PortSink } from "./port-fetch.ts";

export interface SiteTarget { computerId?: string; port?: number; folderId?: string }
export interface SitesHostDeps {
  origin(): { origin: string; relay: boolean } | null;
  /** the node a computer lives on, or null for this machine */
  nodeOf(computerId: string): string | null;
  /** the container address of a computer on this machine */
  localAddress(computerId: string): Promise<string | null>;
  localLogs(computerId: string, slug: string, lines: number): Promise<string[]>;
  stream: {
    portFetch(nodeId: string, a: { computerId: string; port: number; request: PortRequest }, sink: PortSink): void;
    ask(nodeId: string, kind: string, input: unknown): Promise<unknown>;
    connected(nodeId: string): boolean;
  };
  /** true when this daemon runs in a container */
  contained: boolean;
}

const MIME: Readonly<Record<string, string>> = { ".html": "text/html", ".htm": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain", ".md": "text/markdown", ".pdf": "application/pdf", ".woff2": "font/woff2" };
export const mimeOf = (name: string): string => MIME[path.extname(name).toLowerCase()] ?? "application/octet-stream";
const LOCAL_MAX = 25 * 1024 * 1024;
const LOCAL_FILES = 200;

export function createSitesHost(d: SitesHostDeps) {
  async function fetchTarget(t: SiteTarget, request: PortRequest, sink: PortSink): Promise<void> {
    if (t.port === undefined) { sink.fail("It has no port."); return; }
    if (t.computerId === undefined) {
      if (d.contained) { sink.fail("A port needs a computer on a server."); return; }
      dialPort("127.0.0.1", t.port, request, sink);
      return;
    }
    const node = d.nodeOf(t.computerId);
    if (node !== null) {
      if (!d.stream.connected(node)) { sink.fail("The computer it runs on is not connected."); return; }
      d.stream.portFetch(node, { computerId: t.computerId, port: t.port, request }, sink);
      return;
    }
    const address = await d.localAddress(t.computerId).catch(() => null);
    if (!address) { sink.fail("The computer it runs on is asleep."); return; }
    dialPort(address, t.port, request, sink);
  }
  return {
    fetchTarget,
    host: {
      origin: d.origin,
      probe: (t: SiteTarget): Promise<{ answering: boolean; detail?: string }> => new Promise((resolve) => {
        let settled = false;
        const done = (r: { answering: boolean; detail?: string }): void => { if (!settled) { settled = true; resolve(r); } };
        void fetchTarget(t, { method: "GET", path: "/", headers: { "user-agent": "vyre-site-check" } }, {
          head: () => done({ answering: true }), data: () => undefined, end: () => undefined,
          fail: (reason) => done({ answering: false, detail: /ECONNREFUSED/.test(reason) ? `Nothing is listening on port ${t.port}.` : reason }),
        });
        setTimeout(() => done({ answering: false, detail: `Port ${t.port} did not answer in time.` }), 5000).unref();
      }),
      logs: async (t: SiteTarget, slug: string, lines: number): Promise<string[]> => {
        if (t.computerId === undefined) return [];
        const node = d.nodeOf(t.computerId);
        if (node === null) return d.localLogs(t.computerId, slug, lines);
        return (await d.stream.ask(node, "siteLogs", { computerId: t.computerId, slug, lines })) as string[];
      },
      // the agent's own disk, on the person's own computer. On a server the disk is the server's, not the agent's
      readLocal: async (p: string) => {
        if (d.contained) return null;
        const root = path.resolve(p);
        let stat: fs.Stats;
        try { stat = fs.statSync(root); } catch { return null; }
        const out: { path: string; base64: string; mime: string }[] = [];
        let size = 0;
        const add = (file: string, rel: string): void => {
          const bytes = fs.readFileSync(file);
          size += bytes.length;
          if (size > LOCAL_MAX || out.length >= LOCAL_FILES) throw new Error("That folder is too large to publish. Serve it from a port instead.");
          out.push({ path: rel, base64: bytes.toString("base64"), mime: mimeOf(rel) });
        };
        if (stat.isFile()) { add(root, path.basename(root)); return out; }
        const walk = (dir: string, prefix: string): void => {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name.startsWith(".") || e.name === "node_modules") continue;
            if (e.isDirectory()) walk(path.join(dir, e.name), `${prefix}${e.name}/`);
            else if (e.isFile()) add(path.join(dir, e.name), `${prefix}${e.name}`);
          }
        };
        walk(root, "");
        return out;
      },
    },
  };
}
