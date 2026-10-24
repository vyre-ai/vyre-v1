# access.requests.decline

Decline an access request with a note for the requester

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
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/access/requests/decline |
| MCP tool | access_requests_decline (meta) |
| CLI | none |
| Emits | access.declined |

## Input

```ts
type In = {
  requestId: string;
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
    "note": "example",
    "requestId": "arq_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
