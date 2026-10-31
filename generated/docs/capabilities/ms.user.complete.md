# ms.user.complete

Finish signing in from the callback: the state and the code, or the error Microsoft sent when the person declined. Only who started it can finish it. Makes the mailbox and starts its first sync

| | |
|---|---|
| Module | microsoft |
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
| HTTP | POST /v1/ms/user/complete |
| MCP tool | none |
| CLI | none |
| Emits | microsoft.user_connected |

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
  accountId: string;
  email: string;
  mailboxId?: string;
};
```

## Errors

- auth.invalid_code
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.auth_failed
- provider.bad_response
- provider.network
- validation.bad_input
- validation.duplicate
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
    "email": "maya@example.com",
    "mailboxId": "mbx_a1b2c3"
  }
}
```
