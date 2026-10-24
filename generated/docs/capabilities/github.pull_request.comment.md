# github.pull_request.comment

Comment on a pull request

| | |
|---|---|
| Module | github |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | post |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/github/pull_request/comment |
| MCP tool | github_pull_request_comment (records, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  repo: string;
  number: number;
  body: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  commentId: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.network
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "body": "example",
    "idempotencyKey": "idem_1",
    "number": 1,
    "repo": "vyre-ai/website"
  },
  "output": {
    "commentId": 1
  }
}
```
