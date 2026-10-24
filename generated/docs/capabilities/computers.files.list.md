# computers.files.list

List a folder of the agent Files folder as seen on the computer

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
| HTTP | POST /v1/computers/files/list |
| MCP tool | computer_files_list (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId?: string;
  path?: string;
};
```

## Output

```ts
type Out = {
  entries: Array<{
      name: string;
      kind: "file" | "folder";
      size?: number;
      modifiedAt?: number;
    }>;
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
    "path": "example"
  },
  "output": {
    "entries": [
      {
        "kind": "file",
        "modifiedAt": 1760000000000,
        "name": "example",
        "size": 1
      }
    ]
  }
}
```
