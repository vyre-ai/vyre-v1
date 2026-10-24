# project.task_rescheduled

A task moved or was resized on the timeline

| | |
|---|---|
| Module | projects |
| Schema version | 1 |
| Subject | project at /projectId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | A task date changes |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  projectId: string;
  taskId: string;
  start?: number;
  due?: number;
  slipped: boolean;
};
```
