# twilio.voice_received

A verified incoming-call webhook arrived

| | |
|---|---|
| Module | twilio |
| Schema version | 1 |
| Subject | entity at /sid |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  dedupeKey: string;
  sid: string;
};
```
