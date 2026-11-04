# access.reach

What level the caller holds on each of up to 200 things, in one call: none, view, use, edit or manage. A thing that does not exist answers none, the same as one the caller cannot see

| | |
|---|---|
| Module | access |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/access/reach |
| MCP tool | access_reach (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  items: Array<{
      type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
      id: string;
    }>;
};
```

## Output

```ts
type Out = {
  items: Array<{
      type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
      id: string;
      level: "none" | "view" | "use" | "edit" | "manage";
      title?: string;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "items": [
      {
        "id": "rec_a1b2c3",
        "type": "space"
      }
    ]
  },
  "output": {
    "items": [
      {
        "id": "example",
        "level": "none",
        "title": "example",
        "type": "space"
      }
    ]
  }
}
```
