# plugin.connections_policy_changed

The Space's rules for adding connections changed

| | |
|---|---|
| Module | agents |
| Schema version | 1 |
| Subject | entity at /by |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  spaceAdders: "admins" | "managers";
  allowListOn: boolean;
  by: string;
};
```
