// notes (lane L2, wip/l-notes): a person's notes, like Google Keep. A grid of cards, a quick "Take a note", paste text, an image or a link (the link becomes a card with title,
// image and site name), pages clipped from Vyre for Chrome (screenshot, URL, selected text), pin, colour and labels. Private by default; shareable with a person or the Space.
// DECISION: a note is not an access-layer resource. Every capability binds to the Space at level member, and the module decides who reads a note from its own row: the owner, the
// people it is shared with, or everyone when it is shared with the Space. Nothing about a private note leaves the module: events carry ids only and go to the owner (vis owner).
// DECISION: agents read notes through notes.search and notes.get only, and only when everyone who reads the chat may read the note (lib/audience.ts: a private note reads in its owner's
// own chats, never in a channel; a shared note follows its share).
// DECISION: an image is a blob with no access-layer resource, so the blob route never serves it; notes.image hands the bytes to someone who may read the note.
// DECISION: a link is read through automations.read_link (the one public fetch path) and its page meta: title, image address and site name.
// DECISION: delete is a soft delete; notes.restore is Undo. to_task and to_record call tasks.create and records.create and keep the new id on the note, so the two link both ways.
import { create, defineManifest, ev, read, write, t } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut } from './_common.ts';

const M = { level: 'member' } as const;
const noteId = t.id('nte');
const color = t.enm('', 'rose', 'sand', 'sage', 'sky', 'lilac', 'slate');
const label = t.str({ minLength: 1, maxLength: 40, examples: ['Lab 8'] });
const role = t.enm('edit', 'view');
const spaceShare = t.enm('off', 'view', 'edit');
const imageIn = t.obj({ data: t.str({ description: 'The image bytes, base64', maxLength: 14_000_000 }), contentType: t.enm('image/png', 'image/jpeg', 'image/gif', 'image/webp') });
const linkOut = t.obj({ url: t.str(), title: t.opt(t.str()), siteName: t.opt(t.str()), image: t.opt(t.str({ description: 'The page image address, as the page names it' })), description: t.opt(t.str()) });
const clipOut = t.obj({ url: t.str(), title: t.opt(t.str()), selection: t.opt(t.str()), hasShot: t.bool(), at: t.ts() });
const linked = t.obj({ kind: t.enm('task', 'record'), id: t.str({ examples: ['tsk_a1b2c3'] }), title: t.str(), at: t.ts() });
const noteRow = t.obj({
  noteId, owner: id.user, title: t.str(), body: t.str(), color, pinned: t.bool(), labels: t.arr(label),
  hasImage: t.bool(), link: t.opt(linkOut), clip: t.opt(clipOut), linked: t.arr(linked),
  share: t.obj({ people: t.arr(t.obj({ personId: id.user, role })), space: spaceShare }),
  mine: t.bool(), canEdit: t.bool(), createdAt: t.ts(), updatedAt: t.ts(),
});
const hit = t.obj({ noteId, title: t.str(), snippet: t.str(), labels: t.arr(label), owner: id.user, updatedAt: t.ts() });
const target = { noteId };
const ids = { noteId, owner: id.user };

export default defineManifest({
  id: 'notes',
  title: 'Notes',
  owner: 'L2',

  events: [
    ev('notes.created', 'A note was made', { p: ids, subject: ['entity', '/noteId'], vis: 'owner' }),
    ev('notes.clipped', 'A page was clipped from Vyre for Chrome into a note', { p: ids, subject: ['entity', '/noteId'], vis: 'owner' }),
    ev('notes.updated', 'A note was changed: text, colour, pin, labels, image or link', { p: { ...ids, by: t.str({ examples: ['usr_a1b2c3'] }) }, subject: ['entity', '/noteId'], vis: 'owner' }),
    ev('notes.shared', 'Who reads a note changed', { p: { ...ids, people: t.arr(id.user), space: spaceShare }, subject: ['entity', '/noteId'], vis: 'owner' }),
    ev('notes.deleted', 'A note was deleted; it can come back with Undo', { p: ids, subject: ['entity', '/noteId'], vis: 'owner' }),
    ev('notes.restored', 'A deleted note came back (Undo)', { p: ids, subject: ['entity', '/noteId'], vis: 'owner' }),
    ev('notes.linked', 'A task or record was made from a note', { p: { ...ids, kind: t.enm('task', 'record'), id: t.str({ examples: ['tsk_a1b2c3'] }) }, subject: ['entity', '/noteId'], vis: 'owner' }),
  ],

  capabilities: [
    create('notes.create', 'Take a note: text, an image, or a link that becomes a card. Private to the person until shared', {
      ...M, in: { title: t.opt(t.str({ maxLength: 500 })), body: t.opt(t.str({ maxLength: 100_000 })), color: t.opt(color), pinned: t.opt(t.bool()), labels: t.opt(t.arr(label)), image: t.opt(imageIn), link: t.opt(t.str({ maxLength: 2000 })) },
      out: { note: noteRow }, emits: ['notes.created'], offline: 'queue', agent: { planMode: 'blocked' }, errors: ['validation.precondition_failed'],
    }),
    read('notes.get', 'Read one note the asker may read. An agent reads a note only when everyone in its chat may read it', {
      ...M, in: target, out: { note: noteRow }, tool: 'memory', mcpName: 'notes_get', agent: { planMode: 'allowed' }, errors: ['validation.not_found'],
    }),
    read('notes.list', 'The notes the person reads: their own and those shared with them. Pinned first, newest first, with the labels in use', {
      ...M, in: { label: t.opt(label), q: t.opt(t.str()), from: t.opt(t.enm('all', 'mine', 'shared')), ...pageIn },
      out: { notes: t.arr(noteRow), labels: t.arr(t.obj({ name: label, count: t.int({ minimum: 0 }) })), ...pageOut },
    }),
    read('notes.search', 'Search the notes the asker may read: title, text, labels, link and clipped page. An agent finds only notes everyone in its chat may read', {
      ...M, in: { q: t.str({ minLength: 1 }), limit: t.opt(t.int({ minimum: 1, maximum: 50 })) }, out: { notes: t.arr(hit) }, tool: 'memory', mcpName: 'notes_search', agent: { planMode: 'allowed' },
    }),
    read('notes.image', 'The image of a note, for someone who may read it', {
      ...M, in: target, out: { contentType: t.str(), data: t.str({ description: 'base64' }) }, errors: ['validation.not_found'],
    }),
    write('notes.update', 'Change a note: title, text, colour, image or link (null removes the image or link)', {
      ...M, in: { ...target, title: t.opt(t.str({ maxLength: 500 })), body: t.opt(t.str({ maxLength: 100_000 })), color: t.opt(color), image: t.opt(t.nullable(imageIn)), link: t.opt(t.nullable(t.str({ maxLength: 2000 }))) },
      out: { note: noteRow }, emits: ['notes.updated'], offline: 'patch', agent: { planMode: 'blocked' }, errors: ['validation.not_found'],
    }),
    write('notes.pin', 'Pin or unpin a note', { ...M, in: { ...target, pinned: t.bool() }, out: { note: noteRow }, emits: ['notes.updated'], offline: 'patch', errors: ['validation.not_found'] }),
    write('notes.label', 'Add or remove labels on a note', {
      ...M, in: { ...target, add: t.opt(t.arr(label)), remove: t.opt(t.arr(label)) }, out: { note: noteRow }, emits: ['notes.updated'], offline: 'patch', errors: ['validation.not_found'],
    }),
    write('notes.share', 'Share a note with people or the Space, change a role, or take it back. Only the owner shares', {
      ...M, in: { ...target, people: t.opt(t.arr(t.obj({ personId: id.user, role: t.enm('edit', 'view', 'remove') }))), space: t.opt(spaceShare) },
      out: { note: noteRow }, emits: ['notes.shared'], audit: 'sensitive', offline: 'online', agent: false, errors: ['validation.not_found', 'permission.no_grant'],
    }),
    write('notes.delete', 'Delete a note. It can come back with notes.restore (Undo). Someone it was shared with only removes it from their own notes', {
      ...M, in: target, out: { deleted: t.bool(), undo: t.obj({ noteId }) }, emits: ['notes.deleted'], offline: 'patch', agent: false, errors: ['validation.not_found'],
    }),
    write('notes.restore', 'Undo a delete', { ...M, in: target, out: { note: noteRow }, emits: ['notes.restored'], offline: 'patch', agent: false, errors: ['validation.not_found'] }),
    write('notes.to_task', 'Turn a note into a task. The task holds the note text; the note keeps the task, so each opens the other', {
      ...M, idem: 'key', in: { ...target, title: t.opt(t.str({ minLength: 1 })), assigned: t.opt(t.obj({ kind: t.enm('person', 'agent'), id: t.str({ examples: ['usr_a1b2c3'] }) })), due: t.opt(t.ts()), keep: t.opt(t.bool()) },
      out: { note: noteRow, taskId: id.task }, emits: ['notes.linked'], offline: 'online', agent: false, errors: ['validation.not_found'],
    }),
    write('notes.to_record', 'Turn a note into a record of a type, with fields filled from it. The note keeps the record, so each opens the other', {
      ...M, idem: 'key', in: { ...target, type: id.recordType, fields: t.rec(), keep: t.opt(t.bool()) },
      out: { note: noteRow, recordId: id.record }, emits: ['notes.linked'], offline: 'online', agent: false, errors: ['validation.not_found'],
    }),
    create('notes.clip', 'Vyre for Chrome: clip a page into a private note with its address, title, the selected text and a screenshot', {
      ...M, in: { url: t.str({ minLength: 1, maxLength: 2000 }), title: t.opt(t.str({ maxLength: 500 })), selection: t.opt(t.str({ maxLength: 20_000 })), note: t.opt(t.str({ maxLength: 20_000 })), screenshot: t.opt(imageIn), labels: t.opt(t.arr(label)) },
      out: { note: noteRow }, emits: ['notes.clipped'], offline: 'online', agent: false,
    }),
  ],
});
