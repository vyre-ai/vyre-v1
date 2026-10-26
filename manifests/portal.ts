// portal (lane L8): site end-user accounts, record rules and scoped links; portals are built as sites on the API (spec 3.6 b18).
import { create, defineManifest, ev, read, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut } from './_common.ts';

const accountId = t.id('pac');
const account = t.obj({ accountId, siteId: id.site, email: t.str(), state: t.enm('invited', 'active', 'disabled'), recordId: t.opt(id.record) });

export default defineManifest({
  id: 'portal',
  title: 'Site accounts',
  owner: 'L8',
  events: [
    ev('portal.account_created', 'A site end-user account was created (not a Space member)', { p: { accountId, siteId: id.site }, subject: ['site', '/siteId'] }),
    ev('portal.signed_in', 'A site end-user signed in', { p: { accountId, siteId: id.site }, subject: ['site', '/siteId'] }),
    ev('portal.record_linked', 'An outside account was linked to a record with a row rule', { p: { accountId, recordId: id.record }, subject: ['record', '/recordId'] }),
    ev('portal.message_posted', 'An outside account posted into a record conversation through the API', { p: { accountId, recordId: id.record, messageId: id.message }, subject: ['record', '/recordId'] }),
  ],
  capabilities: [
    create('portal.account_create', 'Create an outside account for a site (magic link or password, per site)', { in: { siteId: id.site, email: t.str(), method: t.enm('magic_link', 'password') }, out: { account }, make: ['site', '/siteId'], perm: 'sites.deploy', emits: ['portal.account_created'], tool: 'sites', team: true }),
    write('portal.sign_in', 'Request a magic link or sign in with a password', { in: { siteId: id.site, email: t.str(), password: t.opt(t.str()), token: t.opt(t.str()) }, out: { session: t.str() }, emits: ['portal.signed_in'], http: { method: 'POST', path: '/portal/sign-in' }, team: true, errors: ['auth.bad_credentials', 'rate_limit.exceeded'] }),
    write('portal.link_record', 'Link an outside account to a contact or client record with a row rule', { in: { accountId, recordId: id.record, rowRule: t.json() }, out: { ok: t.bool() }, perm: 'sites.deploy', emits: ['portal.record_linked'], tool: 'sites' }),
    read('portal.accounts', 'List outside accounts of a site', { in: { siteId: id.site, ...pageIn }, out: { accounts: t.arr(account), ...pageOut }, on: ['site', '/siteId'], tool: 'sites' }),
    write('portal.account_disable', 'Disable an outside account', { in: { accountId }, out: { ok: t.bool() }, perm: 'sites.deploy', tool: 'sites' }),
    create('portal.file_link', 'Make a short-lived scoped link to a file for an outside account', { in: { accountId, fileId: id.file, expiresInMinutes: t.int({ minimum: 1 }) }, out: { url: t.str(), expiresAt: t.ts() }, on: ['file', '/fileId'], level: 'manage', tool: 'sites', team: true }),
    create('portal.post', 'Post into a record conversation or channel as the outside account; lands in the Inbox like any message', { in: { accountId, recordId: id.record, body: t.str() }, out: { messageId: id.message }, make: ['record', '/recordId'], emits: ['portal.message_posted'], tool: 'sites', team: true, audit: 'always' }),
    read('portal.rules', 'Row rules and grants of the site service identity', { in: { siteId: id.site }, out: { rules: t.arr(t.obj({ accountId, recordType: id.recordType, rule: t.json() })) }, on: ['site', '/siteId'], tool: 'sites' }),
  ],
});
