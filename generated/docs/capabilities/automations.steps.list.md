# automations.steps.list

The step palette: every step kind with category, input and output schema, effects and Gate act

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
| HTTP | POST /v1/automations/steps/list |
| MCP tool | automations_steps_list (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  category?: "data" | "send" | "ai" | "control" | "wait" | "code" | "sheet" | "sign" | "journey";
};
```

## Output

```ts
type Out = {
  steps: Array<{
      key: string;
      title: string;
      category: string;
      kind: string;
      input: unknown;
      output: unknown;
      effects: "read" | "write" | "outward";
      gateAct?: string;
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
    "category": "data"
  },
  "output": {
    "steps": [
      {
        "category": "example",
        "effects": "read",
        "gateAct": "example",
        "input": {},
        "key": "example",
        "kind": "example",
        "output": {},
        "title": "example"
      }
    ]
  }
}
```
