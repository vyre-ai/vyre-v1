# message.direct

A person received a direct message from another person

| | |
|---|---|
| Module | chat |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | participants |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | dm |
| Retention | default |

## Payload

```ts
type Payload = {
  messageId: string;
  threadId: string;
  personId: string;
  author: {
    kind: "person" | "agent" | "actor" | "service";
    id: string;
  };
};
```
