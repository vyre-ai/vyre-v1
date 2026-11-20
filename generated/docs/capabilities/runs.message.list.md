# runs.message.list

The messages of a node, sent and received, with how far each got; with tree the messages of the whole tree

| | |
|---|---|
| Module | runs |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | run (/runId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/runs/message/list |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  runId: string;
  tree?: boolean;
};
```

## Output

```ts
type Out = {
  messages: Array<{
      id: string;
      rootRun: string;
      fromRun: string;
      toRun: string;
      body: string;
      at: number;
      deliveredAt?: number;
      seenAt?: number;
      fromName?: string;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "runId": "run_a1b2c3",
    "tree": true
  },
  "output": {
    "messages": [
      {
        "at": 1760000000000,
        "body": "example",
        "deliveredAt": 1760000000000,
        "fromName": "example",
        "fromRun": "run_a1b2c3",
        "id": "example",
        "rootRun": "run_a1b2c3",
        "seenAt": 1760000000000,
        "toRun": "run_a1b2c3"
      }
    ]
  }
}
```
