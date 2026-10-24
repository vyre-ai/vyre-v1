# mailgun.routes.delete

Delete a Mailgun route

| | |
|---|---|
| Module | mailgun |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | comms.domains |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | delete |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mailgun/routes/delete |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  routeId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  deleted: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.network
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "routeId": "example"
  },
  "output": {
    "deleted": true
  }
}
```
