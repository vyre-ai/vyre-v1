# inbox.item_erased

The conversation entries of one message, text or call were erased for good (ids only)

| | |
|---|---|
| Module | inbox |
| Schema version | 1 |
| Subject | entity at /refId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  refId: string;
  removed: number;
};
```
