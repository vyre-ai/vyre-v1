# sync.op_rejected

An op from a device was rejected (permission, label, lock or hold) and sits in that device Rejected list

| | |
|---|---|
| Module | sync |
| Schema version | 1 |
| Subject | entity at /opId |
| Visibility | owner |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | sync.attention |
| Retention | default |

## Payload

```ts
type Payload = {
  opId: string;
  personId: string;
  deviceId: string;
  cap: string;
  code: string;
};
```
