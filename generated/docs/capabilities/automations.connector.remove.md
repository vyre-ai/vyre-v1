# automations.connector.remove

Remove a connector that no automation uses

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | automations.personal |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | delete when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/automations/connector/remove |
| MCP tool | automations_connector_remove (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  app: string;
};
```

## Output

```ts
type Out = {
  removed: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "app": "stripe"
  },
  "output": {
    "removed": true
  }
}
```
