# runs.message.send

A node tells another node of its tree something (a sibling, or its parent); it is read at the receiver's next step

| | |
|---|---|
| Module | runs |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | run (/runId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/runs/message/send |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  runId: string;
  to: string;
  body: string;
  key?: string;
};
```

## Output

```ts
type Out = {
  message: {
    id: string;
    rootRun: string;
    fromRun: string;
    toRun: string;
    body: string;
    at: number;
    deliveredAt?: number;
    seenAt?: number;
  };
  duplicate: boolean;
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
    "body": "example",
    "key": "example",
    "runId": "run_a1b2c3",
    "to": "example"
  },
  "output": {
    "duplicate": true,
    "message": {
      "at": 1760000000000,
      "body": "example",
      "deliveredAt": 1760000000000,
      "fromRun": "run_a1b2c3",
      "id": "example",
      "rootRun": "run_a1b2c3",
      "seenAt": 1760000000000,
      "toRun": "run_a1b2c3"
    }
  }
}
```
