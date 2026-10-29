# automations.open_mcp

Read a public MCP server address and draft one action per tool name. The document text is not returned.

| | |
|---|---|
| Module | automations |
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
| HTTP | POST /v1/automations/open_mcp |
| MCP tool | automations_open_mcp (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  app: string;
  url: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
  reason?: string;
  actions?: Array<{
      key: string;
      title: string;
      level: "draft" | "tested";
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
    "app": "example",
    "url": "example"
  },
  "output": {
    "actions": [
      {
        "key": "example",
        "level": "draft",
        "title": "example"
      }
    ],
    "ok": true,
    "reason": "example"
  }
}
```
