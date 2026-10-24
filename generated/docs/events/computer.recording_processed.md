# computer.recording_processed

A recording was turned into a skill, routine, recipe or workflow task

| | |
|---|---|
| Module | computers |
| Schema version | 1 |
| Subject | entity at /recordingId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  recordingId: string;
  intents: Array<string>;
  taskId: string;
};
```
