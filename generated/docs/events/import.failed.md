# import.failed

An import stopped on an error; rows already written stay and the Run can be undone

| | |
|---|---|
| Module | import |
| Schema version | 1 |
| Subject | entity at /importId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | run.failed |
| Retention | default |

## Payload

```ts
type Payload = {
  importId: string;
  runId: string;
  type: string;
  error: string;
};
```
