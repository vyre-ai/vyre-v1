# vault.folders.list

Vault folders with counts and my level

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
| HTTP | POST /v1/vault/folders/list |
| MCP tool | vault_folders_list (vault) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  scope?: "mine" | "shared";
};
```

## Output

```ts
type Out = {
  folders: Array<{
      id: string;
      name: string;
      parentId?: string;
      scope: "mine" | "shared";
      owner: string;
      itemCount: number;
      whoCanExport: Array<{
          kind: "person" | "agent" | "actor" | "service" | "group" | "role" | "link";
          id: string;
        }>;
      yourLevel: "view" | "use" | "edit" | "manage";
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
  "input": {
    "scope": "mine"
  },
  "output": {
    "folders": [
      {
        "id": "vfd_a1b2c3",
        "itemCount": 1,
        "name": "example",
        "owner": "usr_a1b2c3",
        "parentId": "vfd_a1b2c3",
        "scope": "mine",
        "whoCanExport": [
          {
            "id": "usr_a1b2c3",
            "kind": "person"
          }
        ],
        "yourLevel": "view"
      }
    ]
  }
}
```
