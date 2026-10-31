# access.connector_builder.grant

Give an assistant the Connector builder role (Member permissions plus connectors.manage), making the role if the Space has none. Needs access.manage.

| | |
|---|---|
| Module | access |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | access.manage |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/access/connector_builder/grant |
| MCP tool | none |
| CLI | none |
| Emits | access.changed |

## Input

```ts
type In = {
  agentId: string;
};
```

## Output

```ts
type Out = {
  roleId: string;
  created: boolean;
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
    "agentId": "agt_a1b2c3"
  },
  "output": {
    "created": true,
    "roleId": "rol_a1b2c3"
  }
}
```
