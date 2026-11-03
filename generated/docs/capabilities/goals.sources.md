# goals.sources

What a goal could count, for drafting a measurable finish line: record types with their counts, connections, and the outside MCP servers the lead can read

| | |
|---|---|
| Module | goals |
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
| HTTP | POST /v1/goals/sources |
| MCP tool | goals_sources (tasks) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  leadAgentId?: string;
};
```

## Output

```ts
type Out = {
  records: Array<{
      type: string;
      title: string;
      count?: number;
    }>;
  connections: Array<{
      connectionId: string;
      connector: string;
      name: string;
    }>;
  mcp: Array<{
      server: string;
      tools: Array<string>;
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
    "leadAgentId": "agt_a1b2c3"
  },
  "output": {
    "connections": [
      {
        "connectionId": "example",
        "connector": "example",
        "name": "example"
      }
    ],
    "mcp": [
      {
        "server": "example",
        "tools": [
          "example"
        ]
      }
    ],
    "records": [
      {
        "count": 1,
        "title": "example",
        "type": "example"
      }
    ]
  }
}
```
