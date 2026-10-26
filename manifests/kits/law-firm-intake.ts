// law-firm-intake Kit (lane L8): industry Kit that installs lead-to-client structure in one click.
import { defineManifest, field, rtype, screen, t, setting } from '../../packages/contracts/src/index.ts';

export default defineManifest({
  id: 'law-firm-intake',
  title: 'Law firm intake',
  kind: 'kit',
  owner: 'L8',
  settings: [setting('kit.intake.consult_minutes', 'space', 'kit', 'Consultation length in minutes', t.int({ minimum: 5 }), 30)],
  recordTypes: [
    rtype('lead', 'Lead', 'Leads', 'user-plus', [
      field('name', 'text', 'Name', { required: true }),
      field('email', 'email', 'Email'), field('phone', 'phone', 'Phone'),
      field('stage', 'status', 'Stage', { options: { stages: [{ key: 'new', title: 'New' }, { key: 'consult', title: 'Consult' }, { key: 'retained', title: 'Retained' }, { key: 'lost', title: 'Lost' }] } }),
      field('practice_area', 'choice', 'Practice area'),
      field('owner', 'person', 'Owner'),
    ], { statusField: 'stage', ownerField: 'owner', attribution: true, group: 'Intake', label: 'confidential' }),
    rtype('matter', 'Matter', 'Matters', 'briefcase', [
      field('title', 'text', 'Title', { required: true }),
      field('status', 'status', 'Status'), field('lead', 'person', 'Lead attorney'),
      field('opened', 'datetime', 'Opened'), field('fee', 'money', 'Fee'),
    ], { statusField: 'status', ownerField: 'lead', group: 'Intake', label: 'confidential' }),
  ],
  screens: [screen('law-firm-intake.pipeline', 'records', 'ui:KitPipeline', { empty: 'No leads yet', primary: 'New lead' })],
  fixtures: { seed: 'fixtures/seed.ts', golden: [] },
});
