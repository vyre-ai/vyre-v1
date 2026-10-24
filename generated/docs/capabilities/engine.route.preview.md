# engine.route.preview

Who will answer a draft message ("Intake will reply" or "No agent will reply, type @ to ask one"); same route() the client runs locally

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/route/preview |
| MCP tool | engine_route_preview (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  mentions?: Array<{
      kind: "person" | "agent";
      id: string;
    }>;
};
```

## Output

```ts
type Out = {
  responders: Array<string>;
  line: string;
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
    "mentions": [
      {
        "id": "example",
        "kind": "person"
      }
    ],
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "line": "Intake will reply",
    "responders": [
      "agt_a1b2c3"
    ]
  }
}
```
