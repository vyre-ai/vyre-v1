# vault.scrub_miss

The output scrubber failed to remove a value from a stream (value not recorded)

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
  place: "terminal" | "http" | "browser" | "file" | "chat";
  traceId: string;
};
```
