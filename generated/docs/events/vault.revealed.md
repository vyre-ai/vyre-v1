# vault.revealed

A value was shown to a person at View level (audited per actor)

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
| Retention | audit |

## Payload

```ts
type Payload = {
  itemId: string;
  fields: Array<string>;
};
```
