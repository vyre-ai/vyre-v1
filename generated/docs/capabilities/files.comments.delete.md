# files.comments.delete

Delete a comment

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/files/comments/delete |
| MCP tool | files_comments_delete (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  commentId: string;
};
```

## Output

```ts
type Out = {
  deleted: boolean;
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
    "commentId": "fcm_a1b2c3"
  },
  "output": {
    "deleted": true
  }
}
```
