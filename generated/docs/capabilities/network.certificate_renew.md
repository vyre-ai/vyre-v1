# network.certificate_renew

Renew a certificate now

| | |
|---|---|
| Module | network |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | server.network |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/network/certificate_renew |
| MCP tool | network_certificate_renew (engineer) |
| CLI | none |
| Emits | network.certificate_renewed, network.certificate_failed |

## Input

```ts
type In = {
  host: string;
};
```

## Output

```ts
type Out = {
  state: "healthy" | "degraded" | "down";
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "host": "example"
  },
  "output": {
    "state": "healthy"
  }
}
```
