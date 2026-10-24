# github.pull_request.checks

Check runs of a pull request

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
| HTTP | POST /v1/github/pull_request/checks |
| MCP tool | github_pull_request_checks (records, deferred) |
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
  state: "none" | "pending" | "passing" | "failing";
  runs: Array<{
      name: string;
      status: string;
      conclusion?: string;
      url?: string;
    }>;
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
    "runs": [
      {
        "conclusion": "example",
        "name": "example",
        "status": "example",
        "url": "example"
      }
    ],
    "state": "none"
  }
}
```
