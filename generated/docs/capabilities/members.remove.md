# members.remove

Remove a person with the wizard plan: reassign owned things, pause routines, revoke mailbox connections, rotate the Space key epoch

| | |
|---|---|
| Module | members |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | members.remove |
| Grant level | view |
| Risk | high |
| Resource | space |
| Gate | delete when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/members/remove |
| MCP tool | members_remove (meta) |
| CLI | none |
| Emits | member.removed, member.removal_plan_applied, principal.suspended |

## Input

```ts
type In = {
  personId: string;
  plan: Array<{
      kind: "routines" | "automations" | "agents" | "records" | "files" | "channels" | "projects" | "mailbox_connections" | "vault_mine" | "private_chats" | "memory_from_you";
      action: "pause" | "reassign" | "revoke" | "export" | "retain" | "keep" | "delete";
      to?: string;
    }>;
  reason?: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.on_hold
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "personId": "usr_a1b2c3",
    "plan": [
      {
        "action": "pause",
        "kind": "routines",
        "to": "usr_a1b2c3"
      }
    ],
    "reason": "example"
  },
  "output": {
    "ok": true
  }
}
```
