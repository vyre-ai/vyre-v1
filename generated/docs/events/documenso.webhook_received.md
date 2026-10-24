# documenso.webhook_received

A Documenso webhook arrived and was verified

| | |
|---|---|
| Module | documenso |
| Schema version | 1 |
| Subject | entity at /envelopeId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  providerEventId: string;
  envelopeId: string;
  status: string;
};
```
