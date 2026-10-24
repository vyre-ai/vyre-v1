# tombstones.reapplied

Tombstones were replayed after a restore, before the Space opened for traffic

| | |
|---|---|
| Module | governance |
| Schema version | 1 |
| Subject | entity at /count |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  count: number;
};
```
