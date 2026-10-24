# vault.folder_updated

A vault folder was renamed or its Who can export rule changed

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
| Retention | audit |

## Payload

```ts
type Payload = {
  folderId: string;
  exportRuleChanged: boolean;
};
```
