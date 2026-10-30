# memory.recall.record

Record which facts and quotes recall handed the agent for one message (ids only), for memory.used; the engine writes this as the person whose message it was

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/memory/recall/record |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  messageId: string;
  agentId?: string;
  lines: Array<{
      kind: "fact" | "quote";
      ref: string;
    }>;
};
```

## Output

```ts
type Out = {
  recorded: number;
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
    "lines": [
      {
        "kind": "fact",
        "ref": "example"
      }
    ],
    "messageId": "msg_a1b2c3",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "recorded": 1
  }
}
```
