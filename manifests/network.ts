// network (lane L7b): domain, certificate, relay, servers list, public hostnames (spec Networking, ARCH 5.9, 7.10).
import { create, defineManifest, ev, health, read, t, write } from '../packages/contracts/src/index.ts';

const serverId = t.id('srv');
const state = t.enm('healthy', 'degraded', 'down');
const endpoint = t.obj({ kind: t.enm('direct', 'relay', 'tunnel'), url: t.str({ examples: ['https://northwind.example.com'] }), health: state, rttMs: t.opt(t.int()) });

export default defineManifest({
  id: 'network',
  title: 'Network',
  owner: 'L7b',
  events: [
    ev('network.domain_changed', 'The Space address changed (own domain or relay)', { p: { address: t.str(), mode: t.enm('own_domain', 'relay') }, subject: ['entity', '/address'] }),
    ev('network.certificate_renewed', 'A certificate was issued or renewed', { p: { host: t.str(), expiresAt: t.ts() }, subject: ['entity', '/host'] }),
    ev('network.certificate_failed', 'Certificate issue or renewal failed', { p: { host: t.str(), reason: t.str() }, subject: ['entity', '/host'], notify: 'health.degraded' }),
    ev('network.server_added', 'A server joined the Space for compute', { p: { serverId, name: t.str() }, subject: ['entity', '/serverId'] }),
    ev('network.server_removed', 'A server was removed', { p: { serverId }, subject: ['entity', '/serverId'] }),
  ],
  capabilities: [
    read('network.status', 'Address, certificate state, relay state and public ingress', { out: { address: t.str(), mode: t.enm('own_domain', 'relay'), certificate: t.obj({ host: t.str(), expiresAt: t.opt(t.ts()), state }), publicIngress: t.bool(), commands: t.arr(t.obj({ kind: t.str(), target: t.str(), state: t.enm('pending', 'applied', 'failed'), at: t.ts(), detail: t.opt(t.str()) })) }, perm: 'server.network', tool: 'engineer' }),
    write('network.domain_set', 'Set the Space address to an own domain (DNS check, then ACME)', { in: { domain: t.str({ examples: ['space.example.com'] }) }, out: { dnsOk: t.bool(), records: t.arr(t.obj({ type: t.str(), name: t.str(), value: t.str() })) }, perm: 'server.network', level: 'manage', risk: 'high', audit: 'always', emits: ['network.domain_changed'], tool: 'engineer' }),
    write('network.relay_set', 'Switch the Space to the relay or back, with no re-invite (devices pin the Space key, not the address)', { in: { mode: t.enm('own_domain', 'relay') }, out: { address: t.str() }, perm: 'server.network', level: 'manage', risk: 'high', audit: 'always', emits: ['network.domain_changed'], tool: 'engineer' }),
    write('network.certificate_renew', 'Renew a certificate now', { in: { host: t.str() }, out: { state }, perm: 'server.network', emits: ['network.certificate_renewed', 'network.certificate_failed'], tool: 'engineer' }),
    read('network.public_hostnames', 'Public hostnames and /hooks endpoints served by this Space', { out: { hosts: t.arr(t.obj({ host: t.str(), kind: t.enm('app', 'console', 'site', 'form', 'booking', 'hook'), certificate: state })) }, perm: 'server.network', tool: 'engineer' }),
    read('network.ingress_check', 'Check whether forms and webhooks can reach this Space from outside', { out: { reachable: t.bool(), detail: t.opt(t.str()) }, perm: 'server.network', tool: 'engineer' }),
    read('network.endpoints', 'Endpoint list for the connection manager: direct, relay and tunnel with health and round trip time', { out: { endpoints: t.arr(endpoint) } }),
    read('network.servers', 'Servers in the Space: grey rows when offline, with Reconnect and Remove', { out: { servers: t.arr(t.obj({ serverId, name: t.str(), state, role: t.enm('space', 'compute'), lastSeenAt: t.opt(t.ts()) })) }, perm: 'console.access', tool: 'engineer' }),
    create('network.server_join_code', 'Make a join code to add a cloud box or office Mac for compute', { in: {}, out: { code: t.str({ examples: ['VYRE-1234-ABCD'] }), expiresAt: t.ts() }, perm: 'server.network', level: 'manage', risk: 'high', audit: 'always', team: true, tool: 'engineer' }),
    write('network.server_reconnect', 'Reconnect an offline server', { in: { serverId }, out: { state }, perm: 'server.network', tool: 'engineer' }),
    write('network.server_remove', 'Remove a server from the Space', { in: { serverId }, out: { removed: t.bool() }, perm: 'server.network', level: 'manage', risk: 'high', audit: 'always', emits: ['network.server_removed'], gate: { act: 'delete' }, tool: 'engineer' }),
    read('network.health', 'Network health probe: certificate expiry and relay reachability', { out: { state, detail: t.opt(t.str()), latencyMs: t.opt(t.int()), daysToExpiry: t.opt(t.int()) } }),
  ],
  health: [
    health('network.certificate', 'Certificate valid', 'network.health', 'Open Console, Infrastructure, Network and renew the certificate.', { pauses: ['sends'], states: { degradedWhen: 'daysToExpiry < 14', downWhen: 'daysToExpiry < 1' } }),
    health('network.relay', 'Relay reachable', 'network.health', 'Open Console, Infrastructure, Network and check the relay row.', { dependsOn: ['network.certificate'] }),
  ],
});
