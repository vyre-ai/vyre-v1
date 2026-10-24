# call.transcript_ready

A transcript and summary were attached to a call

| | |
|---|---|
| Module | telephony |
| Schema version | 1 |
| Subject | entity at /callId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | A call transcript is ready |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  callId: string;
  contactId?: string;
};
```
