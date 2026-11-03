// Where Vault > Connections finds MCP servers to add (owner ruling D29, 3 Nov 2026): the official MCP registry first (registry.modelcontextprotocol.io), with room for a second source such as
// Smithery later. A source is data plus two pure functions: the address of one search page, and the reading of that page into catalog entries. Fetching is the host's (agents module, host seam);
// this file never touches the network, so the app and the tests can read a recorded page through the same parser.
// An entry becomes a connection draft: a remote address (and the headers it asks for), or a package the sandbox runs with npx, uvx or docker (and the environment values it asks for). What the
// person must give is listed by name with whether it is secret; a secret goes into the Vault and the connection keeps only its handle.

export type CatalogSourceId = "official" | "smithery";

export interface CatalogInput {
  name: string;
  description: string;
  required: boolean;
  /** A key, token or password: it goes into the Vault and the connection keeps its handle. */
  secret: boolean;
  /** A fixed value the registry gives (not a secret), or a template such as "Bearer {api_key}". */
  value?: string;
}

export interface CatalogRemote { url: string; transport: "http" | "sse"; headers: CatalogInput[] }
export interface CatalogPackage { registry: "npm" | "pypi" | "oci"; runner: "npx" | "uvx" | "docker"; identifier: string; version: string; env: CatalogInput[] }

export interface CatalogEntry {
  /** `<source>:<name>`, unique across sources. */
  id: string;
  source: CatalogSourceId;
  /** The registry name, such as com.notion/mcp. */
  name: string;
  /** What a person reads: the registry title, else the last part of the name. */
  title: string;
  description: string;
  version: string;
  website?: string;
  repository?: string;
  remote?: CatalogRemote;
  package?: CatalogPackage;
  /** How it signs in: OAuth (a remote that asks for no header), a key (a secret header or value), or nothing. */
  signIn: "oauth" | "key" | "none";
}

export interface CatalogPage { entries: CatalogEntry[]; next?: string }

export interface CatalogSource {
  id: CatalogSourceId;
  label: string;
  /** The address of one page of results. */
  searchUrl(q: string, cursor?: string, limit?: number): string;
  /** One page of the source's answer as entries; anything it cannot use is left out, never thrown. */
  parse(json: unknown): CatalogPage;
}

const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const s = (v: unknown): string => (typeof v === "string" ? v : "");
const SECRET_NAME = /(authorization|api[-_]?key|token|secret|password|passwd|cookie|credential|private[-_]?key|bearer)/i;

const inputOf = (raw: unknown): CatalogInput | null => {
  const r = rec(raw);
  const name = s(r["name"]);
  if (!name) return null;
  const value = s(r["value"]) || s(r["default"]);
  return { name, description: s(r["description"]).slice(0, 300), required: r["isRequired"] === true, secret: r["isSecret"] === true || SECRET_NAME.test(name), ...(value ? { value } : {}) };
};

const RUNNERS: Record<string, CatalogPackage["runner"]> = { npm: "npx", pypi: "uvx", oci: "docker" };

/** The official MCP registry (registry.modelcontextprotocol.io, API v0, schema 2025-09 and later). Only the latest version of each server is asked for. */
export const OFFICIAL: CatalogSource = {
  id: "official",
  label: "MCP Registry",
  searchUrl(q, cursor, limit = 30) {
    const p = new URLSearchParams({ limit: String(Math.max(1, Math.min(100, limit))), version: "latest" });
    if (q.trim()) p.set("search", q.trim());
    if (cursor) p.set("cursor", cursor);
    return `https://registry.modelcontextprotocol.io/v0/servers?${p.toString()}`;
  },
  parse(json) {
    const body = rec(json);
    const entries: CatalogEntry[] = [];
    const seen = new Set<string>();
    for (const item of arr(body["servers"])) {
      // the 2025-09 schema wraps each server ({ server, _meta }); the older one did not
      const it = rec(item);
      const v = it["server"] !== undefined ? rec(it["server"]) : it;
      const name = s(v["name"]);
      if (!name || seen.has(name)) continue;
      const meta = rec(rec(it["_meta"])["io.modelcontextprotocol.registry/official"]);
      if (s(meta["status"]) && s(meta["status"]) !== "active") continue;
      let remote: CatalogRemote | undefined;
      for (const r of arr(v["remotes"])) {
        const rr = rec(r);
        const url = s(rr["url"]);
        const type = s(rr["type"]) || s(rr["transport_type"]);
        if (!/^https:\/\//.test(url)) continue;
        if (type !== "streamable-http" && type !== "http" && type !== "sse") continue;
        const headers = arr(rr["headers"]).map(inputOf).filter((x): x is CatalogInput => x !== null);
        // streamable HTTP first: it is what Vyre's client speaks best
        if (!remote || (remote.transport === "sse" && type !== "sse")) remote = { url, transport: type === "sse" ? "sse" : "http", headers };
      }
      let pkg: CatalogPackage | undefined;
      for (const p of arr(v["packages"])) {
        const pp = rec(p);
        const registry = (s(pp["registryType"]) || s(pp["registry_name"])) as CatalogPackage["registry"];
        const identifier = s(pp["identifier"]) || s(pp["name"]);
        const transport = s(rec(pp["transport"])["type"]) || "stdio";
        if (!RUNNERS[registry] || !identifier || transport !== "stdio") continue;
        const env = arr(pp["environmentVariables"] ?? pp["environment_variables"]).map(inputOf).filter((x): x is CatalogInput => x !== null);
        const cand: CatalogPackage = { registry, runner: RUNNERS[registry]!, identifier, version: s(pp["version"]), env };
        // npm before PyPI before a container: a container needs Docker on the server
        if (!pkg || (pkg.registry === "oci" && registry !== "oci") || (pkg.registry === "pypi" && registry === "npm")) pkg = cand;
      }
      if (!remote && !pkg) continue;
      seen.add(name);
      const asks = [...(remote?.headers ?? []), ...(remote ? [] : pkg?.env ?? [])];
      const signIn: CatalogEntry["signIn"] = remote && remote.headers.length === 0 ? "oauth" : asks.some((x) => x.secret) ? "key" : "none";
      const repo = s(rec(v["repository"])["url"]);
      entries.push({
        id: `official:${name}`, source: "official", name, title: s(v["title"]) || titleOf(name), description: s(v["description"]).slice(0, 400), version: s(v["version"]),
        ...(s(v["websiteUrl"]) ? { website: s(v["websiteUrl"]) } : {}), ...(repo ? { repository: repo } : {}), ...(remote ? { remote } : {}), ...(pkg ? { package: pkg } : {}), signIn,
      });
    }
    const next = s(rec(body["metadata"])["nextCursor"]) || s(rec(body["metadata"])["next_cursor"]);
    return { entries, ...(next ? { next } : {}) };
  },
};

/** The sources, in the order they are offered. Smithery joins here as a second source; nothing else changes. */
export const CATALOG_SOURCES: readonly CatalogSource[] = [OFFICIAL];
export const sourceById = (id: string | undefined): CatalogSource | undefined => CATALOG_SOURCES.find((c) => c.id === (id ?? "official"));

/** "notion" from "com.notion/mcp", "github-mcp" from "io.github.acme/github-mcp": the last part that says something. */
export function titleOf(name: string): string {
  const parts = name.split("/");
  const last = parts[parts.length - 1] ?? name;
  const base = last === "mcp" || last === "server" || last === "mcp-server" ? (parts[0] ?? last).split(".").filter((x) => !["com", "io", "ai", "app", "dev", "org", "net", "github"].includes(x)).pop() ?? last : last;
  return base.replace(/[-_]?mcp[-_]?server$|^mcp[-_]|[-_]mcp$/i, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || last;
}

/** A connection name from a title or registry name: letters, digits, dash and underscore, 40 at most. */
export function connectionName(from: string): string {
  const n = from.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^[^a-z0-9]+|-+$/g, "").slice(0, 40);
  return n || "server";
}

/** What adding an entry asks of the person and what the connection becomes. */
export interface EntryPlan {
  name: string;
  title: string;
  url?: string;
  command?: string;
  args: string[];
  /** Values the person must give: secrets go into the Vault, the rest stay plain. A header's template ("Bearer {key}") is kept, with the handle put where the value goes. */
  asks: Array<CatalogInput & { into: "env" | "header" }>;
  /** A remote that asks for no header: it signs in with OAuth if it needs anything at all. */
  oauth: boolean;
}

export function planEntry(entry: CatalogEntry, prefer: "remote" | "package" = "remote"): EntryPlan {
  const name = connectionName(entry.title || titleOf(entry.name));
  const useRemote = entry.remote && (prefer === "remote" || !entry.package);
  if (useRemote) {
    const r = entry.remote!;
    return { name, title: entry.title, url: r.url, args: [], asks: r.headers.map((h) => ({ ...h, into: "header" as const })), oauth: r.headers.length === 0 };
  }
  const p = entry.package!;
  const at = p.version ? (p.registry === "pypi" ? `${p.identifier}==${p.version}` : `${p.identifier}@${p.version}`) : p.identifier;
  const args = p.runner === "npx" ? ["-y", at] : p.runner === "uvx" ? [at] : ["run", "-i", "--rm", ...p.env.flatMap((e) => ["-e", e.name]), p.identifier.includes(":") || !p.version ? p.identifier : `${p.identifier}:${p.version}`];
  return { name, title: entry.title, command: p.runner, args, asks: p.env.map((e) => ({ ...e, into: "env" as const })), oauth: false };
}

/** A header value from its template and the Vault handle: "Bearer {smithery_api_key}" becomes "Bearer #Notion_key.value". No template: the handle alone. */
export function headerValue(template: string | undefined, handle: string): string {
  if (!template) return handle;
  return /\{[^}]+\}/.test(template) ? template.replace(/\{[^}]+\}/, handle) : handle;
}

/** The package a command runs: `npx -y @acme/server@1.2` is @acme/server, `uvx acme-mcp==0.3` is acme-mcp, `docker run ... ghcr.io/acme/mcp:1` is ghcr.io/acme/mcp. */
export function packageOf(command: string | undefined, args: readonly string[] = []): string | undefined {
  if (!command) return undefined;
  const prog = command.split("/").pop() ?? command;
  if (prog !== "npx" && prog !== "uvx" && prog !== "docker" && prog !== "pnpx" && prog !== "bunx") return undefined;
  const rest = prog === "docker" ? args.slice(Math.max(0, args.indexOf("run") + 1)) : args;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith("-")) { if (prog === "docker" && /^-(e|v|p|-env|-name|-volume|-network)$/.test(a)) i++; continue; }
    return prog === "docker" ? a.replace(/:[^/:]+$/, "") : a.replace(/^(@?[^@=]+)[@=].*$/, "$1");
  }
  return undefined;
}

/** Whether the Space's allow-list lets this be added: an entry may be a registry name, an https host (a parent domain covers its subdomains) or a package. An empty list allows nothing. */
export function allowedBy(list: readonly string[], c: { url?: string | undefined; command?: string | undefined; args?: readonly string[] | undefined; registryName?: string | undefined }): boolean {
  const entries = list.map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (c.registryName && entries.includes(c.registryName.toLowerCase())) return true;
  if (c.url) {
    let host = "";
    try { host = new URL(c.url).hostname.toLowerCase(); } catch { return false; }
    if (entries.some((e) => host === e || host.endsWith(`.${e}`))) return true;
  }
  const pkg = packageOf(c.command, c.args ?? [])?.toLowerCase();
  return pkg !== undefined && entries.includes(pkg);
}
