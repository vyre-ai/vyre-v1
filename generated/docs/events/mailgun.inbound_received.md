# mailgun.inbound_received

A verified Mailgun inbound email arrived

| | |
|---|---|
| Module | mailgun |
| Schema version | 1 |
| Subject | entity at /messageId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  messageId: string;
  recipient: string;
};
```
