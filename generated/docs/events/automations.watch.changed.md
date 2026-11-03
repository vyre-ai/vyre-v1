# automations.watch.changed

A watched page changed since its last reading

| | |
|---|---|
| Module | automations |
| Schema version | 1 |
| Subject | entity at /watchId |
| Visibility | owner |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  watchId: string;
  owner: string;
  changes: number;
};
```
