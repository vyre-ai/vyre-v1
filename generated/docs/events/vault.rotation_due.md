# vault.rotation_due

An item reached its rotation reminder date (ids only); the owner gets a Badge notification

| | |
|---|---|
| Module | vault |
| Schema version | 1 |
| Subject | vault_item at /itemId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | vault.rotation_due |
| Retention | default |

## Payload

```ts
type Payload = {
  itemId: string;
  dueSince: number;
};
```
