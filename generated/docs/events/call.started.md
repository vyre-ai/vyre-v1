# call.started

A call connected

| | |
|---|---|
| Module | telephony |
| Schema version | 1 |
| Subject | entity at /callId |
| Visibility | space |
| Label | subject |
| Replay | stub |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  callId: string;
  numberId: string;
  direction: "in" | "out";
  contactId?: string;
};
```
