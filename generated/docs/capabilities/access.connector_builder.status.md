# access.connector_builder.status

Does this assistant hold the permission to build connectors, may the caller give it, and (when an item is named) may the assistant use that Vault item

| | |
|---|---|
| Module | access |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/access/connector_builder/status |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId: string;
  itemId?: string;
};
```

## Output

```ts
type Out = {
  allowed: boolean;
  canGrant: boolean;
  reaches?: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "itemId": "vit_a1b2c3"
  },
  "output": {
    "allowed": true,
    "canGrant": true,
    "reaches": true
  }
}
```
