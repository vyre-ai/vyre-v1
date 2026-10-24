# access.groups.defaults_get

Default grants of the built-in Everyone group (every member holds them; Kits ship the first set and invites add new people to the group)

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
| HTTP | POST /v1/access/groups/defaults_get |
| MCP tool | access_groups_defaults_get (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
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
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
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
