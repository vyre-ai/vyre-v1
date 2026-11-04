# github.pull_request.get

Read a pull request live from GitHub

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
| HTTP | POST /v1/github/pull_request/get |
| MCP tool | github_pull_request_get (records, deferred) |
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
  pullRequest: {
    repo: string;
    number: number;
    title: string;
    state: "open" | "closed" | "merged";
    draft: boolean;
    author: string;
    branch: string;
    base: string;
    url: string;
    checks: "none" | "pending" | "passing" | "failing";
    labels: Array<string>;
    assignees: Array<string>;
    body?: string;
    mergedAt?: number;
    additions?: number;
    deletions?: number;
    changedFiles?: number;
  };
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
    "pullRequest": {
      "additions": 1,
      "assignees": [
        "example"
      ],
      "author": "example",
      "base": "example",
      "body": "example",
      "branch": "example",
      "changedFiles": 1,
      "checks": "none",
      "deletions": 1,
      "draft": true,
      "labels": [
        "example"
      ],
      "mergedAt": 1760000000000,
      "number": 1,
      "repo": "vyre-ai/website",
      "state": "open",
      "title": "example",
      "url": "example"
    }
  }
}
```
