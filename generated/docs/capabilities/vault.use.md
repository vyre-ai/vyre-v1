# vault.use

Ask for an item by name: returns a handle like #Dana_Lawmatics and the field names, never values

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | vault_item (/item) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/vault/use |
| MCP tool | vault_use (vault) |
| CLI | none |
| Emits | vault.used |

## Input

```ts
type In = {
  item: string;
  fields?: Array<string>;
  purpose?: string;
};
```

## Output

```ts
type Out = {
  handle: string;
  itemId: string;
  fields: Array<string>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.provider_label
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "fields": [
      "api_key"
    ],
    "item": "Dana_Lawmatics",
    "purpose": "example"
  },
  "output": {
    "fields": [
      "api_key"
    ],
    "handle": "#Dana_Lawmatics",
    "itemId": "vit_a1b2c3"
  }
}
```
