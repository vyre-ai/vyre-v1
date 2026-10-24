# changeset.updated

A change inside a changeset was reverted or the agent added more edits

| | |
|---|---|
| Module | files |
| Schema version | 1 |
| Subject | folder at /folderId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  changesetId: string;
  folderId: string;
  fileCount: number;
};
```
