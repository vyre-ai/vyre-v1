# changeset.edited

A person edited a proposed change in place before accepting it

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
  path: string;
  proposedBy: string;
  by: string;
  fileCount: number;
};
```
