# computer.skill_requested

A skill was requested from a point in a session

| | |
|---|---|
| Module | computers |
| Schema version | 1 |
| Subject | computer at /computerId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  computerId: string;
  stepId: string;
  taskId: string;
};
```
