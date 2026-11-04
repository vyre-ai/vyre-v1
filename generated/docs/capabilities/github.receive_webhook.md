# github.receive_webhook

Record a verified GitHub delivery after dedupe; normalise push, pull request, issue, check and workflow events

| | |
|---|---|
| Module | github |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/github/receive_webhook |
| MCP tool | none |
| CLI | none |
| Emits | github.event_received, repo.pushed, pull_request.opened, pull_request.merged, pull_request.closed, issue.opened, github.check_completed, workflow.completed |

## Input

```ts
type In = {
  deliveryId: string;
  event: "ping" | "installation" | "push" | "pull_request" | "issues" | "check_run" | "workflow_run";
  action?: string;
  repo?: string;
  installationId?: number;
  number?: number;
  sha?: string;
  branch?: string;
  conclusion?: string;
  name?: string;
};
```

## Output

```ts
type Out = {
  accepted: boolean;
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
    "action": "example",
    "branch": "example",
    "conclusion": "example",
    "deliveryId": "example",
    "event": "ping",
    "installationId": 1,
    "name": "example",
    "number": 1,
    "repo": "vyre-ai/website",
    "sha": "example"
  },
  "output": {
    "accepted": true
  }
}
```
