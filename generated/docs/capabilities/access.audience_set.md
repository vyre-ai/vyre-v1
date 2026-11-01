# access.audience_set

Choose who a record type or one record is open to: everyone, only people added or only me; a type also says who may export; a record's Files folder can follow its record

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
| HTTP | POST /v1/access/audience_set |
| MCP tool | access_audience_set (meta) |
| CLI | none |
| Emits | grant.created, grant.revoked, access.changed |

## Input

```ts
type In = {
  resource: {
    type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
    id: string;
  };
  audience?: "space" | "added" | "me";
  exporters?: "admins" | "viewers" | "chosen";
  outside?: boolean;
  follows?: string;
};
```

## Output

```ts
type Out = {
  audience: "space" | "added" | "me";
  exporters: "admins" | "viewers" | "chosen";
  outside: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.not_contained
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "audience": "space",
    "exporters": "admins",
    "follows": "rec_a1b2c3",
    "outside": true,
    "resource": {
      "id": "rec_a1b2c3",
      "type": "space"
    }
  },
  "output": {
    "audience": "space",
    "exporters": "admins",
    "outside": true
  }
}
```
