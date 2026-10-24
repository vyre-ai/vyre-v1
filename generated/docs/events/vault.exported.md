# vault.exported

A .env file was made from a folder; the folder owner is notified

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
  exportId: string;
  folderId: string;
  itemCount: number;
  expiresAt: number;
};
```
