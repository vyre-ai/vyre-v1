# access.actors.redeem

The outside tool trades its one-time token for a registered credential; the actor turns active

| | |
|---|---|
| Module | access |
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
| HTTP | POST /v1/access/actors/redeem |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  token: string;
};
```

## Output

```ts
type Out = {
  actorId: string;
  credential: string;
};
```

## Errors

- auth.invalid_code
- internal.unexpected
- permission.above_clearance
- permission.expired
- permission.needs_team
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "token": "example"
  },
  "output": {
    "actorId": "act_a1b2c3",
    "credential": "example"
  }
}
```
