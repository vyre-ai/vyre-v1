# automations.connector.trust_host

Allow the key in a connector's Vault item to be sent to one of the connector's hosts. An agent is held for a person to approve.

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | automations.personal |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | send when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/automations/connector/trust_host |
| MCP tool | automations_connector_trust_host (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  app: string;
  host: string;
};
```

## Output

```ts
type Out = {
  app: string;
  host: string;
  allowed: boolean;
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
    "app": "stripe",
    "host": "example"
  },
  "output": {
    "allowed": true,
    "app": "stripe",
    "host": "example"
  }
}
```
