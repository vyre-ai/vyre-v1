# github.pull_request.update

Change the title, body, labels, assignees or base of a pull request

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
| HTTP | POST /v1/github/pull_request/update |
| MCP tool | github_pull_request_update (records, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  repo: string;
  number: number;
  title?: string;
  body?: string;
  labels?: Array<string>;
  assignees?: Array<string>;
  base?: string;
  idempotencyKey: string;
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
- provider.network
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "assignees": [
      "example"
    ],
    "base": "example",
    "body": "example",
    "idempotencyKey": "idem_1",
    "labels": [
      "example"
    ],
    "number": 1,
    "repo": "vyre-ai/website",
    "title": "example"
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
