# sms.received

A text arrived on a number

| | |
|---|---|
| Module | telephony |
| Schema version | 1 |
| Subject | entity at /smsId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | A text arrives |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  smsId: string;
  numberId: string;
  from: string;
  contactId?: string;
  optOut: boolean;
};
```
