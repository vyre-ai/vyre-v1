# computers.files.read

Read a file from the agent Files folder on the computer

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | computers.use |
| Grant level | view |
| Risk | low |
| Resource | computer (/computerId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/computers/files/read |
| MCP tool | computer_files_read (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId?: string;
  path: string;
  maxBytes?: number;
};
```

## Output

```ts
type Out = {
  content: string;
  encoding: "utf8" | "base64";
  truncated: boolean;
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
    "maxBytes": 1,
    "path": "example"
  },
  "output": {
    "content": "example",
    "encoding": "utf8",
    "truncated": true
  }
}
```
