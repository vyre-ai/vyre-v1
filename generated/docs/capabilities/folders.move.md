# folders.move

Move a folder under another folder, or to the top

| | |
|---|---|
| Module | access |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | medium |
| Resource | folder (/folderId) |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/folders/move |
| MCP tool | folders_move (meta) |
| CLI | none |
| Emits | folder.moved, item.moved, access.changed |

## Input

```ts
type In = {
  folderId: string;
  parentId: string | null;
};
```

## Output

```ts
type Out = {
  folder: {
    id: string;
    type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
    name: string;
    parentId?: string;
    scope: "personal" | "space";
    owner: string;
    count: number;
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
    "folderId": "fld_a1b2c3",
    "parentId": "fld_a1b2c3"
  },
  "output": {
    "folder": {
      "count": 1,
      "id": "fld_a1b2c3",
      "name": "example",
      "owner": "example",
      "parentId": "fld_a1b2c3",
      "scope": "personal",
      "type": "space"
    }
  }
}
```
