# campaign.launched

A campaign was launched after approval

| | |
|---|---|
| Module | campaigns |
| Schema version | 1 |
| Subject | campaign at /campaignId |
| Visibility | space |
| Label | none |
| Replay | stub |
| Automation trigger | A campaign is launched |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  campaignId: string;
  audienceCount: number;
};
```
