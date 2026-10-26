// sites (lane L8): anything that runs in a Docker container behind Caddy, with staging, previews, promote and rollback (spec 2.20, 3.6, ARCH 7.6).
import { block, create, defineManifest, ev, list, outward, read, screen, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut } from './_common.ts';

const state = t.enm('queued', 'building', 'ready', 'failed', 'stopped');
const dep = t.obj({ deploymentId: t.id('dpl'), siteId: id.site, env: t.enm('staging', 'preview', 'production'), state, url: t.opt(t.str()), branch: t.opt(t.str()), commit: t.opt(t.str()), at: t.ts() });
const siteRow = t.obj({ siteId: id.site, name: t.str(), kind: t.enm('site', 'app', 'api', 'worker', 'artifact'), owner: t.str(), repoFolderId: t.opt(id.folder), stagingUrl: t.opt(t.str()), productionUrl: t.opt(t.str()), state });
const deployTarget = { siteId: id.site };

export default defineManifest({
  id: 'sites',
  title: 'Sites',
  owner: 'L8',
  events: [
    ev('site.created', 'A site was created', { p: { siteId: id.site, name: t.str() }, subject: ['site', '/siteId'] }),
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
      { actions: [{ key: 'promote', label: 'Promote', cap: 'sites.promote', input: { siteId: '/siteId', deploymentId: '/deploymentId' } }, { key: 'rollback', label: 'Roll back', cap: 'sites.rollback', input: { siteId: '/siteId' } }], opens: { tab: 'site', input: { siteId: '/siteId' } } }),
  ],
  lists: [list('site', 'Site', 'Sites', 'sites.list')],
  capabilities: [
    create('sites.create', 'Create a site with its root folder under Deployments/', { in: { name: t.str(), kind: t.enm('site', 'app', 'api', 'worker', 'artifact'), repoUrl: t.opt(t.str()), templateKit: t.opt(id.kit), folderId: t.opt(id.folder) }, out: { site: siteRow }, make: ['site', '/folderId'], perm: 'sites.deploy', emits: ['site.created'], tool: 'sites', team: true }),
    read('sites.get', 'Read one site', { in: deployTarget, out: { site: siteRow }, on: ['site', '/siteId'], tool: 'sites' }),
    read('sites.list', 'List sites by section (Personal, Shared with me, Space) and folder', { in: { section: t.opt(t.enm('personal', 'shared', 'space')), folderId: t.opt(id.folder), ...pageIn }, out: { sites: t.arr(siteRow), ...pageOut }, tool: 'sites', label: 'filter' }),
    write('sites.update', 'Rename a site or change its settings', { in: { siteId: id.site, name: t.opt(t.str()), settings: t.opt(t.rec()) }, out: { site: siteRow }, on: ['site', '/siteId'], perm: 'sites.deploy', tool: 'sites' }),
    write('sites.delete', 'Delete a site and stop its container', { in: deployTarget, out: { deleted: t.bool() }, on: ['site', '/siteId'], level: 'manage', perm: 'sites.deploy', risk: 'high', audit: 'always', gate: { act: 'delete', when: "actor.kind != 'person'" }, tool: 'sites' }),
    write('sites.build', 'Build the site from its repo (the site agent runs in the repo); test and verify', { in: { siteId: id.site, branch: t.opt(t.str()) }, out: { runId: id.run, deploymentId: t.id('dpl') }, on: ['site', '/siteId'], perm: 'sites.deploy', run: { kind: 'build', stoppable: true }, emits: ['site.build_failed'], tool: 'sites', team: true }),
    write('sites.deploy', 'Deploy a build to the always-password-protected staging URL', { in: { siteId: id.site, deploymentId: t.opt(t.id('dpl')) }, out: { deployment: dep }, on: ['site', '/siteId'], perm: 'sites.deploy', run: { kind: 'deployment', stoppable: true }, emits: ['site.deployed'], tool: 'sites', team: true, audit: 'sensitive' }),
    read('sites.deployments', 'List deployments with state and URL', { in: { siteId: id.site, ...pageIn }, out: { deployments: t.arr(dep), ...pageOut }, on: ['site', '/siteId'], tool: 'sites' }),
    read('sites.previews', 'List previews (one per branch and pull request, on their own staging address)', { in: deployTarget, out: { previews: t.arr(dep) }, on: ['site', '/siteId'], tool: 'sites' }),
    write('sites.preview_rebuild', 'Rebuild a preview or bring back a removed one', { in: { siteId: id.site, branch: t.str() }, out: { deployment: dep }, on: ['site', '/siteId'], perm: 'sites.deploy', emits: ['site.preview_created'], tool: 'sites', team: true }),
    write('sites.preview_remove', 'Remove a preview', { in: { siteId: id.site, branch: t.str() }, out: { removed: t.bool() }, on: ['site', '/siteId'], perm: 'sites.deploy', emits: ['site.preview_removed'], tool: 'sites' }),
    outward('sites.promote', 'Promote a staging build to production (merges the pull request first when there is one)', { in: { siteId: id.site, deploymentId: t.id('dpl') }, out: { deployment: dep }, on: ['site', '/siteId'], perm: 'sites.promote', level: 'manage', gate: 'site_promote', run: { kind: 'deployment', stoppable: false }, emits: ['site.promoted'], tool: 'sites', team: true, errors: ['validation.precondition_failed'] }),
    outward('sites.rollback', 'Roll production back to an earlier build', { in: { siteId: id.site, toDeploymentId: t.opt(t.id('dpl')) }, out: { deployment: dep }, on: ['site', '/siteId'], perm: 'sites.promote', level: 'manage', gate: { act: 'none', reason: 'restores a build that was already approved at promote time' }, emits: ['site.rolled_back'], tool: 'sites', team: true }),
    create('sites.table_create', 'Create a site table (a site-scoped record type); no schema permission needed for people who can edit the site', { in: { siteId: id.site, key: t.str(), fields: t.arr(t.obj({ key: t.str(), type: t.str(), title: t.str() })) }, out: { type: t.str() }, on: ['site', '/siteId'], emits: ['site.table_created'], tool: 'sites', level: 'edit' }),
    read('sites.tables', 'List site tables of a site', { in: deployTarget, out: { tables: t.arr(t.obj({ type: t.str(), rows: t.int() })) }, on: ['site', '/siteId'], tool: 'sites' }),
    write('sites.table_promote', 'Promote a site table to a Space record type', { in: { siteId: id.site, type: t.str() }, out: { type: t.str() }, on: ['site', '/siteId'], perm: 'schema.manage', level: 'manage', emits: ['site.table_promoted'], tool: 'sites', audit: 'always' }),
    write('sites.env_set', 'Set environment names for deployments; values come from Vault by key name with inject into deployments', { in: { siteId: id.site, entries: t.arr(t.obj({ name: t.str(), vaultHandle: id.handle })) }, out: { ok: t.bool() }, on: ['site', '/siteId'], perm: 'sites.deploy', tool: 'sites', audit: 'sensitive', errors: ['permission.no_grant'] }),
    read('sites.env_list', 'List environment names (never values)', { in: deployTarget, out: { entries: t.arr(t.obj({ name: t.str(), vaultName: t.str(), injected: t.bool() })) }, on: ['site', '/siteId'], tool: 'sites' }),
    read('sites.domains_get', 'Site domains with the DNS check and the Caddy certificate state', { in: deployTarget, out: { domains: t.arr(t.obj({ domain: t.str(), dnsOk: t.bool(), certificate: t.enm('pending', 'issued', 'failed') })) }, on: ['site', '/siteId'], tool: 'sites' }),
    write('sites.domain_set', 'Add or remove a site domain', { in: { siteId: id.site, domain: t.str(), remove: t.opt(t.bool()) }, out: { dnsOk: t.bool() }, on: ['site', '/siteId'], perm: 'sites.domains', emits: ['site.domain_changed'], tool: 'sites', team: true }),
    write('sites.staging_password_set', 'Choose the sealed Vault key that protects staging (shared across a site previews)', { in: { siteId: id.site, vaultHandle: id.handle }, out: { ok: t.bool() }, on: ['site', '/siteId'], perm: 'sites.deploy', tool: 'sites' }),
    read('sites.service_identity', 'The site service identity and its grants (capped by the owner)', { in: deployTarget, out: { principal: t.str(), grants: t.arr(t.obj({ resource: t.str(), level: t.str() })) }, on: ['site', '/siteId'], tool: 'sites' }),
    read('sites.logs', 'Container logs of a deployment (ids and text from the site, not Vyre content)', { in: { siteId: id.site, deploymentId: t.opt(t.id('dpl')), tail: t.opt(t.int()) }, out: { lines: t.arr(t.str()) }, on: ['site', '/siteId'], perm: 'sites.deploy', tool: 'sites' }),
  ],
  screens: [
    screen('apps.sites', 'apps', 'ui:SitesList', { q: { sites: ['sites.list', { section: '/section', folderId: '/folder' }], previews: ['sites.previews', { siteId: '/selected' }] }, a: { create: ['sites.create'], promote: ['sites.promote', { siteId: '/selected', deploymentId: '/deployment' }, 'Promote to production?'] }, empty: 'No sites yet', primary: 'New site', needs: ['sites.deploy'] }),
    screen('apps.site-editor', 'apps', 'ui:SiteEditor', { slot: 'main', q: { site: ['sites.get', { siteId: '/selected' }], deployments: ['sites.deployments', { siteId: '/selected' }] }, a: { build: ['sites.build', { siteId: '/selected' }], deploy: ['sites.deploy', { siteId: '/selected' }] }, ask: { suggestions: { view: ['Explain this site'], edit: ['Change the hero text', 'Add a contact form'], manage: ['Promote to production'] } } }),
    screen('apps.site-settings', 'apps', 'ui:SiteSettings', { q: { domains: ['sites.domains_get', { siteId: '/selected' }], env: ['sites.env_list', { siteId: '/selected' }] }, a: { setDomain: ['sites.domain_set', { siteId: '/selected' }], setEnv: ['sites.env_set', { siteId: '/selected' }] } }),
  ],
});
