// templates (lane L8): single items in Kit format, the gallery and install (spec 2.21, 3.6).
import { create, defineManifest, ev, read, screen, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut } from './_common.ts';

const templateId = t.id('tpl');
const kindEnum = t.enm('agent', 'automation', 'journey', 'record_type', 'runbook', 'project', 'site', 'form', 'portal');
const row = t.obj({ templateId, title: t.str(), kind: kindEnum, summary: t.str(), version: t.str(), adds: t.arr(t.str()) });

export default defineManifest({
  id: 'templates',
  title: 'Templates',
  owner: 'L8',
  events: [
    ev('template.installed', 'A template was installed', { p: { templateId, kind: t.str() }, subject: ['entity', '/templateId'] }),
    ev('template.saved', 'An item was saved as a template in Kit format', { p: { templateId, kind: t.str() }, subject: ['entity', '/templateId'] }),
  ],
  capabilities: [
    read('templates.list', 'Gallery of template packages', { in: { kind: t.opt(kindEnum), ...pageIn }, out: { templates: t.arr(row), ...pageOut }, tool: 'sites' }),
    read('templates.preview', 'Preview what a template adds before installing', { in: { templateId }, out: { template: row, record_types: t.arr(t.str()), domains: t.arr(t.str()), vaultNames: t.arr(t.str()) }, tool: 'sites' }),
    write('templates.install', 'Install a template (install sheet shown first)', { in: { templateId, into: t.opt(id.folder) }, out: { installed: t.arr(t.obj({ kind: t.str(), id: t.str() })) }, perm: 'kits.install', risk: 'high', audit: 'always', emits: ['template.installed'], tool: 'sites' }),
    create('templates.save', 'Save an agent, Automation, Journey, record type, runbook or project as a template', { in: { kind: kindEnum, ref: t.str(), title: t.str() }, out: { template: row }, perm: 'kits.publish', emits: ['template.saved'], tool: 'sites' }),
    read('templates.project_starters', 'Starters for New project and New Journey type, an empty one first', { in: { kind: t.enm('project', 'journey') }, out: { starters: t.arr(row) }, tool: 'sites' }),
  ],
  screens: [
    screen('apps.templates', 'apps', 'ui:TemplatesGallery', { q: { templates: ['templates.list', { kind: '/kind' }], preview: ['templates.preview', { templateId: '/selected' }] }, a: { install: ['templates.install', { templateId: '/selected' }] }, empty: 'No templates yet', needs: ['kits.install'] }),
  ],
});
