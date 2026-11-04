# members.join_requests.decline

Decline a request to join

| | |
|---|---|
| Module | members |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | members.invite |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/members/join_requests/decline |
| MCP tool | members_join_requests_decline (meta) |
| CLI | none |
| Emits | member.join_request_declined |

## Input

```ts
type In = {
  requestId: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "requestId": "jrq_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
