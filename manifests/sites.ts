// sites (lane L8): anything that runs in a Docker container behind Caddy, with staging, previews, promote and rollback (spec 2.20, 3.6, ARCH 7.6).
import { block, create, defineManifest, ev, list, outward, read, screen, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut } from './_common.ts';

const state = t.enm('queued', 'building', 'ready', 'failed', 'stopped');
const dep = t.obj({ deploymentId: t.id('dpl'), siteId: id.site, env: t.enm('staging', 'preview', 'production'), state, url: t.opt(t.str()), branch: t.opt(t.str()), commit: t.opt(t.str()), at: t.ts() });
const access = t.enm('public', 'password', 'space', 'private');
const siteRow = t.obj({
  siteId: id.site, name: t.str(), kind: t.enm('site', 'app', 'api', 'worker', 'artifact'), owner: t.str(), repoFolderId: t.opt(id.folder), stagingUrl: t.opt(t.str()), productionUrl: t.opt(t.str()), state,
  slug: t.opt(t.str({ description: 'The name in the address: /p/<slug>' })), url: t.opt(t.str({ description: 'Where it is served, once live' })), computerId: t.opt(id.computer), port: t.opt(t.int()), folderId: t.opt(id.folder),
  access: t.opt(access), live: t.opt(t.bool()), blocked: t.opt(t.bool()), updatedAt: t.opt(t.ts()),
});
const target = { computerId: t.opt(id.computer), port: t.opt(t.int({ minimum: 1, maximum: 65535 })), folderId: t.opt(id.folder) };
const dnsRecord = t.obj({ type: t.enm('CNAME', 'A'), name: t.str(), value: t.str() });
const deployTarget = { siteId: id.site };

export default defineManifest({
  id: 'sites',
  title: 'Sites',
  owner: 'L8',
  events: [
    ev('site.created', 'A site was created', { p: { siteId: id.site, name: t.str(), private: t.opt(t.bool()) }, subject: ['site', '/siteId'] }),
    ev('site.published', 'A site or artifact went live at its address', { p: { siteId: id.site, url: t.opt(t.str()), access }, subject: ['site', '/siteId'] }),
    ev('site.stopped', 'A site or artifact stopped being served', { p: { siteId: id.site }, subject: ['site', '/siteId'] }),
    ev('site.build_failed', 'A build failed', { p: { siteId: id.site, deploymentId: t.id('dpl'), reason: t.str() }, subject: ['site', '/siteId'], notify: 'run.failed' }),
    ev('site.deployed', 'A deployment reached staging or a preview', { p: { siteId: id.site, deploymentId: t.id('dpl'), env: t.enm('staging', 'preview') }, subject: ['site', '/siteId'], replay: 'stub', trigger: { title: 'A site is deployed', fields: ['/env'] } }),
    ev('site.promoted', 'A build was promoted to production through the Gate', { p: { siteId: id.site, deploymentId: t.id('dpl') }, subject: ['site', '/siteId'], replay: 'stub' }),
    ev('site.rolled_back', 'Production was rolled back to an earlier build', { p: { siteId: id.site, toDeploymentId: t.id('dpl') }, subject: ['site', '/siteId'], replay: 'stub' }),
    ev('site.preview_created', 'A preview was built for a branch or pull request', { p: { siteId: id.site, branch: t.str(), url: t.str() }, subject: ['site', '/siteId'] }),
    ev('site.preview_removed', 'A preview was removed after the branch merged', { p: { siteId: id.site, branch: t.str() }, subject: ['site', '/siteId'] }),
    ev('site.table_created', 'A site table (site-scoped record type) was created; fields carries its columns so the record type can be made from the event alone', { p: { siteId: id.site, type: t.str(), fields: t.opt(t.arr(t.obj({ key: t.str(), type: t.str(), title: t.str() }))) }, subject: ['site', '/siteId'] }),
    ev('site.table_promoted', 'A site table became a Space record type', { p: { siteId: id.site, type: t.str() }, subject: ['site', '/siteId'] }),
    ev('site.domain_changed', 'A site domain was set or removed', { p: { siteId: id.site, domain: t.str() }, subject: ['site', '/siteId'] }),
  ],
  blocks: [
    block('deploy', { siteId: id.site, deploymentId: t.id('dpl'), env: t.enm('staging', 'preview', 'production'), state, url: t.opt(t.str()), checks: t.arr(t.obj({ name: t.str(), ok: t.bool() })), canPromote: t.bool() },
      'Deploy {{env}} is {{state}}: {{url}}',
      { actions: [{ key: 'promote', label: 'Promote', cap: 'sites.promote', input: { siteId: '/siteId' } }, { key: 'rollback', label: 'Roll back', cap: 'sites.rollback', input: { siteId: '/siteId' } }], opens: { tab: 'site', input: { siteId: '/siteId' } } }),
    block('artifact', { artifactId: id.site, title: t.str() }, 'Artifact: {{title}}', { opens: { tab: 'artifact', input: { artifactId: '/artifactId' } } }),
  ],
  lists: [list('site', 'Site', 'Sites', 'sites.list')],
  capabilities: [
    create('sites.create', 'Create a site: a name, and where it runs (a port on a computer, or a folder in Files). Nothing is served until it is published', { in: { name: t.str(), kind: t.opt(t.enm('site', 'app', 'api', 'worker', 'artifact')), repoUrl: t.opt(t.str()), templateKit: t.opt(id.kit), slug: t.opt(t.str()), access: t.opt(access), ...target }, out: { site: siteRow }, make: ['site', '/folderId'], perm: 'sites.deploy', emits: ['site.created'], tool: 'sites' }),
    read('sites.get', 'Read one site', { in: deployTarget, out: { site: siteRow }, on: ['site', '/siteId'], tool: 'sites' }),
    read('sites.list', 'List sites and artifacts you can see, by section (Personal, Shared with me, Space), kind and folder', { in: { section: t.opt(t.enm('personal', 'shared', 'space')), folderId: t.opt(id.folder), kind: t.opt(t.enm('site', 'artifact')), ...pageIn }, out: { sites: t.arr(siteRow), ...pageOut }, tool: 'sites', label: 'filter' }),
    write('sites.update', 'Rename a site, change its settings, where it runs or who may reach it. Making it public takes it down until it is published again', { in: { siteId: id.site, name: t.opt(t.str()), settings: t.opt(t.rec()), access: t.opt(access), ...target }, out: { site: siteRow }, on: ['site', '/siteId'], perm: 'sites.deploy', tool: 'sites' }),
    write('sites.publish', 'Serve a site that is not public: space or private access, or a password on its own domain', { in: deployTarget, out: { site: siteRow }, on: ['site', '/siteId'], perm: 'sites.deploy', emits: ['site.published'], tool: 'sites' }),
    write('sites.stop', 'Stop serving a site. Its address answers nothing; the process on the computer keeps running', { in: deployTarget, out: { site: siteRow }, on: ['site', '/siteId'], perm: 'sites.deploy', emits: ['site.stopped'], tool: 'sites' }),
    read('sites.status', 'Is the port answering? Where it runs, the address, and what is wrong when something is', { in: deployTarget, out: { answering: t.bool(), detail: t.opt(t.str()), url: t.opt(t.str()), live: t.bool(), blocked: t.bool() }, on: ['site', '/siteId'], tool: 'sites' }),
    read('sites.host', 'What this Space can host: its address, whether it is a phone address, and what a custom domain needs', { in: {}, out: { origin: t.opt(t.str()), relay: t.bool(), computers: t.bool(), domains: t.bool(), domainsNeed: t.opt(t.str()) }, perm: null, level: 'view', tool: 'sites' }),
    write('sites.delete', 'Delete a site and stop its container', { in: deployTarget, out: { deleted: t.bool() }, on: ['site', '/siteId'], level: 'manage', perm: 'sites.deploy', risk: 'high', audit: 'always', gate: { act: 'delete', when: "actor.kind != 'person'" }, tool: 'sites' }),
    write('sites.build', 'Build the site from its repo (the site agent runs in the repo); test and verify', { in: { siteId: id.site, branch: t.opt(t.str()) }, out: { runId: id.run, deploymentId: t.id('dpl') }, on: ['site', '/siteId'], perm: 'sites.deploy', run: { kind: 'build', stoppable: true }, emits: ['site.build_failed'], tool: 'sites', team: true }),
    write('sites.deploy', 'Deploy a build to the always-password-protected staging URL', { in: { siteId: id.site, deploymentId: t.opt(t.id('dpl')) }, out: { deployment: dep }, on: ['site', '/siteId'], perm: 'sites.deploy', run: { kind: 'deployment', stoppable: true }, emits: ['site.deployed'], tool: 'sites', team: true, audit: 'sensitive' }),
    read('sites.deployments', 'List deployments with state and URL', { in: { siteId: id.site, ...pageIn }, out: { deployments: t.arr(dep), ...pageOut }, on: ['site', '/siteId'], tool: 'sites' }),
    read('sites.previews', 'List previews (one per branch and pull request, on their own staging address)', { in: deployTarget, out: { previews: t.arr(dep) }, on: ['site', '/siteId'], tool: 'sites' }),
    write('sites.preview_rebuild', 'Rebuild a preview or bring back a removed one', { in: { siteId: id.site, branch: t.str() }, out: { deployment: dep }, on: ['site', '/siteId'], perm: 'sites.deploy', emits: ['site.preview_created'], tool: 'sites', team: true }),
    write('sites.preview_remove', 'Remove a preview', { in: { siteId: id.site, branch: t.str() }, out: { removed: t.bool() }, on: ['site', '/siteId'], perm: 'sites.deploy', emits: ['site.preview_removed'], tool: 'sites' }),
    outward('sites.promote', 'Put a site on the public internet at its address. Held for approval unless the person asked for it this turn', { in: { siteId: id.site }, out: { site: siteRow }, on: ['site', '/siteId'], perm: 'sites.deploy', level: 'edit', gate: { act: 'site_promote', when: "actor.kind != 'person'" }, emits: ['site.published'], tool: 'sites', errors: ['validation.precondition_failed'] }),
    outward('sites.rollback', 'Roll production back to an earlier build', { in: { siteId: id.site, toDeploymentId: t.opt(t.id('dpl')) }, out: { deployment: dep }, on: ['site', '/siteId'], perm: 'sites.promote', level: 'manage', gate: { act: 'none', reason: 'restores a build that was already approved at promote time' }, emits: ['site.rolled_back'], tool: 'sites', team: true }),
    create('sites.table_create', 'Create a site table (a site-scoped record type); no schema permission needed for people who can edit the site', { in: { siteId: id.site, key: t.str(), fields: t.arr(t.obj({ key: t.str(), type: t.str(), title: t.str() })) }, out: { type: t.str() }, on: ['site', '/siteId'], emits: ['site.table_created'], tool: 'sites', level: 'edit' }),
    read('sites.tables', 'List site tables of a site', { in: deployTarget, out: { tables: t.arr(t.obj({ type: t.str(), rows: t.int() })) }, on: ['site', '/siteId'], tool: 'sites' }),
    write('sites.table_promote', 'Promote a site table to a Space record type', { in: { siteId: id.site, type: t.str() }, out: { type: t.str() }, on: ['site', '/siteId'], perm: 'schema.manage', level: 'manage', emits: ['site.table_promoted'], tool: 'sites', audit: 'always' }),
    write('sites.env_set', 'Set environment names for deployments; values come from Vault by key name with inject into deployments', { in: { siteId: id.site, entries: t.arr(t.obj({ name: t.str(), vaultHandle: id.handle })) }, out: { ok: t.bool() }, on: ['site', '/siteId'], perm: 'sites.deploy', tool: 'sites', audit: 'sensitive', errors: ['permission.no_grant'] }),
    read('sites.env_list', 'List environment names (never values)', { in: deployTarget, out: { entries: t.arr(t.obj({ name: t.str(), vaultName: t.str(), injected: t.bool() })) }, on: ['site', '/siteId'], tool: 'sites' }),
    read('sites.domains_get', 'Site domains with the DNS check and the Caddy certificate state', { in: deployTarget, out: { domains: t.arr(t.obj({ domain: t.str(), dnsOk: t.bool(), certificate: t.enm('pending', 'issued', 'failed') })) }, on: ['site', '/siteId'], tool: 'sites' }),
    write('sites.domain_set', 'Add or remove a site domain', { in: { siteId: id.site, domain: t.str(), remove: t.opt(t.bool()) }, out: { dnsOk: t.bool() }, on: ['site', '/siteId'], perm: 'sites.domains', emits: ['site.domain_changed'], tool: 'sites', team: true }),
    create('sites.domain_add', 'Add a custom domain to a site: returns the exact DNS records to set and adds the Caddy route with automatic TLS', { in: { siteId: id.site, domain: t.str() }, out: { domain: t.str(), records: t.arr(dnsRecord), state: t.enm('waiting_dns', 'issuing', 'live') }, on: ['site', '/siteId'], perm: 'sites.domains', emits: ['site.domain_changed'], tool: 'sites', level: 'edit' }),
    read('sites.domain_check', 'The state of a custom domain: waiting for DNS, issuing the certificate, or live', { in: { siteId: id.site, domain: t.str() }, out: { domain: t.str(), records: t.arr(dnsRecord), state: t.enm('waiting_dns', 'issuing', 'live') }, on: ['site', '/siteId'], tool: 'sites' }),
    create('sites.artifact_publish', 'THE way to show something you made: publish it privately to a link that opens in a tab. Give html, a file or folder in Files, a path on this machine, or a running port. Same title or artifactId updates the same link', { in: { title: t.str(), html: t.opt(t.str()), fileId: t.opt(id.file), folderId: t.opt(id.folder), path: t.opt(t.str()), port: t.opt(t.int({ minimum: 1, maximum: 65535 })), computerId: t.opt(id.computer), artifactId: t.opt(id.site) }, out: { artifactId: id.site, url: t.opt(t.str()), updated: t.bool() }, make: ['site', '/folderId'], perm: null, level: 'view', mcpName: 'artifact_publish', emits: ['site.created', 'site.published'], tool: 'sites', errors: ['validation.precondition_failed'] }),
    write('sites.artifact_open', 'A short-lived address that opens an artifact for the person asking, in a tab or the browser', { in: { artifactId: id.site }, out: { path: t.str(), url: t.opt(t.str()), expiresAt: t.ts() }, on: ['site', '/artifactId'], tool: 'sites' }),
    write('sites.staging_password_set', 'Choose the sealed Vault key that protects staging (shared across a site previews)', { in: { siteId: id.site, vaultHandle: id.handle }, out: { ok: t.bool() }, on: ['site', '/siteId'], perm: 'sites.deploy', tool: 'sites' }),
    read('sites.service_identity', 'The site service identity and its grants (capped by the owner)', { in: deployTarget, out: { principal: t.str(), grants: t.arr(t.obj({ resource: t.str(), level: t.str() })) }, on: ['site', '/siteId'], tool: 'sites' }),
    read('sites.logs', 'Container logs of a deployment (ids and text from the site, not Vyre content)', { in: { siteId: id.site, deploymentId: t.opt(t.id('dpl')), tail: t.opt(t.int()) }, out: { lines: t.arr(t.str()) }, on: ['site', '/siteId'], perm: 'sites.deploy', tool: 'sites' }),
  ],
  screens: [
    screen('apps.sites', 'apps', 'ui:SitesList', { q: { sites: ['sites.list', { section: '/section', folderId: '/folder' }] }, a: { promote: ['sites.promote', { siteId: '/selected' }, 'Put this site on the public internet?'] }, empty: 'No sites yet', primary: 'New site', needs: ['sites.deploy'] }),
    screen('apps.artifacts', 'apps', 'ui:Artifacts', { q: { artifacts: ['sites.list', { kind: '/kind' }] }, empty: 'Nothing made yet' }),
    screen('apps.site-editor', 'apps', 'ui:SiteEditor', { slot: 'main', q: { site: ['sites.get', { siteId: '/selected' }], status: ['sites.status', { siteId: '/selected' }], domains: ['sites.domains_get', { siteId: '/selected' }] }, a: { stop: ['sites.stop', { siteId: '/selected' }, 'Stop serving this site?'] }, ask: { suggestions: { view: ['Explain this site'], edit: ['Change the hero text', 'Add a contact form'], manage: ['Put this site live'] } } }),
  ],
});
