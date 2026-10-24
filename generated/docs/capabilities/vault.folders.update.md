# vault.folders.update

Rename a vault folder or set Who can export for it

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | medium |
| Resource | vault_folder (/folderId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/vault/folders/update |
| MCP tool | vault_folders_update (vault) |
| CLI | none |
| Emits | vault.folder_updated |

## Input

```ts
type In = {
  folderId: string;
  name?: string;
  whoCanExport?: Array<{
      kind: "person" | "agent" | "actor" | "service" | "group" | "role" | "link";
      id: string;
    }>;
};
```

## Output

```ts
type Out = {
  folder: {
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
    "folderId": "vfd_a1b2c3",
    "name": "example",
    "whoCanExport": [
      {
        "id": "usr_a1b2c3",
        "kind": "person"
      }
    ]
  },
  "output": {
    "folder": {
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
  }
}
```
