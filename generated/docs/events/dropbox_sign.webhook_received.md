# dropbox_sign.webhook_received

A Dropbox Sign webhook arrived and was verified

| | |
|---|---|
| Module | dropbox-sign |
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
