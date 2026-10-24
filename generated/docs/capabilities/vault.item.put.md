# vault.item.put

Add an item: a name plus KEY=value fields (a pasted .env or an app template becomes fields on the client)

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | vault.shared_create |
| Grant level | edit |
| Risk | medium |
| Resource | vault_folder (/folderId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/vault/item/put |
| MCP tool | vault_item_put (vault) |
| CLI | none |
| Emits | vault.item_created |

## Input

```ts
type In = {
  folderId: string;
  name: string;
  kind: "login" | "api_key" | "env" | "card" | "note" | "totp" | "ssh_key" | "ai_subscription" | "other";
  fields: Array<{
      key: string;
      value: string;
      secret?: boolean;
    }>;
  template?: string;
  spaceOnly?: boolean;
  injectIntoDeployments?: boolean;
  rotateEveryDays?: number;
  idempotencyKey: string;
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
- permission.role_lacks_permission
- validation.bad_input
- validation.duplicate
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "fields": [
      {
        "key": "api_key",
        "secret": true,
        "value": "example"
      }
    ],
    "folderId": "vfd_a1b2c3",
    "idempotencyKey": "idem_1",
    "injectIntoDeployments": true,
    "kind": "login",
    "name": "example",
    "rotateEveryDays": 1,
    "spaceOnly": true,
    "template": "lawmatics"
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
