// campaigns (lane L8): one-time, sequence and triggered outreach on the Journey-style run engine, plus warmup (spec 2.19, 3.6, 8.2). May land after the window.
import { create, defineManifest, ev, list, outward, read, screen, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut } from './_common.ts';

const kind = t.enm('one_time', 'sequence', 'triggered');
const state = t.enm('draft', 'scheduled', 'running', 'paused', 'stopped', 'completed');
const stepSchema = t.obj({ key: t.str(), type: t.enm('email', 'wait', 'branch', 'sms', 'task', 'call_task'), config: t.rec(), next: t.opt(t.arr(t.str())) });
const row = t.obj({ campaignId: id.campaign, name: t.str(), kind, state, owner: id.user, audienceCount: t.int(), sent: t.int(), replies: t.int() });
const target = { campaignId: id.campaign };

export default defineManifest({
  id: 'campaigns',
  title: 'Campaigns',
  owner: 'L8',
  events: [
    ev('campaign.launched', 'A campaign was launched after approval', { p: { campaignId: id.campaign, audienceCount: t.int() }, subject: ['campaign', '/campaignId'], trigger: { title: 'A campaign is launched' }, replay: 'stub' }),
    ev('campaign.replied', 'A contact replied to a campaign', { p: { campaignId: id.campaign, recordId: id.record, messageId: t.id('eml') }, subject: ['campaign', '/campaignId'], trigger: { title: 'A campaign gets a reply', fields: ['/campaignId'] }, notify: 'campaign.reply' }),
    ev('campaign.unsubscribed', 'A contact unsubscribed', { p: { campaignId: id.campaign, recordId: id.record }, subject: ['campaign', '/campaignId'] }),
    ev('campaign.paused', 'A campaign paused', { p: { campaignId: id.campaign, reason: t.str() }, subject: ['campaign', '/campaignId'] }),
    ev('campaign.completed', 'A campaign finished', { p: { campaignId: id.campaign }, subject: ['campaign', '/campaignId'] }),
    ev('warmup.slowed', 'Warmup slowed a mailbox after bounces, spam placement or low replies', { p: { mailboxId: id.mailbox, reason: t.str() }, subject: ['mailbox', '/mailboxId'] }),
  ],
  lists: [list('campaign', 'Campaign', 'Campaigns', 'campaigns.list')],
  capabilities: [
    create('campaigns.create', 'Create a campaign (one-time, sequence or triggered)', { in: { name: t.str(), kind }, out: { campaign: row }, make: ['campaign', '/name'], perm: 'automations.space', tool: 'automations', team: true }),
    read('campaigns.get', 'Read a campaign with steps, audience, windows, throttle and A/B variants', { in: target, out: { campaign: row, steps: t.arr(stepSchema), audienceViewId: t.opt(t.str()), windows: t.opt(t.json()), throttle: t.opt(t.json()), variants: t.opt(t.json()) }, on: ['campaign', '/campaignId'], tool: 'automations' }),
    read('campaigns.list', 'List campaigns by section and folder', { in: { section: t.opt(t.enm('personal', 'shared', 'space')), folderId: t.opt(id.folder), ...pageIn }, out: { campaigns: t.arr(row), ...pageOut }, tool: 'automations' }),
    write('campaigns.update', 'Rename or change settings', { in: { campaignId: id.campaign, name: t.opt(t.str()), settings: t.opt(t.rec()) }, out: { campaign: row }, on: ['campaign', '/campaignId'], perm: 'automations.space', tool: 'automations' }),
    write('campaigns.delete', 'Delete a draft campaign', { in: target, out: { deleted: t.bool() }, on: ['campaign', '/campaignId'], level: 'manage', perm: 'automations.space', gate: { act: 'delete', when: "actor.kind != 'person'" }, tool: 'automations' }),
    write('campaigns.audience_set', 'Set the audience from a record view; adds go through DND screening (adds only)', { in: { campaignId: id.campaign, type: id.recordType, viewId: t.opt(t.str()), filter: t.opt(t.json()) }, out: { count: t.int(), excluded: t.int() }, on: ['campaign', '/campaignId'], perm: 'automations.space', tool: 'automations' }),
    write('campaigns.steps_set', 'Replace the steps: email, wait, branch on reply/open/click, SMS, task, call task', { in: { campaignId: id.campaign, steps: t.arr(stepSchema) }, out: { ok: t.bool() }, on: ['campaign', '/campaignId'], perm: 'automations.space', tool: 'automations' }),
    write('campaigns.variants_set', 'Set A/B variants', { in: { campaignId: id.campaign, variants: t.arr(t.obj({ key: t.str(), weight: t.int(), stepKey: t.str(), config: t.rec() })) }, out: { ok: t.bool() }, on: ['campaign', '/campaignId'], perm: 'automations.space', tool: 'automations' }),
    write('campaigns.schedule_set', 'Set send windows per recipient time zone, throttling per sending domain and stop on reply', { in: { campaignId: id.campaign, windows: t.json(), throttlePerHour: t.opt(t.int()), stopOnReply: t.bool() }, out: { ok: t.bool() }, on: ['campaign', '/campaignId'], perm: 'automations.space', tool: 'automations' }),
    read('campaigns.preview', 'Launch preview: a sample message, counts and exclusions', { in: target, out: { sample: t.obj({ subject: t.opt(t.str()), body: t.str() }), counts: t.obj({ audience: t.int(), excluded: t.int(), suppressed: t.int() }) }, on: ['campaign', '/campaignId'], tool: 'automations' }),
    outward('campaigns.launch', 'Launch a campaign (Gate act for agents, automations and humans alike)', { in: target, out: { runId: id.run }, on: ['campaign', '/campaignId'], perm: 'campaigns.launch', level: 'manage', gate: 'campaign_launch', run: { kind: 'campaign', stoppable: true }, emits: ['campaign.launched'], tool: 'automations', team: true }),
    write('campaigns.pause', 'Pause a running campaign', { in: { campaignId: id.campaign, reason: t.opt(t.str()) }, out: { campaign: row }, on: ['campaign', '/campaignId'], perm: 'campaigns.launch', emits: ['campaign.paused'], tool: 'automations' }),
    write('campaigns.resume', 'Resume a paused campaign', { in: target, out: { campaign: row }, on: ['campaign', '/campaignId'], perm: 'campaigns.launch', tool: 'automations', team: true }),
    write('campaigns.stop', 'Stop a campaign for good', { in: target, out: { campaign: row }, on: ['campaign', '/campaignId'], perm: 'campaigns.launch', level: 'manage', tool: 'automations' }),
    read('campaigns.stats', 'Sent, delivered, bounced, complained, replied, unsubscribed', { in: target, out: { sent: t.int(), delivered: t.int(), bounced: t.int(), complained: t.int(), replied: t.int(), unsubscribed: t.int() }, on: ['campaign', '/campaignId'], tool: 'automations' }),
    read('campaigns.replies', 'Replies that landed in owners Inboxes, marked with the campaign', { in: { campaignId: id.campaign, ...pageIn }, out: { replies: t.arr(t.obj({ recordId: id.record, messageId: t.id('eml'), at: t.ts() })), ...pageOut }, on: ['campaign', '/campaignId'], tool: 'automations' }),
    write('campaigns.unsubscribe', 'Inbound: handle an unsubscribe link; writes the Suppression list', { in: { token: t.str() }, out: { ok: t.bool() }, emits: ['campaign.unsubscribed'], http: { method: 'POST', path: '/hooks/unsubscribe' }, team: true }),
    read('campaigns.link_build', 'Campaign link builder: UTM and click-id parameters for a destination', { in: { url: t.str(), source: t.str(), medium: t.str(), campaign: t.str() }, out: { url: t.str() }, tool: 'automations' }),
    read('warmup.status', 'Warmup state and health per mailbox: bounce, spam placement, reply', { out: { mailboxes: t.arr(t.obj({ mailboxId: id.mailbox, stage: t.enm('new', 'warming', 'ready', 'slowed'), dailyCap: t.int(), bounceRate: t.num(), replyRate: t.num() })) }, perm: 'comms.domains', tool: 'inbox' }),
    write('warmup.start', 'Start warming a new domain or mailbox', { in: { mailboxId: id.mailbox }, out: { ok: t.bool() }, perm: 'comms.domains', emits: ['warmup.slowed'], tool: 'inbox', team: true }),
    write('warmup.pool_optin_set', 'Opt the Space in or out of the shared warmup pool (out: own seed inboxes only)', { in: { optIn: t.bool() }, out: { optIn: t.bool() }, perm: 'comms.domains', level: 'manage', audit: 'always', tool: 'inbox', team: true }),
  ],
  screens: [
    screen('apps.campaigns', 'apps', 'ui:CampaignsList', { q: { campaigns: ['campaigns.list', { section: '/section', folderId: '/folder' }] }, a: { create: ['campaigns.create'] }, empty: 'No campaigns yet', primary: 'New campaign', needs: ['automations.space'] }),
    screen('apps.campaign-builder', 'apps', 'ui:CampaignBuilder', { q: { campaign: ['campaigns.get', { campaignId: '/selected' }], preview: ['campaigns.preview', { campaignId: '/selected' }] }, a: { launch: ['campaigns.launch', { campaignId: '/selected' }, 'Launch this campaign?'], steps: ['campaigns.steps_set', { campaignId: '/selected' }] } }),
    screen('apps.sending-domains', 'apps', 'ui:SendingDomains', { q: { warmup: ['warmup.status'] }, a: { start: ['warmup.start', { mailboxId: '/selected' }] }, needs: ['comms.domains'] }),
  ],
});
