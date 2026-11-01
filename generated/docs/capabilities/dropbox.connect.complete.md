# dropbox.connect.complete

Finish signing in from the callback: the state and the code, or the error Dropbox sent when the person declined. Only who started it can finish it

| | |
|---|---|
| Module | dropbox |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/dropbox/connect/complete |
| MCP tool | none |
| CLI | none |
| Emits | dropbox.connected |

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
  accountId: string;
  email?: string;
  name?: string;
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
    "accountId": "example",
    "connectionId": "con_a1b2c3",
    "email": "example",
    "name": "example"
  }
}
```
