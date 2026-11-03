# skill.share_decided

A person added a skill shared with them, or said Not now

| | |
|---|---|
| Module | agents |
| Schema version | 1 |
| Subject | entity at /skillId |
| Visibility | participants |
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
  decision: "add" | "not_now";
  by: string;
};
```
