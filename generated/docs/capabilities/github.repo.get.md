# github.repo.get

Read one repository

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
| HTTP | POST /v1/github/repo/get |
| MCP tool | github_repo_get (records, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  repo: string;
};
```

## Output

```ts
type Out = {
  repo: string;
  private: boolean;
  defaultBranch: string;
  url: string;
  description?: string;
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
    "repo": "vyre-ai/website"
  },
  "output": {
    "defaultBranch": "example",
    "description": "example",
    "private": true,
    "repo": "vyre-ai/website",
    "url": "example"
  }
}
```
