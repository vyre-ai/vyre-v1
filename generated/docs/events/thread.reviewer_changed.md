# thread.reviewer_changed

A chat got a reviewer, or lost it

| | |
|---|---|
| Module | engine |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  threadId: string;
  reviewer: ({
    kind: "agent" | "person";
    id: string;
  }) | null;
  by: string;
};
```
