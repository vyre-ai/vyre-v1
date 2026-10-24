// harbor-studio Kit (lane L8): fixture Kit for the third seeded Space (team, different Kit, skin and agents).
import { defineManifest, field, rtype, screen } from '../../packages/contracts/src/index.ts';

export default defineManifest({
  id: 'harbor-studio',
  title: 'Harbor Studio',
  kind: 'kit',
  owner: 'L8',
  recordTypes: [
    rtype('commission', 'Commission', 'Commissions', 'palette', [
      field('title', 'text', 'Title', { required: true }),
      field('client', 'text', 'Client'),
      field('status', 'status', 'Status'),
      field('due', 'datetime', 'Due'),
    ], { statusField: 'status', group: 'Studio' }),
  ],
  screens: [screen('harbor-studio.board', 'records', 'ui:KitBoard', { empty: 'No commissions yet', primary: 'New commission' })],
  fixtures: { seed: 'fixtures/seed.ts', golden: [] },
});
