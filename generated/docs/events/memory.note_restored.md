# memory.note_restored

A shared memory note was restored to an earlier version

| | |
|---|---|
| Module | memory |
| Schema version | 1 |
| Subject | note at /noteId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | memory |

## Payload

```ts
type Payload = {
  noteId: string;
  versionId: string;
  by: string;
};
```
