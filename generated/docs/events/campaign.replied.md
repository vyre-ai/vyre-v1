# campaign.replied

A contact replied to a campaign

| | |
|---|---|
| Module | campaigns |
| Schema version | 1 |
| Subject | campaign at /campaignId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | A campaign gets a reply |
| Notification | campaign.reply |
| Retention | default |

## Payload

```ts
type Payload = {
  campaignId: string;
  recordId: string;
  messageId: string;
};
```
