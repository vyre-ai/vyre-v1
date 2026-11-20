# access.folder_narrow

System: the server closes a Files folder to the people added when it could not follow its record; only the host's own services call it

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
| Team Space only | no |
| HTTP | POST /v1/access/folder_narrow |
| MCP tool | none |
| CLI | none |
| Emits | grant.created, grant.revoked, access.changed |

## Input

```ts
type In = {
  folderId: string;
};
```

## Output

```ts
type Out = {
  audience: "space" | "added" | "me";
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
    "folderId": "fld_a1b2c3"
  },
  "output": {
    "audience": "space"
  }
}
```
