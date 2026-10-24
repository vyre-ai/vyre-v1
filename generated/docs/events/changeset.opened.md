# changeset.opened

Agent edits were staged in a working copy for review

| | |
|---|---|
| Module | files |
| Schema version | 1 |
| Subject | folder at /folderId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | A changeset opens for review |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  changesetId: string;
  folderId: string;
  by: string;
  fileCount: number;
  threadId?: string;
};
```
