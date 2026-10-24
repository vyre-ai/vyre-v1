# plan.approved

A plan was approved (with or without edits)

| | |
|---|---|
| Module | chat |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  planId: string;
  threadId: string;
  edited: boolean;
  by: string;
};
```
