# message.received

A message was posted in a thread (ids and counts only, never the text)

| | |
|---|---|
| Module | chat |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | A message is posted |
| Notification | none |
| Retention | transcripts |

## Payload

```ts
type Payload = {
  messageId: string;
  threadId: string;
  threadSeq: number;
  author: {
    kind: "person" | "agent" | "actor" | "service";
    id: string;
  };
  kind: string;
  depth: number;
  mentions: Array<{
      kind: "person" | "agent";
      id: string;
    }>;
  hasBlocks: boolean;
  via?: string;
};
```
