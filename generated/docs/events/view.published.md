# view.published

A saved view became shared or personal again

| | |
|---|---|
| Module | schema |
| Schema version | 1 |
| Subject | record_type at /type |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  viewId: string;
  type: string;
  shared: boolean;
};
```
