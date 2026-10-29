# automations.connector_offers

Open connector setup offers. Each one names an app. A Vault value is not included.

| | |
|---|---|
| Module | automations |
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
| HTTP | POST /v1/automations/connector_offers |
| MCP tool | automations_connector_offers (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  offers: Array<{
      itemId: string;
      appName: string;
      text: string;
    }>;
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
  "input": {},
  "output": {
    "offers": [
      {
        "appName": "example",
        "itemId": "vit_a1b2c3",
        "text": "example"
      }
    ]
  }
}
```
