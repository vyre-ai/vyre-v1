# vault.folders.create

Make a vault folder (Mine, or Shared when the person may create shared items)

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | vault.shared_create |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/vault/folders/create |
| MCP tool | vault_folders_create (vault) |
| CLI | none |
| Emits | vault.folder_created |

## Input

```ts
type In = {
  name: string;
  parentId?: string;
  scope: "mine" | "shared";
  idempotencyKey: string;
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
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "name": "example",
    "parentId": "vfd_a1b2c3",
    "scope": "mine"
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
