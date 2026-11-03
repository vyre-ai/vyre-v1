# skill.shared

A person shared one of their skills, or stopped

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
  to: Array<string>;
  stop: boolean;
  by: string;
};
```
