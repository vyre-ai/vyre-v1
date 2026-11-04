# network.machine_changed

A machine was drained or undrained, its limits changed, or it ran out of room or has room again: placement caches are dropped on this

| | |
|---|---|
| Module | network |
| Schema version | 1 |
| Subject | entity at /serverId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  serverId: string;
  what: Array<"drain" | "limits" | "full" | "room">;
};
```
