# vault.item.usage

Who used a key or sign-in and how much: turns and tokens per agent and per person, and the total, from the turns the engine metered on the item; a person sees their own turns, a manager of AI spend all of them

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | vault_item (/itemId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/vault/item/usage |
| MCP tool | vault_item_usage (vault) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  itemId: string;
  since?: number;
};
```

## Output

```ts
type Out = {
  actors: Array<{
      actor: {
        kind: "person" | "agent" | "actor" | "service";
        id: string;
      };
      turns: number;
      tokens: number;
    }>;
  total: {
    turns: number;
    tokens: number;
  };
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
    "itemId": "vit_a1b2c3",
    "since": 1760000000000
  },
  "output": {
    "actors": [
      {
        "actor": {
          "id": "usr_a1b2c3",
          "kind": "person"
        },
        "tokens": 1,
        "turns": 1
      }
    ],
    "total": {
      "tokens": 1,
      "turns": 1
    }
  }
}
```
