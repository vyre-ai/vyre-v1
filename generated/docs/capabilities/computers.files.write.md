# computers.files.write

Write a file in the agent Files folder (downloads, drafts, work/)

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | computers.use |
| Grant level | edit |
| Risk | medium |
| Resource | computer (/computerId) |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/computers/files/write |
| MCP tool | computer_files_write (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId?: string;
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
  mode?: "create" | "overwrite" | "append";
};
```

## Output

```ts
type Out = {
  ok: boolean;
  versionId?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- provider.unavailable
- timeout.deadline
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "computerId": "cmt_a1b2c3",
    "content": "example",
    "encoding": "utf8",
    "mode": "create",
    "path": "example"
  },
  "output": {
    "ok": true,
    "versionId": "ver_a1b2c3"
  }
}
```
