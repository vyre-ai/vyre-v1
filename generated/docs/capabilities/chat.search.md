# chat.search

Search the messages of every chat and channel you are in, by the words and by meaning; each hit names its message so a screen can jump to it

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/search |
| MCP tool | chat_search (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  q: string;
  mode?: "keyword" | "meaning" | "hybrid";
  threadId?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  hits: Array<{
      messageId: string;
      threadId: string;
      threadSeq: number;
      author: {
        kind: "person" | "agent" | "actor" | "service";
        id: string;
      };
      snippet: string;
      at: number;
      score: number;
      found: "keyword" | "meaning" | "both";
      thread: {
        kind: "chat" | "channel" | "thread" | "ask" | "run" | "helper" | "console";
        title?: string;
        channelName?: string;
        agentIds: Array<string>;
        memberIds: Array<string>;
      };
    }>;
  meaning: boolean;
  sealedChats: number;
  tookMs: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "limit": 1,
    "mode": "keyword",
    "q": "example",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "hits": [
      {
        "at": 1760000000000,
        "author": {
          "id": "usr_a1b2c3",
          "kind": "person"
        },
        "found": "keyword",
        "messageId": "msg_a1b2c3",
        "score": 1,
        "snippet": "example",
        "thread": {
          "agentIds": [
            "agt_a1b2c3"
          ],
          "channelName": "example",
          "kind": "chat",
          "memberIds": [
            "example"
          ],
          "title": "example"
        },
        "threadId": "thr_a1b2c3",
        "threadSeq": 1
      }
    ],
    "meaning": true,
    "sealedChats": 1,
    "tookMs": 1
  }
}
```
