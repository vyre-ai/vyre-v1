# settings.contact_code_sent

A verification code was sent to my email or phone (the code is never in the log)

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
};
```
