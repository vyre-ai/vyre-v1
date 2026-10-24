// previews (lane L4): thumbnails, page images and extracted text for files (spec 2.16 Viewer and markup; architecture 7.5, golden 6).
// Image files show thumbnails at a good size in the grid and open in the same viewer. PDF and Office files become page images and text for the viewer, search, agents and memory.
// Previews are made after a file version lands (consumer of file.version_added), cached by blob hash, and never block a save.
// DECISION: no OCR in v1; a scan with no text layer returns empty text and source 'none' so the caller can say so plainly.
// DECISION: previews.render has no tool: regeneration is automatic, and a person asks for it only by re-saving the file.
import { defineManifest, ev, health, read, screen, t, write } from '../packages/contracts/src/index.ts';
import { id } from './_common.ts';

const size = t.enm('s', 'm', 'l', 'xl');
const thumb = t.obj({ fileId: id.file, ready: t.bool(), url: t.opt(t.str()), width: t.opt(t.int()), height: t.opt(t.int()) });

export default defineManifest({
  id: 'previews',
  title: 'Previews',
  owner: 'L4',
  events: [
    ev('preview.ready', 'Thumbnails, page images or text were made for a file version', {
      p: { fileId: id.file, versionId: id.version, kinds: t.arr(t.enm('thumbnail', 'pages', 'text')), pages: t.opt(t.int()) }, subject: ['file', '/fileId'], label: 'subject',
    }),
    ev('preview.failed', 'A preview could not be made; the file still opens as a download', {
      p: { fileId: id.file, versionId: id.version, reason: t.enm('unsupported', 'too_large', 'corrupt', 'converter_down', 'timeout') }, subject: ['file', '/fileId'], label: 'subject',
    }),
  ],
  capabilities: [
    read('previews.get', 'Get the preview of one file version at a size, or one page of it', {
      in: { fileId: id.file, versionId: t.opt(id.version), size: t.opt(size), page: t.opt(t.int({ minimum: 1 })) },
      out: { ready: t.bool(), url: t.opt(t.str()), width: t.opt(t.int()), height: t.opt(t.int()), pages: t.opt(t.int()), reason: t.opt(t.str()) },
      on: ['file', '/fileId'], tool: 'files', label: 'check',
    }),
    read('previews.thumbnails', 'Thumbnails for a grid of files in one call', {
      in: { fileIds: t.arr(id.file, { minItems: 1, maxItems: 200 }), size: t.opt(size) }, out: { items: t.arr(thumb) }, tool: 'files', label: 'filter',
    }),
    read('previews.pages', 'Page images of a PDF or Office file', {
      in: { fileId: id.file, versionId: t.opt(id.version), from: t.opt(t.int({ minimum: 1 })), count: t.opt(t.int({ minimum: 1, maximum: 50 })), size: t.opt(size) },
      out: { total: t.int(), pages: t.arr(t.obj({ n: t.int(), url: t.str(), width: t.int(), height: t.int() })) }, on: ['file', '/fileId'], tool: 'files', label: 'check',
    }),
    read('previews.text', 'Extracted text of a PDF, Office, image-free or plain file, for the viewer, search and agents', {
      in: { fileId: id.file, versionId: t.opt(id.version), page: t.opt(t.int({ minimum: 1 })) },
      out: { text: t.str(), pages: t.opt(t.int()), truncated: t.bool(), source: t.enm('native', 'pdf', 'office', 'none') }, on: ['file', '/fileId'], tool: 'files', label: 'check',
    }),
    write('previews.render', 'Make or remake the preview of a file version (system; also run by the consumer after every new version)', {
      in: { fileId: id.file, versionId: t.opt(id.version), force: t.opt(t.bool()) }, out: { queued: t.bool() },
      on: ['file', '/fileId'], level: 'use', emits: ['preview.ready', 'preview.failed'],
    }),
    read('previews.health', 'The converter answers on a tiny sample file and the queue is short', {
      out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()), queued: t.opt(t.int()) },
    }),
  ],
  health: [
    health('previews.converter', 'Previews and text extraction', 'previews.health', 'Restart the preview service in the Console. Files stay available as downloads meanwhile.'),
  ],
  screens: [
    screen('files.thumbnails', 'files', 'ui:ThumbGrid', {
      q: { thumbs: ['previews.thumbnails', { fileIds: '/state/fileIds', size: '/state/size' }] }, empty: 'No images here',
    }),
  ],
});
