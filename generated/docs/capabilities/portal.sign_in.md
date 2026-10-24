# portal.sign_in

Request a magic link or sign in with a password

| | |
|---|---|
| Module | portal |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /portal/sign-in |
| MCP tool | none |
| CLI | none |
| Emits | portal.signed_in |

## Input

```ts
type In = {
  siteId: string;
  email: string;
  password?: string;
  token?: string;
};
```

## Output

```ts
type Out = {
  session: string;
};
```

## Errors

- auth.bad_credentials
- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- rate_limit.exceeded
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "email": "example",
    "password": "example",
    "siteId": "sit_a1b2c3",
    "token": "example"
  },
  "output": {
    "session": "example"
  }
}
```
