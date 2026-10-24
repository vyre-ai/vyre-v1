# vault.used

An item was used by handle; the value was filled and scrubbed (no value in the event)

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
  field?: string;
  via: "device" | "host" | "computer";
  purpose?: string;
};
```
