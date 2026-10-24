# session.started

A session opened on a device

| | |
|---|---|
| Module | devices |
| Schema version | 1 |
| Subject | entity at /sessionId |
| Visibility | owner |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  sessionId: string;
  person: string;
  deviceId: string;
};
```
