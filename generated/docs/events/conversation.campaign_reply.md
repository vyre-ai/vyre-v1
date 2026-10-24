# conversation.campaign_reply

A contact on a campaign replied; it lands in the owner Inbox marked with the campaign

| | |
|---|---|
| Module | inbox |
| Schema version | 1 |
| Subject | record at /contactId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | campaign.reply |
| Retention | default |

## Payload

```ts
type Payload = {
  conversationId: string;
  contactId: string;
  campaignId: string;
  channel: "email" | "sms" | "call";
};
```
