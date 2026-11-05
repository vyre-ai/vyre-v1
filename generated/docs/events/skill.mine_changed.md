# skill.mine_changed

A person added, changed or removed one of their own skills

| | |
|---|---|
| Module | agents |
| Schema version | 1 |
| Subject | skill at /skillId |
| Visibility | owner |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  skillId: string;
  name: string;
  op: "added" | "changed" | "removed" | "updated";
  by: string;
  ownerId?: string;
};
```
