# vault.requested

A key was asked for; the folder managers get a task

| | |
|---|---|
| Module | vault-requests |
| Schema version | 1 |
| Subject | entity at /requestId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | A key is requested |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  requestId: string;
  name: string;
  fields: Array<string>;
  requester: {
    kind: "person" | "agent" | "actor" | "service";
    id: string;
  };
  forRun?: string;
  taskId: string;
};
```
