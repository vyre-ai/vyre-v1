// kits (lane L8): the one installable package format, install sheet, preview, rollback, publish with tests (spec 2.21, ARCH 7.6, 10.4).
import { create, defineManifest, ev, read, screen, setting, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut } from './_common.ts';

const channel = t.enm('stable', 'beta');
const kitRow = t.obj({ kitId: id.kit, key: t.str(), title: t.str(), version: t.str(), channel, installed: t.bool(), contents: t.arr(t.enm('ui', 'structure', 'steps', 'tools')) });
// A step of a Kit the sheet check found broken before Install: which item and step, the capability it calls, the input it would send, and why it would fail.
const problem = t.obj({ item: t.str(), step: t.enm('apply', 'undo'), cap: t.str(), input: t.rec(), message: t.str() });
const sheet = t.obj({ tools: t.arr(t.str()), recordTypes: t.arr(t.str()), networkDomains: t.arr(t.str()), vaultNames: t.arr(t.str()), scripts: t.int(), problems: t.arr(problem) });
const target = { kitId: id.kit };

export default defineManifest({
  id: 'kits',
  title: 'Kits',
  owner: 'L8',
  events: [
    ev('kit.installed', 'A Kit was installed', { p: { kitId: id.kit, version: t.str() }, subject: ['kit', '/kitId'] }),
    ev('kit.updated', 'A Kit was updated', { p: { kitId: id.kit, from: t.str(), to: t.str() }, subject: ['kit', '/kitId'] }),
    ev('kit.rolled_back', 'A Kit was rolled back in one click', { p: { kitId: id.kit, to: t.str() }, subject: ['kit', '/kitId'] }),
    ev('kit.published', 'A Kit version passed its tests on the seeded fixture Space and went live', { p: { kitId: id.kit, version: t.str() }, subject: ['kit', '/kitId'] }),
    ev('kit.publish_blocked', 'A Kit publish failed its tests; the last good version stays live', { p: { kitId: id.kit, version: t.str(), failures: t.int() }, subject: ['kit', '/kitId'] }),
    ev('sandbox.denied', 'A Kit script or connector call was denied in the sandbox', { p: { kitId: id.kit, what: t.str(), traceId: id.trace }, subject: ['kit', '/kitId'], notify: 'health.degraded' }),
  ],
  settings: [
    setting('kit.choice', 'space', 'kit', 'Kit for this Space', t.obj({ kitId: t.opt(id.kit) }), {}),
    setting('kit.choice_person', 'person', 'kit', 'My Kit in this Space', t.obj({ kitId: t.opt(id.kit) }), {}),
  ],
  capabilities: [
    read('kits.list', 'List Kits with channel and install state', { in: pageIn, out: { kits: t.arr(kitRow), ...pageOut }, tool: 'sites' }),
    read('kits.get', 'Read one Kit', { in: target, out: { kit: kitRow }, on: ['kit', '/kitId'], tool: 'sites' }),
    read('kits.install_sheet', 'The install sheet: tools, record types, network domains, vault names, scripts, and the steps the sheet check found broken', { in: target, out: { sheet }, on: ['kit', '/kitId'], tool: 'sites' }),
    read('kits.preview', 'Preview a Kit before applying it', { in: target, out: { changes: t.arr(t.obj({ kind: t.str(), title: t.str() })) }, on: ['kit', '/kitId'], tool: 'sites' }),
    write('kits.install', 'Install a Kit after the sheet is confirmed', { in: { kitId: id.kit, accepted: t.lit(true) }, out: { kit: kitRow }, on: ['kit', '/kitId'], perm: 'kits.install', level: 'manage', risk: 'high', audit: 'always', emits: ['kit.installed'], tool: 'sites' }),
    write('kits.update', 'Update a Kit to a newer version of its channel', { in: { kitId: id.kit, version: t.opt(t.str()) }, out: { kit: kitRow }, on: ['kit', '/kitId'], perm: 'kits.install', level: 'manage', risk: 'high', audit: 'always', emits: ['kit.updated'], tool: 'sites' }),
    write('kits.rollback', 'Roll a Kit back one click', { in: { kitId: id.kit, toVersion: t.opt(t.str()) }, out: { kit: kitRow }, on: ['kit', '/kitId'], perm: 'kits.install', level: 'manage', audit: 'always', emits: ['kit.rolled_back'], tool: 'sites' }),
    write('kits.choose', 'Choose the Kit for the Space or for yourself', { in: { kitId: id.kit, scope: t.enm('space', 'person') }, out: { ok: t.bool() }, tool: 'sites' }),
    write('kits.test_run', 'Run the Kit tests against the seeded fixture Space', { in: target, out: { passed: t.bool(), failures: t.arr(t.obj({ test: t.str(), message: t.str() })) }, on: ['kit', '/kitId'], perm: 'kits.publish', tool: 'sites' }),
    write('kits.publish', 'Publish a Kit version; blocked on test failure, last good stays live', { in: { kitId: id.kit, version: t.str(), channel }, out: { published: t.bool() }, on: ['kit', '/kitId'], perm: 'kits.publish', level: 'manage', risk: 'high', audit: 'always', emits: ['kit.published', 'kit.publish_blocked'], tool: 'sites' }),
    read('kits.versions', 'List Kit versions (One History)', { in: target, out: { versions: t.arr(t.obj({ versionId: id.version, version: t.str(), at: t.ts(), by: t.str(), channel })) }, on: ['kit', '/kitId'], tool: 'sites' }),
    write('kits.restore_version', 'Restore an earlier Kit version', { in: { kitId: id.kit, versionId: id.version }, out: { kit: kitRow }, on: ['kit', '/kitId'], perm: 'kits.publish', tool: 'sites' }),
    read('kits.health', 'Kit health and debug panel: denials, failing tests, last run', { in: target, out: { state: t.enm('healthy', 'degraded', 'down'), denials: t.int(), lastTestAt: t.opt(t.ts()) }, on: ['kit', '/kitId'], tool: 'sites' }),
    read('kits.denials', 'Sandbox denials with trace ids', { in: { kitId: id.kit, ...pageIn }, out: { denials: t.arr(t.obj({ at: t.ts(), what: t.str(), traceId: id.trace })), ...pageOut }, on: ['kit', '/kitId'], tool: 'sites' }),
    create('kits.builder_open', 'Open the Kit builder chat with an agent (preview before publish)', { in: { kitId: t.opt(id.kit), brief: t.opt(t.str()) }, out: { threadId: id.thread }, make: ['kit', '/brief'], perm: 'kits.publish', tool: 'sites' }),
  ],
  screens: [
    screen('settings.kit-choice', 'settings', 'ui:KitChoice', { q: { kits: ['kits.list'] }, a: { choose: ['kits.choose', { kitId: '/selected', scope: '/scope' }] } }),
    screen('apps.kit-builder', 'apps', 'ui:KitBuilder', { q: { sheet: ['kits.install_sheet', { kitId: '/selected' }], health: ['kits.health', { kitId: '/selected' }] }, a: { publish: ['kits.publish', { kitId: '/selected' }, 'Publish this Kit?'], test: ['kits.test_run', { kitId: '/selected' }] }, needs: ['kits.publish'] }),
  ],
});
