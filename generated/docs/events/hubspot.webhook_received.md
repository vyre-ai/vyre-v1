# hubspot.webhook_received

A HubSpot webhook arrived and was verified

| | |
|---|---|
| Module | hubspot |
| Schema version | 1 |
| Subject | entity at /objectId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  objectType: string;
  objectId: string;
  providerEventId: string;
};
```
