# vault.item.reveal

Show the values of an item to a person at View level (asked once, logged per actor)

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | high |
| Resource | vault_item (/itemId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/vault/item/reveal |
| MCP tool | vault_item_reveal (vault) |
| CLI | none |
| Emits | vault.revealed |

## Input

```ts
type In = {
  itemId: string;
  fields?: Array<string>;
  reason?: string;
};
```

## Output

```ts
type Out = {
  fields: Array<{
      key: string;
      value: string;
    }>;
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
    "itemId": "vit_a1b2c3",
    "reason": "example"
  },
  "output": {
    "fields": [
      {
        "key": "api_key",
        "value": "example"
      }
    ]
  }
}
```
