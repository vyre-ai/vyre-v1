# Campaigns (campaigns)

Lane L8. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (21)

- [campaigns.audience_set](../capabilities/campaigns.audience_set.md): Set the audience from a record view; adds go through DND screening (adds only)
- [campaigns.create](../capabilities/campaigns.create.md): Create a campaign (one-time, sequence or triggered)
- [campaigns.delete](../capabilities/campaigns.delete.md): Delete a draft campaign
- [campaigns.get](../capabilities/campaigns.get.md): Read a campaign with steps, audience, windows, throttle and A/B variants
- [campaigns.launch](../capabilities/campaigns.launch.md): Launch a campaign (Gate act for agents, automations and humans alike)
- [campaigns.link_build](../capabilities/campaigns.link_build.md): Campaign link builder: UTM and click-id parameters for a destination
- [campaigns.list](../capabilities/campaigns.list.md): List campaigns by section and folder
- [campaigns.pause](../capabilities/campaigns.pause.md): Pause a running campaign
- [campaigns.preview](../capabilities/campaigns.preview.md): Launch preview: a sample message, counts and exclusions
- [campaigns.replies](../capabilities/campaigns.replies.md): Replies that landed in owners Inboxes, marked with the campaign
- [campaigns.resume](../capabilities/campaigns.resume.md): Resume a paused campaign
- [campaigns.schedule_set](../capabilities/campaigns.schedule_set.md): Set send windows per recipient time zone, throttling per sending domain and stop on reply
- [campaigns.stats](../capabilities/campaigns.stats.md): Sent, delivered, bounced, complained, replied, unsubscribed
- [campaigns.steps_set](../capabilities/campaigns.steps_set.md): Replace the steps: email, wait, branch on reply/open/click, SMS, task, call task
- [campaigns.stop](../capabilities/campaigns.stop.md): Stop a campaign for good
- [campaigns.unsubscribe](../capabilities/campaigns.unsubscribe.md): Inbound: handle an unsubscribe link; writes the Suppression list
- [campaigns.update](../capabilities/campaigns.update.md): Rename or change settings
- [campaigns.variants_set](../capabilities/campaigns.variants_set.md): Set A/B variants
- [warmup.pool_optin_set](../capabilities/warmup.pool_optin_set.md): Opt the Space in or out of the shared warmup pool (out: own seed inboxes only)
- [warmup.start](../capabilities/warmup.start.md): Start warming a new domain or mailbox
- [warmup.status](../capabilities/warmup.status.md): Warmup state and health per mailbox: bounce, spam placement, reply

## Events (6)

- [campaign.completed](../events/campaign.completed.md): A campaign finished
- [campaign.launched](../events/campaign.launched.md): A campaign was launched after approval
- [campaign.paused](../events/campaign.paused.md): A campaign paused
- [campaign.replied](../events/campaign.replied.md): A contact replied to a campaign
- [campaign.unsubscribed](../events/campaign.unsubscribed.md): A contact unsubscribed
- [warmup.slowed](../events/warmup.slowed.md): Warmup slowed a mailbox after bounces, spam placement or low replies
