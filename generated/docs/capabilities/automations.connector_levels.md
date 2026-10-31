# automations.connector_levels

Which connector actions were tried against the real app (tested) and which were not (draft). Keys only.

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
| HTTP | POST /v1/automations/connector_levels |
| MCP tool | automations_connector_levels (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  levels: Array<{
      actionKey: string;
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
  "input": {},
  "output": {
    "levels": [
      {
        "actionKey": "example",
        "level": "draft"
      }
    ]
  }
}
```
