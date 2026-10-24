# github.pull_request.list_files

Changed files of a pull request (the Changes tab)

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
| HTTP | POST /v1/github/pull_request/list_files |
| MCP tool | github_pull_request_list_files (records, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  repo: string;
  number: number;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  files: Array<{
      path: string;
      status: string;
      additions: number;
      deletions: number;
      patch?: string;
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "limit": 1,
    "number": 1,
    "repo": "vyre-ai/website"
  },
  "output": {
    "files": [
      {
        "additions": 1,
        "deletions": 1,
        "patch": "example",
        "path": "example",
        "status": "example"
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
