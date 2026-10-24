// The Caddy driver the Sites module routes through (modules/sites SiteRouter: setRoute, removeRoute, certState) plus what the host itself needs: the Space's public ingress,
// the list of routes, and certificate details (expiry) for the Console. Every route is written with an @id, so setRoute is replace-or-add and removeRoute is a delete by id.
// Staging and preview routes carry basic auth whose password is a sealed Vault key: the password is read at call time, hashed to bcrypt by the injected hasher, and only the
// hash reaches Caddy.
import { CaddyAdmin, CaddyError } from "./admin.ts";
import { baseConfig, BASIC_USER, hostOf, normalizeHost, normalizeUpstream, RouteError, routeId, routesOf, SERVER, siteRoute, withServer } from "./routes.ts";
import type { BaseOptions, BasicAuth, RouteJson } from "./routes.ts";
import { connectPeer, judgeCert } from "./tls.ts";
import type { CertInfo, PeerFn } from "./tls.ts";

export type CertState = "pending" | "issued" | "failed";
export interface RouteSpec { host: string; upstream: string; auth: { handle: string } | null }

export interface RouterOptions {
  admin: CaddyAdmin;
  /** the Space the Vault items belong to */
  space: string;
  vault?: { secret(handle: string, space: string): Promise<string> };
  /** bcrypt hash of a password; the host passes `caddy hash-password` or a library behind this */
  hasher?: { hash(password: string): Promise<string> };
  base?: BaseOptions;
  /** where Caddy serves HTTPS locally, for certificate checks. Default 127.0.0.1:443 */
  tls?: { host?: string; port?: number; peer?: PeerFn; timeoutMs?: number };
  /** without a certificate this long after a route was added, the state is "failed" instead of "pending". Default 10 minutes. */
  certFailAfterMs?: number;
  now?: () => number;
}

export class CaddyRouter {
  private o: RouterOptions;
  private now: () => number;
  private added = new Map<string, number>();

  constructor(o: RouterOptions) {
    this.o = o;
    this.now = o.now ?? Date.now;
  }

  /** Make sure Caddy has the vyre server. Loads a whole config only when there is none or the server is missing; everything else Caddy runs is kept. */
  async ensureBase(): Promise<{ created: boolean }> {
    const { config, changed } = withServer(await this.o.admin.config(), this.o.base);
    if (!changed) return { created: false };
    await this.o.admin.load(config);
    return { created: true };
  }

  async setRoute(spec: RouteSpec): Promise<void> {
    const host = normalizeHost(spec.host);
    const upstream = normalizeUpstream(spec.upstream);
    const route = siteRoute(host, upstream, spec.auth ? await this.authFor(spec.auth.handle) : null);
    await this.write(route);
    if (!this.added.has(host)) this.added.set(host, this.now());
  }

  /** The Space's own address and its console. host -> the gateway, no auth (the Gateway authenticates people). */
  async setIngress(host: string, upstream: string): Promise<void> {
    const h = normalizeHost(host);
    await this.write(siteRoute(h, normalizeUpstream(upstream), null));
    if (!this.added.has(h)) this.added.set(h, this.now());
  }

  async removeRoute(host: string): Promise<void> {
    const h = normalizeHost(host);
    this.added.delete(h);
    if ((await this.o.admin.byId(routeId(h))) === undefined) return;
    await this.o.admin.deleteById(routeId(h));
  }

  /** Hosts Vyre routes, from Caddy's running config. */
  async hosts(): Promise<string[]> {
    return routesOf(await this.o.admin.config()).map(hostOf).filter((h): h is string => h !== undefined).sort();
  }

  /** Does Caddy answer and hold the vyre server? (the host.caddy probe) */
  async loaded(): Promise<boolean> {
    return !withServer(await this.o.admin.config(), this.o.base).changed;
  }

  async certInfo(host: string): Promise<CertInfo> {
    const h = normalizeHost(host);
    const t = this.o.tls ?? {};
    const peer = t.peer ?? connectPeer;
    return judgeCert(await peer(t.host ?? "127.0.0.1", t.port ?? 443, h, t.timeoutMs ?? 3000), h, this.now());
  }

  async certState(host: string): Promise<CertState> {
    const h = normalizeHost(host);
    if ((await this.certInfo(h)).issued) return "issued";
    const since = this.added.get(h);
    return since !== undefined && this.now() - since > (this.o.certFailAfterMs ?? 600_000) ? "failed" : "pending";
  }

  private async authFor(handle: string): Promise<BasicAuth> {
    if (!this.o.vault || !this.o.hasher) throw new RouteError("Protected routes need the Vault and a password hasher; neither is connected.");
    const password = await this.o.vault.secret(handle, this.o.space);
    if (!password) throw new RouteError("The Vault key for this route's password is empty.");
    return { username: BASIC_USER, hash: await this.o.hasher.hash(password) };
  }

  private async write(route: RouteJson): Promise<void> {
    await this.ensureBase();
    const id = route["@id"];
    if ((await this.o.admin.byId(id)) !== undefined) { await this.o.admin.replaceById(id, route); return; }
    try {
      await this.o.admin.append(`/config/apps/http/servers/${SERVER}/routes`, route);
    } catch (e) {
      // a second writer added the same id between the check and the append: replace instead
      if (e instanceof CaddyError && e.status >= 400 && e.status < 500 && (await this.o.admin.byId(id)) !== undefined) { await this.o.admin.replaceById(id, route); return; }
      throw e;
    }
  }
}

export { baseConfig };
