# call.ended

A call ended

| | |
|---|---|
| Module | telephony |
| Schema version | 1 |
| Subject | entity at /callId |
| Visibility | space |
| Label | subject |
| Replay | stub |
| Automation trigger | A call ends |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  callId: string;
  numberId: string;
  direction: "in" | "out";
  durationSec: number;
  contactId?: string;
};
```
