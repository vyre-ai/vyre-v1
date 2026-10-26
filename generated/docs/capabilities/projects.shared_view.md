# projects.shared_view

System: what a shared link shows a client (title, status, goal, status update, next milestones; no people, threads or files). Only the host calls it, for /share/project/<token>

| | |
|---|---|
| Module | projects |
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
| HTTP | POST /v1/projects/shared_view |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  token: string;
};
```

## Output

```ts
type Out = {
  title: string;
  status: string;
  goal?: string;
  statusUpdate?: {
    text: string;
    at: number;
  };
  milestones: Array<{
      title: string;
      due?: number;
      status: string;
    }>;
  expiresAt?: number;
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
    "token": "a1b2c3"
  },
  "output": {
    "expiresAt": 1760000000000,
    "goal": "example",
    "milestones": [
      {
        "due": 1760000000000,
        "status": "example",
        "title": "example"
      }
    ],
    "status": "example",
    "statusUpdate": {
      "at": 1760000000000,
      "text": "example"
    },
    "title": "example"
  }
}
```
