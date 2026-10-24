# suppression.added

An address was added to the suppression list

| | |
|---|---|
| Module | contacts-link |
| Schema version | 1 |
| Subject | entity at /suppressionId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | An address is suppressed |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  suppressionId: string;
  channel: "email" | "sms" | "call";
  reason: "bounce_hard" | "complaint" | "unsubscribe" | "stop" | "manual" | "do_not_contact" | "import";
  contactId?: string;
};
```
