# vault.item.history

Every use, reveal, edit and share of an item (never values)

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | vault_item (/itemId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/vault/item/history |
| MCP tool | vault_item_history (vault) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  itemId: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  entries: Array<{
      at: number;
      actor: {
        kind: "person" | "agent" | "actor" | "service";
        id: string;
      };
      onBehalfOf?: {
        kind: "person" | "agent" | "actor" | "service";
        id: string;
      };
      action: "created" | "used" | "revealed" | "edited" | "moved" | "rotated" | "shared" | "unshared" | "exported" | "deleted" | "restored";
      field?: string;
      via?: "device" | "host" | "computer";
      detail?: string;
    }>;
  next?: string;
  total?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": "example",
    "itemId": "vit_a1b2c3",
    "limit": 1
  },
  "output": {
    "entries": [
      {
        "action": "created",
        "actor": {
          "id": "usr_a1b2c3",
          "kind": "person"
        },
        "at": 1760000000000,
        "detail": "example",
        "field": "api_key",
        "onBehalfOf": {
          "id": "usr_a1b2c3",
          "kind": "person"
        },
        "via": "device"
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
