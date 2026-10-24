# folder.deleted

A folder and its files moved to Trash

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
| Retention | trash |

## Payload

```ts
type Payload = {
  folderId: string;
};
```
