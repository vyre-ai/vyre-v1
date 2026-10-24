# github.branches.list

List branches of a repository (branch picker)

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
| HTTP | POST /v1/github/branches/list |
| MCP tool | github_branches_list (records, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  repo: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  branches: Array<{
      name: string;
      sha: string;
      protected: boolean;
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
    "repo": "vyre-ai/website"
  },
  "output": {
    "branches": [
      {
        "name": "example",
        "protected": true,
        "sha": "example"
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
