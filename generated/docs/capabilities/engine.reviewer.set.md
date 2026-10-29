# engine.reviewer.set

Give a chat a reviewer, an agent or a person, who checks the lead agent's work before it counts; none clears the seat. An agent reviewer is asked in the chat after each lead turn ("Asking Reviewer to check this"), a person gets a Review task

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
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/reviewer/set |
| MCP tool | engine_reviewer_set (chats) |
| CLI | none |
| Emits | thread.reviewer_changed |

## Input

```ts
type In = {
  threadId: string;
  reviewer: ({
    kind: "agent" | "person";
    id: string;
  }) | null;
};
```

## Output

```ts
type Out = {
  reviewer: ({
    kind: "agent" | "person";
    id: string;
  }) | null;
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
    "reviewer": {
      "id": "agt_a1b2c3",
      "kind": "agent"
    },
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "reviewer": {
      "id": "example",
      "kind": "agent"
    }
  }
}
```
