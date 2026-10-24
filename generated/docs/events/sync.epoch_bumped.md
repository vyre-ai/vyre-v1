# sync.epoch_bumped

A sync epoch was raised; older replicas receive purge

| | |
|---|---|
| Module | sync |
| Schema version | 1 |
| Subject | entity at /personId |
| Visibility | owner |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  personId: string;
  epoch: number;
  reason: string;
  deviceId?: string;
};
```
