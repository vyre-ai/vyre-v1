# vault.item_created

An item was added

| | |
|---|---|
| Module | vault |
| Schema version | 1 |
| Subject | vault_item at /itemId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  itemId: string;
  kind: "login" | "api_key" | "env" | "card" | "note" | "totp" | "ssh_key" | "ai_subscription" | "other";
  folderId: string;
  scope: "mine" | "shared";
};
```
