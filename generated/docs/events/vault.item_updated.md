# vault.item_updated

Fields or settings of an item changed (field keys only)

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
  fieldsChanged: Array<string>;
  settingsChanged: Array<string>;
};
```
