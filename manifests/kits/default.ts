// default Kit (lane L8): the Kit every new Space starts with; Everyone group defaults and the standard rail.
import { defineManifest, field, rtype, screen, setting, t } from '../../packages/contracts/src/index.ts';

export default defineManifest({
  id: 'default',
  title: 'Default Kit',
  kind: 'kit',
  owner: 'L8',
  settings: [setting('kit.default.rail', 'space', 'kit', 'Rail order', t.arr(t.str()), ['home', 'chats', 'inbox', 'records', 'files', 'apps', 'automations', 'vault', 'settings'])],
  recordTypes: [rtype('note_board', 'Note board', 'Note boards', 'note', [field('title', 'text', 'Title', { required: true }), field('body', 'longtext', 'Body')], { group: 'Notes' })],
  screens: [screen('default.home-welcome', 'home', 'ui:HomeWelcome', { empty: 'Welcome. Start with your assistant.', primary: 'Meet your assistant' })],
  fixtures: { seed: 'fixtures/seed.ts', golden: [] },
});
