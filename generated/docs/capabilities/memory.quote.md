# memory.quote

Exact words of a chat message or run step, word for word, with author, time and a link that opens the chat at that line; only chats, channels and runs the asker could open themselves

| | |
|---|---|
| Module | memory |
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
| HTTP | POST /v1/memory/quote |
| MCP tool | memory_quote (memory) |
| CLI | vyre memory quote |
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
  quotes: Array<{
      ref: string;
      source: "message" | "step";
      text: string;
      truncated?: boolean;
      author: {
        kind: "person" | "agent" | "actor" | "service";
        id: string;
        name?: string;
      };
      role: string;
      at: number;
      threadId: string;
      threadTitle?: string;
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
    "quotes": [
      {
        "at": 1760000000000,
        "author": {
          "id": "example",
          "kind": "person",
          "name": "example"
        },
        "link": "vyre://thread/thr_a1b2c3?m=msg_a1b2c3",
        "ref": "msg_a1b2c3",
        "role": "example",
        "score": 1,
        "source": "message",
        "text": "example",
        "threadId": "thr_a1b2c3",
        "threadTitle": "example",
        "truncated": true
      }
    ]
  }
}
```
