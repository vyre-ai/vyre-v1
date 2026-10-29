# connections.complete_auth

Finish an OAuth sign-in from the callback: the state and the code, or the error the app sent back when the person declined. Only the person who started the sign-in can finish it

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/connections/complete_auth |
| MCP tool | none |
| CLI | none |
| Emits | connection.reconnected, connection.created |

## Input

```ts
type In = {
  state: string;
  code?: string;
  error?: string;
};
```

## Output

```ts
type Out = {
  connectionId: string;
};
```

## Errors

- auth.invalid_code
- auth.unauthenticated
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.auth_failed
- provider.bad_response
- provider.network
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "code": "example",
    "error": "example",
    "state": "example"
  },
  "output": {
    "connectionId": "con_a1b2c3"
  }
}
```
