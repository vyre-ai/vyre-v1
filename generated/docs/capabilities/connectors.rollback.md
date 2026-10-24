# connectors.rollback

Put an earlier connector version back live

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | connector (/key) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/connectors/rollback |
| MCP tool | connectors_rollback (engineer) |
| CLI | none |
| Emits | connector.rolled_back |

## Input

```ts
type In = {
  key: string;
  version: string;
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
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "key": "hubspot",
    "version": "example"
  },
  "output": {
    "ok": true
  }
}
```
