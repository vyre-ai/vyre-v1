# computer.recording_saved

A recording was saved in the agent folder

| | |
|---|---|
| Module | computers |
| Schema version | 1 |
| Subject | computer at /computerId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  computerId: string;
  recordingId: string;
  durationMs: number;
};
```
