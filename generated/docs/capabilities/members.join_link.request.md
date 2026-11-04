# members.join_link.request

Ask to join through the Request to join link: a name, an email and an optional note. Nothing is created but the request; asking again from the same email is one request

| | |
|---|---|
| Module | members |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/members/join_link/request |
| MCP tool | none |
| CLI | none |
| Emits | member.join_requested |

## Input

```ts
type In = {
  code: string;
  name: string;
  email: string;
  note?: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
};
```

## Errors

- auth.invalid_code
- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "code": "example",
    "email": "maya@example.com",
    "name": "example",
    "note": "example"
  },
  "output": {
    "ok": true
  }
}
```
