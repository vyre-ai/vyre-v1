# runs.message.take

The server hands a node what waits for it and marks it delivered, once

| | |
|---|---|
| Module | runs |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/runs/message/take |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  runId: string;
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
    "runId": "run_a1b2c3"
  },
  "output": {
    "messages": [
      {
        "at": 1760000000000,
        "body": "example",
        "deliveredAt": 1760000000000,
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
