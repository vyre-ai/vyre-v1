# folders.create

Make a folder for one type of thing (Personal, or Space when the person may share)

| | |
|---|---|
| Module | access |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/folders/create |
| MCP tool | folders_create (meta) |
| CLI | none |
| Emits | folder.created, grant.created, access.changed |

## Input

```ts
type In = {
  type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
  name: string;
  parentId?: string;
  scope?: "personal" | "space";
  idempotencyKey: string;
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

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "name": "example",
    "parentId": "fld_a1b2c3",
    "scope": "personal",
    "type": "space"
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
