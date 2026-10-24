# console.assistant_tools

Engineer toolset available to this person: schema, connectors, settings, logs, traces, diagnostics, server config, filtered by role

| | |
|---|---|
| Module | console-assistant |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | engineer.mcp |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/console/assistant_tools |
| MCP tool | console_assistant_tools (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  tools: Array<{
      name: string;
      summary: string;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "tools": [
      {
        "name": "example",
        "summary": "example"
      }
    ]
  }
}
```
