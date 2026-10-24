# health.support_bundle

Make a support bundle: versions, recent traces, health, logs without content (works with the gateway down through the CLI)

| | |
|---|---|
| Module | health |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | server.logs |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/health/support_bundle |
| MCP tool | health_support_bundle (engineer) |
| CLI | vyre support-bundle |
| Emits | support_bundle.created |

## Input

```ts
type In = {
  traceIds?: Array<string>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  bundleId: string;
  fileId: string;
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
    "idempotencyKey": "idem_1",
    "traceIds": [
      "0123456789abcdef0123456789abcdef"
    ]
  },
  "output": {
    "bundleId": "bnd_a1b2c3",
    "fileId": "fil_a1b2c3"
  }
}
```
