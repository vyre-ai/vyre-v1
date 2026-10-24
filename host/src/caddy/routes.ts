// Caddy config JSON for a Vyre host (ARCH 7.6, 7.13). One HTTP server named "vyre" holds every route; each route has an @id so it is replaced or removed by id and a
// repeated setRoute never duplicates it. Certificates are Caddy's automatic HTTPS: a route with a host matcher is enough, Caddy gets and renews the ACME certificate
// itself (HTTP-01 or TLS-ALPN-01 on 80/443). `acme.ca: "staging"` points issuance at Let's Encrypt's staging CA for tests and first installs.
export const SERVER = "vyre";
export const ROUTE_PREFIX = "vyre-route-";
export const LE_STAGING = "https://acme-staging-v02.api.letsencrypt.org/directory";
export const BASIC_USER = "vyre";

const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^localhost$/;
const UPSTREAM = /^([A-Za-z0-9]([A-Za-z0-9._-]{0,251}[A-Za-z0-9])?|\[[0-9a-fA-F:]+\]):[0-9]{1,5}$/;

export class RouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteError";
  }
}

/** A lower-case DNS name Caddy can match. Wildcards, ports, paths and IP addresses are refused: a site gets a name, not a pattern. */
export function normalizeHost(host: string): string {
  const h = typeof host === "string" ? host.trim().toLowerCase().replace(/\.$/, "") : "";
  if (!HOST.test(h)) throw new RouteError(`"${String(host).slice(0, 80)}" is not a host name`);
  return h;
}

/** `name:port` of a container on the Space network, or an IPv4/IPv6 address and port. */
export function normalizeUpstream(upstream: string): string {
  const u = typeof upstream === "string" ? upstream.trim() : "";
  if (!UPSTREAM.test(u)) throw new RouteError(`"${String(upstream).slice(0, 80)}" is not an upstream (name:port)`);
  const port = Number(u.slice(u.lastIndexOf(":") + 1));
  if (port < 1 || port > 65535) throw new RouteError(`port ${port} is out of range`);
  return u;
}

export const routeId = (host: string): string => `${ROUTE_PREFIX}${host}`;

export interface BasicAuth { username: string; /** a bcrypt hash, never the password */ hash: string }

export interface RouteJson {
  "@id": string;
  match: { host: string[] }[];
  handle: Record<string, unknown>[];
  terminal: true;
}

/** A site route: optional basic auth first (staging and previews), then the reverse proxy to the container. */
export function siteRoute(host: string, upstream: string, auth: BasicAuth | null): RouteJson {
  const h = normalizeHost(host);
  const handle: Record<string, unknown>[] = [];
  if (auth) {
    if (!/^\$2[aby]\$\d{2}\$.{53}$/.test(auth.hash)) throw new RouteError("basic auth needs a bcrypt hash, not a password");
    handle.push({ handler: "headers", response: { set: { "X-Robots-Tag": ["noindex, nofollow"] } } });
    handle.push({ handler: "authentication", providers: { http_basic: { hash: { algorithm: "bcrypt" }, accounts: [{ username: auth.username, password: auth.hash }] } } });
  }
  handle.push({ handler: "reverse_proxy", upstreams: [{ dial: normalizeUpstream(upstream) }] });
  return { "@id": routeId(h), match: [{ host: [h] }], handle, terminal: true };
}

export interface BaseOptions {
  /** listen addresses, default [":443"]; Caddy opens :80 itself for challenges and redirects */
  listen?: string[];
  acme?: { email?: string; ca?: "production" | "staging" };
}

/** The server Caddy needs before any route exists. */
export function serverJson(o: BaseOptions = {}): Record<string, unknown> {
  return { listen: o.listen ?? [":443"], routes: [] as RouteJson[] };
}

/** A tls automation policy for ACME, or null when the defaults (Let's Encrypt production, no email) are wanted. */
export function acmePolicy(a: BaseOptions["acme"]): Record<string, unknown> | null {
  if (!a || (!a.email && (a.ca ?? "production") === "production")) return null;
  const issuer: Record<string, unknown> = { module: "acme" };
  if (a.email) issuer["email"] = a.email;
  if (a.ca === "staging") issuer["ca"] = LE_STAGING;
  return { issuers: [issuer] };
}

/** The full config for a Caddy with nothing loaded. */
export function baseConfig(o: BaseOptions = {}): Record<string, unknown> {
  const apps: Record<string, unknown> = { http: { servers: { [SERVER]: serverJson(o) } } };
  const policy = acmePolicy(o.acme);
  if (policy) apps["tls"] = { automation: { policies: [policy] } };
  return { apps };
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : undefined);

/** `config` with the vyre server present (everything else Caddy already runs is kept). Returns the same object when nothing had to change. */
export function withServer(config: Json | undefined, o: BaseOptions = {}): { config: Json; changed: boolean } {
  if (!config) return { config: baseConfig(o), changed: true };
  const apps = obj(config["apps"]);
  const http = obj(apps?.["http"]);
  const servers = obj(http?.["servers"]);
  if (servers && obj(servers[SERVER])) return { config, changed: false };
  const next: Json = { ...config, apps: { ...(apps ?? {}), http: { ...(http ?? {}), servers: { ...(servers ?? {}), [SERVER]: serverJson(o) } } } };
  const policy = acmePolicy(o.acme);
  if (policy) {
    const apps2 = next["apps"] as Json;
    const tls = obj(apps2["tls"]) ?? {};
    const automation = obj(tls["automation"]) ?? {};
    const policies = Array.isArray(automation["policies"]) ? (automation["policies"] as unknown[]) : [];
    apps2["tls"] = { ...tls, automation: { ...automation, policies: [...policies, policy] } };
  }
  return { config: next, changed: true };
}

/** The vyre server's routes in a config. */
export function routesOf(config: Json | undefined): RouteJson[] {
  const r = obj(obj(obj(obj(config?.["apps"])?.["http"])?.["servers"])?.[SERVER])?.["routes"];
  return Array.isArray(r) ? (r as RouteJson[]) : [];
}

/** The host a vyre route answers for, or undefined for a route we did not write. */
export function hostOf(route: RouteJson): string | undefined {
  return route["@id"]?.startsWith(ROUTE_PREFIX) ? route.match?.[0]?.host?.[0] : undefined;
}
