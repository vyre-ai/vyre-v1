# warmup.pool_optin_set

Opt the Space in or out of the shared warmup pool (out: own seed inboxes only)

| | |
|---|---|
| Module | campaigns |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | comms.domains |
| Grant level | manage |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/warmup/pool_optin_set |
| MCP tool | warmup_pool_optin_set (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  optIn: boolean;
};
```

## Output

```ts
type Out = {
  optIn: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "optIn": true
  },
  "output": {
    "optIn": true
  }
}
```
