# spaces.matrix

Which features work in this Space and which need a Team Space (the Personal matrix)

| | |
|---|---|
| Module | spaces |
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
| HTTP | POST /v1/spaces/matrix |
| MCP tool | spaces_matrix (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  kind: "personal" | "team";
  features: Array<{
      key: "apps_public" | "campaign_sending" | "console" | "agent_computers" | "webhooks" | "always_on_runs" | "sharing" | "members";
      available: boolean;
      line?: string;
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
  "input": {},
  "output": {
    "features": [
      {
        "available": true,
        "key": "apps_public",
        "line": "Needs a Team Space"
      }
    ],
    "kind": "personal"
  }
}
```
