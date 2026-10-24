# resend.inbound_received

A verified Resend inbound email arrived

| | |
|---|---|
| Module | resend |
| Schema version | 1 |
| Subject | entity at /emailId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  emailId: string;
  route?: string;
};
```
