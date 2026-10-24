# space.address_changed

The Space address moved between relay and an own domain; devices keep the pinned Space key

| | |
|---|---|
| Module | spaces |
| Schema version | 1 |
| Subject | entity at /mode |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  mode: "relay" | "own_domain";
  host?: string;
  by: string;
};
```
