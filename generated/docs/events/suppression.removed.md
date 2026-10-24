# suppression.removed

An address was removed from the suppression list by a person

| | |
|---|---|
| Module | contacts-link |
| Schema version | 1 |
| Subject | entity at /suppressionId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
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
