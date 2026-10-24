# campaign.unsubscribed

A contact unsubscribed

| | |
|---|---|
| Module | campaigns |
| Schema version | 1 |
| Subject | campaign at /campaignId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  campaignId: string;
  recordId: string;
};
```
