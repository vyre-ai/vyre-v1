# vault.item.restore

Bring an item back from Trash

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | medium |
| Resource | vault_item (/itemId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/vault/item/restore |
| MCP tool | vault_item_restore (vault) |
| CLI | none |
| Emits | vault.item_restored |

## Input

```ts
type In = {
  itemId: string;
};
```

## Output

```ts
type Out = {
  item: {
    id: string;
    name: string;
    kind: "login" | "api_key" | "env" | "card" | "note" | "totp" | "ssh_key" | "ai_subscription" | "other";
    folderId: string;
    owner: string;
    scope: "mine" | "shared";
    fieldKeys: Array<string>;
    handle: string;
    spaceOnly: boolean;
    injectIntoDeployments: boolean;
    rotateEveryDays?: number;
    lastRotatedAt?: number;
    lastUsedAt?: number;
    yourLevel: "view" | "use" | "edit" | "manage";
    label: number;
    createdAt: number;
    updatedAt: number;
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
    "itemId": "vit_a1b2c3"
  },
  "output": {
    "item": {
      "createdAt": 1760000000000,
      "fieldKeys": [
        "api_key"
      ],
      "folderId": "vfd_a1b2c3",
      "handle": "#Dana_Lawmatics",
      "id": "vit_a1b2c3",
      "injectIntoDeployments": true,
      "kind": "login",
      "label": 1,
      "lastRotatedAt": 1760000000000,
      "lastUsedAt": 1760000000000,
      "name": "example",
      "owner": "usr_a1b2c3",
      "rotateEveryDays": 1,
      "scope": "mine",
      "spaceOnly": true,
      "updatedAt": 1760000000000,
      "yourLevel": "view"
    }
  }
}
```
