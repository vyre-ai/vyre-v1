# message.mentioned

A person was @mentioned

| | |
|---|---|
| Module | chat |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | participants |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | mention |
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
  inThread: boolean;
};
```
