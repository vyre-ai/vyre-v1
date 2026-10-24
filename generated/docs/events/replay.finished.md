# replay.finished

A replay sandbox finished; outward calls were recorded, never executed

| | |
|---|---|
| Module | logs |
| Schema version | 1 |
| Subject | entity at /replayId |
| Visibility | owner |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  replayId: string;
  recordedOutward: number;
};
```
