# mcp.sessions.list

Active and recent MCP sessions for the Console (outside actors and CLI engines)

| | |
|---|---|
| Module | mcp |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | manage |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mcp/sessions/list |
| MCP tool | mcp_sessions_list (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  kind?: "outside" | "driver";
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  sessions: Array<{
      sessionId: string;
      kind: "outside" | "driver";
      principal: string;
      actingFor?: string;
      threadId?: string;
      runId?: string;
      name?: string;
      scopes?: {
        read: boolean;
        post: boolean;
        readChangesets: boolean;
        writeBranch: boolean;
      };
      startedAt: number;
      lastCallAt?: number;
      calls: number;
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
    "kind": "outside",
    "limit": 1
  },
  "output": {
    "next": "example",
    "sessions": [
      {
        "actingFor": "example",
        "calls": 1,
        "kind": "outside",
        "lastCallAt": 1760000000000,
        "name": "example",
        "principal": "example",
        "runId": "run_a1b2c3",
        "scopes": {
          "post": true,
          "read": true,
          "readChangesets": true,
          "writeBranch": true
        },
        "sessionId": "ses_a1b2c3",
        "startedAt": 1760000000000,
        "threadId": "thr_a1b2c3"
      }
    ],
    "total": 1
  }
}
```
