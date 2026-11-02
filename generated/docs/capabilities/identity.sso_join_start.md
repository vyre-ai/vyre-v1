# identity.sso_join_start

Invited to a Space where everyone must use single sign-on: the address to prove the invitation's email at. Any browser works

| | |
|---|---|
| Module | identity |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/identity/sso_join_start |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  code: string;
  provider: string;
};
```

## Output

```ts
type Out = {
  start: string;
};
```

## Errors

- auth.expired
- auth.invalid_code
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "code": "example",
    "provider": "google"
  },
  "output": {
    "start": "example"
  }
}
```
