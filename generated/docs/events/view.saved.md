# view.saved

A saved view was created or changed

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
