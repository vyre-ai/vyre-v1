# members.remove_preview

Removal wizard: each kind of thing the person owns, its default action and the transfer diff

| | |
|---|---|
| Module | members |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | members.remove |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/members/remove_preview |
| MCP tool | members_remove_preview (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  personId: string;
};
```

## Output

```ts
type Out = {
  items: Array<{
      kind: "routines" | "automations" | "agents" | "records" | "files" | "channels" | "projects" | "mailbox_connections" | "vault_mine" | "private_chats" | "memory_from_you";
      count: number;
      defaultAction: "pause" | "reassign" | "revoke" | "export" | "retain" | "keep" | "delete";
      options: Array<"pause" | "reassign" | "revoke" | "export" | "retain" | "keep" | "delete">;
      reassignTo?: string;
      sample: Array<{
          type: string;
          id: string;
          title: string;
        }>;
    }>;
  exportUntil: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "personId": "usr_a1b2c3"
  },
  "output": {
    "exportUntil": 1760000000000,
    "items": [
      {
        "count": 1,
        "defaultAction": "pause",
        "kind": "routines",
        "options": [
          "pause"
        ],
        "reassignTo": "usr_a1b2c3",
        "sample": [
          {
            "id": "example",
            "title": "example",
            "type": "example"
          }
        ]
      }
    ]
  }
}
```
