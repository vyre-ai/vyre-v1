# ci.project.get

Whether a project shows the CI tab: its repository is linked and runners are on. Anyone who can see the project

| | |
|---|---|
| Module | ci |
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
| HTTP | POST /v1/ci/project/get |
| MCP tool | ci_project_get (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  projectId: string;
};
```

## Output

```ts
type Out = {
  linked: boolean;
  repo: string | null;
  enabled: boolean;
  labels: Array<string>;
  live: number;
  queued: number;
  appNeedsAccept: boolean;
  acceptUrl: string | null;
  orgAcceptUrl: string | null;
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
    "projectId": "prj_a1b2c3"
  },
  "output": {
    "acceptUrl": "example",
    "appNeedsAccept": true,
    "enabled": true,
    "labels": [
      "example"
    ],
    "linked": true,
    "live": 1,
    "orgAcceptUrl": "example",
    "queued": 1,
    "repo": "vyre-ai/website"
  }
}
```
