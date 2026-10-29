# automations.connector_offer.decline

Decline a connector setup offer. Declining is final for that Vault item.

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/connector_offer/decline |
| MCP tool | automations_connector_offer_decline (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  itemId: string;
};
```

## Output

```ts
type Out = {
  decision: "declined" | "absent";
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
    "itemId": "vit_a1b2c3"
  },
  "output": {
    "decision": "declined"
  }
}
```
