# epoch.bumped

A person epoch or the Space key epoch advanced; lower epochs purge

| | |
|---|---|
| Module | devices |
| Schema version | 1 |
| Subject | entity at /epoch |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  scope: "person" | "space";
  person?: string;
  epoch: number;
  reason: "device_revoked" | "suspended" | "removed" | "password_reset" | "clearance_lowered" | "key_rotation";
};
```
