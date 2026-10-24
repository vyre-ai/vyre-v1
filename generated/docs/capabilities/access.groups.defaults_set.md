# access.groups.defaults_set

Replace the default grants of the Everyone group; the sheet shows who gains what, then applies

| | |
|---|---|
| Module | access |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | access.manage |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/access/groups/defaults_set |
| MCP tool | access_groups_defaults_set (engineer) |
| CLI | none |
| Emits | access.everyone_defaults_changed, access.changed |

## Input

```ts
type In = {
  grants: Array<{
      resource: {
        type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
        id: string;
      };
      level: "view" | "use" | "edit" | "manage";
    }>;
};
```

## Output

```ts
type Out = {
  groupId: string;
  grants: Array<{
      resource: {
        type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
        id: string;
      };
      level: "view" | "use" | "edit" | "manage";
    }>;
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
    "grants": [
      {
        "level": "view",
        "resource": {
          "id": "rec_a1b2c3",
          "type": "space"
        }
      }
    ]
  },
  "output": {
    "grants": [
      {
        "level": "view",
        "resource": {
          "id": "rec_a1b2c3",
          "type": "space"
        }
      }
    ],
    "groupId": "grp_a1b2c3"
  }
}
```
