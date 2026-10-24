# update.rolled_back

The server rolled back to a previous version

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
