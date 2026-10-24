# call.recording_changed

Recording started or stopped, with the consent that was logged

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
  recording: boolean;
  consentLogged: boolean;
};
```
