# settings.contact_code_failed

A verification code was refused: wrong, expired, too many tries or not asked for

| | |
|---|---|
| Module | settings |
| Schema version | 1 |
| Subject | entity at /person |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  person: string;
  channel: "email" | "phone";
  reason: string;
};
```
