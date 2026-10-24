# github.issue.get

Read an issue live from GitHub

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
| HTTP | POST /v1/github/issue/get |
| MCP tool | github_issue_get (records, deferred) |
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
  issue: {
    repo: string;
    number: number;
    title: string;
    state: "open" | "closed";
    author: string;
    url: string;
    labels: Array<string>;
    assignees: Array<string>;
    body?: string;
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
    "issue": {
      "assignees": [
        "example"
      ],
      "author": "example",
      "body": "example",
      "labels": [
        "example"
      ],
      "number": 1,
      "repo": "vyre-ai/website",
      "state": "open",
      "title": "example",
      "url": "example"
    }
  }
}
```
