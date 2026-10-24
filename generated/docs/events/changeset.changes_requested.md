# changeset.changes_requested

The reviewer asked the agent for changes

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
  by: string;
  comments: number;
};
```
