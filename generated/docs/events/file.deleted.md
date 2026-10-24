# file.deleted

A file moved to Trash

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
| Retention | trash |

## Payload

```ts
type Payload = {
  fileId: string;
  folderId: string;
};
```
