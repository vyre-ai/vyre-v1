# files.live_among

Which of the given files or folders are not in Trash, for the server's own lists (access.lists asks it once per page); an id that is trashed or unknown is left out

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/files/live_among |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: "file" | "folder";
  ids: Array<string>;
};
```

## Output

```ts
type Out = {
  live: Array<string>;
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
    "ids": [
      "example"
    ],
    "type": "file"
  },
  "output": {
    "live": [
      "example"
    ]
  }
}
```
