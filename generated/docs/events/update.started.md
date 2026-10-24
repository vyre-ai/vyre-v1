# update.started

A server update began (backup taken first)

| | |
|---|---|
| Module | updates |
| Schema version | 1 |
| Subject | entity at /to |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  from: string;
  to: string;
};
```
