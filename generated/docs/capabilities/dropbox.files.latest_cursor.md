# dropbox.files.latest_cursor

The change feed's start point for a folder, so a mount reads only what happens after it

| | |
|---|---|
| Module | dropbox |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/dropbox/files/latest_cursor |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  path?: string;
  recursive?: boolean;
};
```

## Output

```ts
type Out = {
  cursor: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.auth_failed
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "connectionId": "con_a1b2c3",
    "path": "example",
    "recursive": true
  },
  "output": {
    "cursor": "example"
  }
}
```
