# github.repos.list

List repositories the App can reach

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
| HTTP | POST /v1/github/repos/list |
| MCP tool | github_repos_list (records, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  installationId?: number;
  query?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  repos: Array<{
      repo: string;
      private: boolean;
      defaultBranch: string;
      url: string;
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
    "installationId": 1,
    "limit": 1,
    "query": "example"
  },
  "output": {
    "next": "example",
    "repos": [
      {
        "defaultBranch": "example",
        "private": true,
        "repo": "vyre-ai/website",
        "url": "example"
      }
    ],
    "total": 1
  }
}
```
