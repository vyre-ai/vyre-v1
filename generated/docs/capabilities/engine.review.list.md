# engine.review.list

Sampled turns waiting for human review

| | |
|---|---|
| Module | engine |
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
| HTTP | POST /v1/engine/review/list |
| MCP tool | engine_review_list (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  state?: "waiting" | "ok" | "flagged";
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  items: Array<{
      turnId: string;
      threadId: string;
      agentId: string;
      sampledAt: number;
      state: "waiting" | "ok" | "flagged";
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "limit": 1,
    "state": "waiting"
  },
  "output": {
    "items": [
      {
        "agentId": "agt_a1b2c3",
        "sampledAt": 1760000000000,
        "state": "waiting",
        "threadId": "thr_a1b2c3",
        "turnId": "trn_a1b2c3"
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
