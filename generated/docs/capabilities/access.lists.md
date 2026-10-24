# access.lists

Items of one type in a section (Personal, Shared with me, Space, Starred, Following) with folder counts

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
| HTTP | POST /v1/access/lists |
| MCP tool | access_lists (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain";
  section?: "personal" | "shared" | "space" | "starred" | "following";
  folder?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  rows: Array<{
      type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain";
      id: string;
      title: string;
      via: "owner" | "grant" | "folder" | "space";
      level: "view" | "use" | "edit" | "manage";
      folderId?: string;
      starred: boolean;
      following: boolean;
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
    "folder": "fld_a1b2c3",
    "limit": 1,
    "section": "personal",
    "type": "space"
  },
  "output": {
    "counts": {},
    "next": "example",
    "rows": [
      {
        "folderId": "fld_a1b2c3",
        "following": true,
        "id": "rec_a1b2c3",
        "level": "view",
        "starred": true,
        "title": "example",
        "type": "space",
        "via": "owner"
      }
    ],
    "total": 1
  }
}
```
