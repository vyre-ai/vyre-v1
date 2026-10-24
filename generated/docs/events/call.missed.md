# call.missed

An incoming call was not answered

| | |
|---|---|
| Module | telephony |
| Schema version | 1 |
| Subject | entity at /callId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  callId: string;
  numberId: string;
  from: string;
  contactId?: string;
};
```
