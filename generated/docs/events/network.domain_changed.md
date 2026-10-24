# network.domain_changed

The Space address changed (own domain or relay)

| | |
|---|---|
| Module | network |
| Schema version | 1 |
| Subject | entity at /address |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  address: string;
  mode: "own_domain" | "relay";
};
```
