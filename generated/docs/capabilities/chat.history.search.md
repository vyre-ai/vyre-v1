# chat.history.search

Word-for-word search over the chat messages and transcript rows (turns, tool calls and results) the asker could open themselves; used by memory for exact quotes. Returns the stored words, author, time and a link that opens the chat at that line

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
| HTTP | POST /v1/chat/history/search |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  q?: string;
  ref?: string;
  threadId?: string;
  excludeThreadId?: string;
  limit?: number;
  minCoverage?: number;
};
```

## Output

```ts
type Out = {
  hits: Array<{
      source: "message" | "step";
      ref: string;
      messageId?: string;
      threadId: string;
      threadTitle?: string;
      threadKind: string;
      seq: number;
      role: string;
      author: {
        kind: "person" | "agent" | "actor" | "service";
        id: string;
      };
      text: string;
      truncated?: boolean;
      at: number;
      link: string;
      score: number;
    }>;
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
    "excludeThreadId": "thr_a1b2c3",
    "limit": 1,
    "minCoverage": 1,
    "q": "example",
    "ref": "example",
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
        "link": "vyre://thread/thr_a1b2c3?m=msg_a1b2c3",
        "messageId": "msg_a1b2c3",
        "ref": "msg_a1b2c3",
        "role": "person",
        "score": 1,
        "seq": 1,
        "source": "message",
        "text": "example",
        "threadId": "thr_a1b2c3",
        "threadKind": "example",
        "threadTitle": "example",
        "truncated": true
      }
    ]
  }
}
```
