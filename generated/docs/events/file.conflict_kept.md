# file.conflict_kept

Two saves collided on a binary file; the newest is current and the other is kept as a labelled version

| | |
|---|---|
| Module | files |
| Schema version | 1 |
| Subject | file at /fileId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  fileId: string;
  keptVersionId: string;
  currentVersionId: string;
};
```
