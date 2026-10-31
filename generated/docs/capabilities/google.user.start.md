# google.user.start

Start signing in to your own Gmail: the address to approve at

| | |
|---|---|
| Module | google |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/google/user/start |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  loginHint?: string;
};
```

## Output

```ts
type Out = {
  authUrl: string;
  state: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "loginHint": "maya@example.com"
  },
  "output": {
    "authUrl": "example",
    "state": "example"
  }
}
```
