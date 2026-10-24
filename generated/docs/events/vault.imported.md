# vault.imported

Items came in from another password manager (counts only)

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
  source: "onepassword" | "bitwarden" | "lastpass" | "chrome";
  folderId: string;
  created: number;
  updated: number;
  skipped: number;
};
```
