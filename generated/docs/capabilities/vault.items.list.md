# vault.items.list

List items (names and metadata only, never values) by section, folder, kind or text

| | |
|---|---|
| Module | vault |
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
| HTTP | POST /v1/vault/items/list |
| MCP tool | vault_items_list (vault) |
| CLI | vyre vault list |
| Emits | none |

## Input

```ts
type In = {
  section?: "personal" | "shared" | "space" | "starred" | "following";
  folder?: string;
  kind?: "login" | "api_key" | "env" | "card" | "note" | "totp" | "ssh_key" | "ai_subscription" | "other";
  q?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  items: Array<{
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
    }>;
  counts: Record<string, number>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "folder": "vfd_a1b2c3",
    "kind": "login",
    "limit": 1,
    "q": "example",
    "section": "personal"
  },
  "output": {
    "counts": {},
    "items": [
      {
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
    ],
    "next": "example",
    "total": 1
  }
}
```
