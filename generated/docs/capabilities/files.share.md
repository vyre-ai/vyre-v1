# files.share

Share a file with a person, group, role or agent at View, Use, Edit or Manage (folders use access.share)

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | medium |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/files/share |
| MCP tool | files_share (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
  subject: {
    kind: "person" | "agent" | "actor" | "service" | "group" | "role" | "link";
    id: string;
  };
  level: "view" | "use" | "edit" | "manage";
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
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "fileId": "fil_a1b2c3",
    "level": "view",
    "subject": {
      "id": "usr_a1b2c3",
      "kind": "person"
    }
  },
  "output": {
    "ok": true
  }
}
```
