# helper.note

A note went between a helper and the agent that started it

| | |
|---|---|
| Module | chat |
| Schema version | 1 |
| Subject | thread at /helperThreadId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  helperThreadId: string;
  direction: "up" | "down";
  kind: "followup" | "progress" | "question" | "result";
  messageId: string;
};
```
