# network.server_added

A server joined the Space for compute

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
  name: string;
};
```
