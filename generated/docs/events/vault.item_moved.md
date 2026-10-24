# vault.item_moved

An item moved to another folder (re-encrypted when it crosses Mine and Shared)

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
  fromFolderId: string;
  toFolderId: string;
};
```
