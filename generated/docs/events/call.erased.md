# call.erased

A call record was erased for good with its transcript, summary and recording (ids only)

| | |
|---|---|
| Module | telephony |
| Schema version | 1 |
| Subject | entity at /callId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  callId: string;
};
```
