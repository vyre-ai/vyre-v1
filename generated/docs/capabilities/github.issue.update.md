# github.issue.update

Change the title, body, labels or assignees of an issue

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
| HTTP | POST /v1/github/issue/update |
| MCP tool | github_issue_update (records, deferred) |
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
  idempotencyKey: string;
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
