# access.unshare

Remove a grant, or every grant of one source on a resource

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
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/access/unshare |
| MCP tool | access_unshare (meta) |
| CLI | none |
| Emits | grant.revoked, access.changed, folder.shared |

## Input

```ts
type In = {
  grantId?: string;
  resource?: {
    type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain";
    id: string;
  };
  subject?: {
    kind: "person" | "agent" | "actor" | "service" | "group" | "role" | "link";
    id: string;
  };
  source?: string;
};
```

## Output

```ts
type Out = {
  revoked: number;
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
    "grantId": "gnt_a1b2c3",
    "resource": {
      "id": "rec_a1b2c3",
      "type": "space"
    },
    "source": "example",
    "subject": {
      "id": "usr_a1b2c3",
      "kind": "person"
    }
  },
  "output": {
    "revoked": 1
  }
}
```
