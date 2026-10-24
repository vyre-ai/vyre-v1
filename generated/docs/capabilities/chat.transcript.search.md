# chat.transcript.search

Search transcripts the asker may see: keyword, semantic or hybrid (default), snippets with links, never raw files

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
| HTTP | POST /v1/chat/transcript/search |
| MCP tool | transcript_search (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  q: string;
  mode?: "keyword" | "semantic" | "hybrid";
  threadId?: string;
  agentId?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  hits: Array<{
      turnId: string;
      threadId: string;
      idx: number;
      role: "user" | "assistant" | "tool" | "system";
      snippet: string;
      at: number;
      link: string;
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
    "agentId": "agt_a1b2c3",
    "limit": 1,
    "mode": "keyword",
    "q": "example",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "hits": [
      {
        "at": 1760000000000,
        "idx": 1,
        "link": "example",
        "role": "user",
        "snippet": "example",
        "threadId": "thr_a1b2c3",
        "turnId": "trn_a1b2c3"
      }
    ]
  }
}
```
