# vault.folder_deleted

A vault folder was deleted

| | |
|---|---|
| Module | vault |
| Schema version | 1 |
| Subject | vault_folder at /folderId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  folderId: string;
};
```
