# vault.item.update

Change fields or settings of an item: set and remove fields, Space only lock, inject into deployments, rotation reminder

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | vault_item (/itemId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/vault/item/update |
| MCP tool | vault_item_update (vault) |
| CLI | none |
| Emits | vault.item_updated |

## Input

```ts
type In = {
  itemId: string;
  name?: string;
  fieldsSet?: Array<{
      key: string;
      value: string;
      secret?: boolean;
    }>;
  fieldsRemove?: Array<string>;
  spaceOnly?: boolean;
  injectIntoDeployments?: boolean;
  rotateEveryDays?: number | null;
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
    "fieldsRemove": [
      "api_key"
    ],
    "fieldsSet": [
      {
        "key": "api_key",
        "secret": true,
        "value": "example"
      }
    ],
    "injectIntoDeployments": true,
    "itemId": "vit_a1b2c3",
    "name": "example",
    "rotateEveryDays": 1,
    "spaceOnly": true
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
