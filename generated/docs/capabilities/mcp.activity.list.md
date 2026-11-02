# mcp.activity.list

What an outside agent did: the tool, how it ended and where, never an input or an answer

| | |
|---|---|
| Module | mcp |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mcp/activity/list |
| MCP tool | mcp_activity_list (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  rows: Array<{
      id: string;
      tool: string;
      cap?: string;
      outcome: "ok" | "error" | "held";
      threadId?: string;
      taskId?: string;
      at: number;
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
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "cursor": "example",
    "limit": 1
  },
  "output": {
    "next": "example",
    "rows": [
      {
        "at": 1760000000000,
        "cap": "example",
        "id": "mca_a1b2c3",
        "outcome": "ok",
        "taskId": "tsk_a1b2c3",
        "threadId": "thr_a1b2c3",
        "tool": "records_query"
      }
    ],
    "total": 1
  }
}
```
