# skill.policy_changed

An admin changed who may add skills that run scripts

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
  scriptsAdminOnly: boolean;
  by: string;
};
```
