// Production network mutations use the existing Caddy driver. No successful no-op
// is a substitute for a missing server connection manager.
import { CaddyAdmin, CaddyRouter, normalizeHost } from '../caddy/index.ts';
import type { AdminFetch, BaseOptions } from '../caddy/index.ts';
import { defaultNetworkPort } from './commands.ts';
import type { NetworkPort, Resolver } from './commands.ts';
export interface ManagedNetworkOptions {
  adminUrl: string;
  space: string;
  upstream(): string;
  ingressHost(): string | null;
  relayReady(address: string): boolean;
  fetch?: AdminFetch;
  resolver?: Resolver;
  /** the base Caddy config when none is loaded (VYRE_CADDY_CA=internal on a test box); the same one the Sites domain edge uses */
  base?: BaseOptions;
  router?: Pick<CaddyRouter, 'setIngress' | 'certInfo' | 'hosts'>;
}
export function managedNetworkPort(options: ManagedNetworkOptions): NetworkPort {
  const router = options.router ?? new CaddyRouter({ admin: new CaddyAdmin({ baseUrl: options.adminUrl, ...(options.fetch ? { fetch: options.fetch } : {}) }), space: options.space, ...(options.base ? { base: options.base } : {}) });
  const apply = async (address: { mode: 'own_domain' | 'relay'; address: string }): Promise<void> => {
    if (address.mode === 'relay') {
      if (!options.relayReady(address.address)) throw new Error('The configured relay has no active endpoint for this Space.');
      return;
    }
    await router.setIngress(address.address, options.upstream());
  };
  const certificate = async (host: string): Promise<{ expiresAt: number | null; reason?: string }> => {
    const observed = await router.certInfo(host);
    return observed.issued && observed.expiresAt ? { expiresAt: observed.expiresAt } : { expiresAt: null, reason: observed.why ?? 'Caddy has not issued a certificate yet. Refresh after issuance.' };
  };
  return {
    ...defaultNetworkPort(options.resolver ? { resolver: options.resolver } : {}),
    applyAddress: apply,
    async renew(host) {
      if (host !== options.ingressHost()) throw new Error('Only the current Space ingress certificate is managed by this action. Other routes keep their own automatic HTTPS policy.');
      // Caddy owns ACME. Installing the managed ingress asks its automatic HTTPS
      // controller to obtain/maintain a certificate; observe what it actually has.
      await router.setIngress(host, options.upstream());
      return certificate(host);
    },
    certificate,
    // The daemon calls this at boot and on the slow timer, so a Space started with an address is reachable without anyone pressing anything in Console.
    async ensureIngress(host, o) {
      const h = normalizeHost(host);
      if (!o?.replace && (await router.hosts()).includes(h)) return false;
      await router.setIngress(h, options.upstream());
      return true;
    },
    async reconnect() { throw new Error('This host has no server connection manager configured.'); },
    async disconnect() { throw new Error('This host has no server connection manager configured.'); },
  };
}
