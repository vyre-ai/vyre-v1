# memory.pointer

Pointer block for a message: up to about 5 lines from a local lookup, no model call, deduplicated against the thread

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
| HTTP | POST /v1/memory/pointer |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  agentId: string;
  text: string;
  sinceIdx?: number;
};
```

## Output

```ts
type Out = {
  lines: Array<{
      title: string;
      fact?: string;
      trueSince?: number;
      path: string;
    }>;
  tokens: number;
  skipped?: "short_ack" | "mid_tool_loop" | "no_match" | "duplicate";
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
    "sinceIdx": 1,
    "text": "example",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "lines": [
      {
        "fact": "example",
        "path": "example",
        "title": "example",
        "trueSince": 1760000000000
      }
    ],
    "skipped": "short_ack",
    "tokens": 1
  }
}
```
