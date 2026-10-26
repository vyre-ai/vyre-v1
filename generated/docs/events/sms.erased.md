# sms.erased

A text message was erased for good (ids only)

| | |
|---|---|
| Module | telephony |
| Schema version | 1 |
| Subject | entity at /smsId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  smsId: string;
};
```
