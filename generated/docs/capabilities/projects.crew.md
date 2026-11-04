# projects.crew

The helpers working for a project with a live state (Working, Done or Needs you) and what each is on, from the crews of the project's chats, and the project's teammates

| | |
|---|---|
| Module | projects |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | project (/projectId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/projects/crew |
| MCP tool | projects_crew (records) |
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
  helpers: Array<{
      jobId: string;
      threadId: string;
      agentId: string;
      name?: string;
      title: string;
      state: "working" | "done" | "needs_you" | "stopped";
      startedAt: number;
      endedAt?: number;
    }>;
  working: number;
  needsYou: number;
  teammates: Array<{
      agentId: string;
      name: string;
      role: "lead" | "member" | "reviewer" | "guest";
      roleLine?: string;
      status: "awake" | "working" | "asleep" | "paused";
      madeForProject: boolean;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "projectId": "prj_a1b2c3"
  },
  "output": {
    "helpers": [
      {
        "agentId": "agt_a1b2c3",
        "endedAt": 1760000000000,
        "jobId": "example",
        "name": "example",
        "startedAt": 1760000000000,
        "state": "working",
        "threadId": "thr_a1b2c3",
        "title": "example"
      }
    ],
    "needsYou": 1,
    "teammates": [
      {
        "agentId": "agt_a1b2c3",
        "madeForProject": true,
        "name": "example",
        "role": "lead",
        "roleLine": "example",
        "status": "awake"
      }
    ],
    "working": 1
  }
}
```
