# member.join_link_changed

The reusable Request to join link was turned on, turned off, rotated, or given another role (never the code)

| | |
|---|---|
| Module | members |
| Schema version | 1 |
| Subject | entity at /by |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  change: "on" | "rotated" | "off" | "role";
  role: string;
  by: string;
};
```
