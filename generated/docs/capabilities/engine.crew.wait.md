# engine.crew.wait

Wake me when the checks of a pull request end: the host looks at them, not the model, shows the progress in the Crew tab, and posts one message here that wakes the lead when they finish

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/engine/crew/wait |
| MCP tool | crew_wait (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  repo: string;
  number: number;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  wait: {
    waitId: string;
    kind: "checks";
    label: string;
    state: "pending" | "passing" | "failing" | "none";
    done: number;
    total: number;
    startedAt: number;
  };
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
    "idempotencyKey": "idem_1",
    "number": 1,
    "repo": "acme/site",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "wait": {
      "done": 1,
      "kind": "checks",
      "label": "acme/site#12",
      "startedAt": 1760000000000,
      "state": "pending",
      "total": 1,
      "waitId": "example"
    }
  }
}
```
