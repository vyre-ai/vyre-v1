# memory.page_restored

A page came back from Trash or Archive

| | |
|---|---|
| Module | memory |
| Schema version | 1 |
| Subject | entity at /pageId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | memory |

## Payload

```ts
type Payload = {
  pageId: string;
  from: string;
  by: string;
};
```
