// email-builder-api (lane L8): server half of the one email builder used by Campaigns, Inbox templates and Automation email steps (spec 3.6).
import { create, defineManifest, ev, outward, read, t, write } from '../packages/contracts/src/index.ts';
import { id } from './_common.ts';

const emailId = t.id('eml');
const blockSchema = t.obj({ type: t.enm('text', 'image', 'button', 'columns', 'divider', 'merge', 'html'), props: t.rec() });
const doc = t.obj({ emailId, name: t.str(), mode: t.enm('blocks', 'html', 'plain'), blocks: t.opt(t.arr(blockSchema)), html: t.opt(t.str()), plain: t.opt(t.str()), subject: t.opt(t.str()) });
const target = { emailId };
const snippetId = t.id('snp');
const snippetRow = t.obj({ snippetId, name: t.str(), body: t.str(), shortcut: t.opt(t.str()), shared: t.bool(), updatedAt: t.ts() });

export default defineManifest({
  id: 'email-builder-api',
  title: 'Email builder',
  owner: 'L8',
  status: 'live',
  events: [
    ev('email_template.saved', 'An email design was saved as a version', { p: { emailId, version: t.int() }, subject: ['entity', '/emailId'] }),
    ev('email_template.test_sent', 'A test email was sent to the author', { p: { emailId }, subject: ['entity', '/emailId'], replay: 'stub' }),
  ],
  capabilities: [
    create('email_builder.create', 'Create an email design', { in: { name: t.str(), mode: t.enm('blocks', 'html', 'plain') }, out: { email: doc }, make: ['folder', '/name'], tool: 'inbox' }),
    read('email_builder.get', 'Read an email design', { in: target, out: { email: doc }, tool: 'inbox' }),
    read('email_builder.list', 'List email designs (campaigns, inbox templates, automation steps share them)', { out: { emails: t.arr(t.obj({ emailId, name: t.str(), updatedAt: t.ts() })) }, tool: 'inbox' }),
    write('email_builder.save', 'Autosave a design; each save is a version', { in: { emailId, email: doc }, out: { version: t.int() }, emits: ['email_template.saved'], tool: 'inbox', offline: 'queue' }),
    read('email_builder.versions', 'List saved versions', { in: target, out: { versions: t.arr(t.obj({ version: t.int(), at: t.ts(), by: t.str() })) }, tool: 'inbox' }),
    write('email_builder.restore_version', 'Restore a version', { in: { emailId, version: t.int() }, out: { email: doc }, tool: 'inbox' }),
    read('email_builder.render', 'Render desktop, mobile, dark and plain-text previews, optionally as a record', { in: { emailId, asRecordId: t.opt(id.record), variant: t.enm('desktop', 'mobile', 'dark', 'plain') }, out: { html: t.str(), warnings: t.arr(t.str()) }, tool: 'inbox' }),
    write('email_builder.html_set', 'Set full HTML (an agent can write it and place it)', { in: { emailId, html: t.str() }, out: { ok: t.bool() }, tool: 'inbox' }),
    read('email_builder.ask_diff', 'Ask Vyre edit: returns a per-change diff the author accepts change by change', { in: { emailId, instruction: t.str(), agentId: t.opt(id.agent) }, out: { changes: t.arr(t.obj({ path: t.str(), before: t.json(), after: t.json() })) }, tool: 'inbox' }),
    outward('email_builder.send_test', 'Send a test email to the author', { in: { emailId, to: t.str() }, out: { sent: t.bool() }, gate: { act: 'none', reason: 'sends only to the author own address; humans skip the Gate' }, emits: ['email_template.test_sent'], tool: 'inbox' }),
    read('email_builder.merge_fields', 'Merge fields available for a record type', { in: { type: id.recordType }, out: { fields: t.arr(t.obj({ key: t.str(), title: t.str() })) }, tool: 'inbox' }),
    read('email_builder.snippets.list', 'List composer snippets: short reusable text for Inbox email and text replies, mine and shared with the Space', { out: { snippets: t.arr(snippetRow) }, tool: 'inbox' }),
    write('email_builder.snippets.save', 'Create or change a composer snippet', { in: { snippetId: t.opt(snippetId), name: t.str(), body: t.str(), shortcut: t.opt(t.str()), shared: t.opt(t.bool()) }, out: { snippet: snippetRow }, tool: 'inbox', offline: 'queue' }),
    write('email_builder.snippets.delete', 'Delete a composer snippet', { in: { snippetId }, out: { deleted: t.bool() }, tool: 'inbox' }),
  ],
});
