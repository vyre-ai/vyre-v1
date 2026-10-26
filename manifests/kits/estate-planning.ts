// estate-planning Kit (lane L8): industry Kit for estate-planning firms (clients, matters, document templates).
import { defineManifest, field, rtype, screen } from '../../packages/contracts/src/index.ts';

export default defineManifest({
  id: 'estate-planning',
  title: 'Estate planning',
  kind: 'kit',
  owner: 'L8',
  recordTypes: [
    rtype('client_plan', 'Client plan', 'Client plans', 'scroll', [
      field('client', 'text', 'Client', { required: true }),
      field('stage', 'status', 'Stage', { options: { stages: [{ key: 'intake', title: 'Intake' }, { key: 'drafting', title: 'Drafting' }, { key: 'review', title: 'Review' }, { key: 'signing', title: 'Signing' }, { key: 'funding', title: 'Funding' }, { key: 'complete', title: 'Complete' }] } }),
      field('trust_name', 'text', 'Trust name'),
      field('tax_id', 'sealed', 'Tax ID', { label: 'restricted' }),
      field('signed', 'files', 'Signed documents'),
    ], { statusField: 'stage', group: 'Planning', label: 'confidential' }),
  ],
  screens: [screen('estate-planning.plans', 'records', 'ui:KitPlans', { empty: 'No client plans yet', primary: 'New client plan' })],
  fixtures: { seed: 'fixtures/seed.ts', golden: [] },
});
