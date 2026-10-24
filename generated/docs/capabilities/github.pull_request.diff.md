# github.pull_request.diff

Unified diff of a pull request (opens as a diff tab)

| | |
|---|---|
| Module | github |
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
| HTTP | POST /v1/github/pull_request/diff |
| MCP tool | github_pull_request_diff (records, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  repo: string;
  number: number;
};
```

## Output

```ts
type Out = {
  diff: string;
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
    "number": 1,
    "repo": "vyre-ai/website"
  },
  "output": {
    "diff": "example"
  }
}
```
