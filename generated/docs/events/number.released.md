# number.released

A number was released back to Twilio

| | |
|---|---|
| Module | telephony |
| Schema version | 1 |
| Subject | number at /numberId |
| Visibility | space |
| Label | none |
| Replay | stub |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  numberId: string;
  e164: string;
};
```
