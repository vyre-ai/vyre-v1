# changeset.approved

A changeset was approved and committed

| | |
|---|---|
| Module | files |
| Schema version | 1 |
| Subject | folder at /folderId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | A changeset is approved |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  changesetId: string;
  folderId: string;
  by: string;
  fileCount: number;
  commit?: string;
};
```
