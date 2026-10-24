# folders.list

Folders of one type with item counts, as a tree

| | |
|---|---|
| Module | access |
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
| HTTP | POST /v1/folders/list |
| MCP tool | folders_list (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
  scope?: "personal" | "space";
};
```

## Output

```ts
type Out = {
  folders: Array<{
      id: string;
      type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
      name: string;
      parentId?: string;
      scope: "personal" | "space";
      owner: string;
      count: number;
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
    "scope": "personal",
    "type": "space"
  },
  "output": {
    "folders": [
      {
        "count": 1,
        "id": "fld_a1b2c3",
        "name": "example",
        "owner": "example",
        "parentId": "fld_a1b2c3",
        "scope": "personal",
        "type": "space"
      }
    ]
  }
}
```
