# network.server_requested

A computer asked to join the Space and waits for a person to approve it

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
  fingerprint: string;
};
```
